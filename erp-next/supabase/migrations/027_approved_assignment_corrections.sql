-- A second Customer Service decision is required to change approved work.
-- Corrections are limited to assignments still awaiting QC; later states use
-- the existing reversal process and cannot be silently rewritten.

CREATE TABLE public.work_assignment_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.work_change_requests(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES public.work_assignments(id) ON DELETE RESTRICT,
  before_assignment jsonb NOT NULL,
  proposed_assignment jsonb NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  applied_at timestamptz
);

CREATE UNIQUE INDEX work_assignment_corrections_one_pending
ON public.work_assignment_corrections (assignment_id) WHERE status = 'PENDING';

ALTER TABLE public.work_assignment_corrections ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.work_assignment_corrections FROM anon, authenticated;
GRANT SELECT ON public.work_assignment_corrections TO authenticated;

CREATE POLICY work_assignment_corrections_read ON public.work_assignment_corrections
FOR SELECT TO authenticated USING (
  organization_id = public.current_org_id() AND (
    created_by = auth.uid() OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')
  )
);

CREATE FUNCTION public.submit_work_assignment_correction(
  p_assignment_id uuid,
  p_category_type_id uuid,
  p_task_type_id uuid,
  p_tailor_id uuid,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_assignment public.work_assignments%ROWTYPE;
  v_request_id uuid;
  v_product_type_id uuid;
  v_kind text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service')
  ) THEN RAISE EXCEPTION 'Request permission required'; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A correction reason is required';
  END IF;

  SELECT * INTO v_assignment FROM public.work_assignments
  WHERE id = p_assignment_id AND organization_id = v_org_id FOR UPDATE;
  IF NOT FOUND OR v_assignment.status::text <> 'CREATED' THEN
    RAISE EXCEPTION 'Only approved-request tasks awaiting QC can be corrected';
  END IF;

  SELECT COALESCE(ao.request_id, i.approved_work_change_request_id), i.product_type_id
  INTO v_request_id, v_product_type_id
  FROM public.items i
  LEFT JOIN public.amendment_occurrences ao ON ao.id = v_assignment.amendment_occurrence_id
    AND ao.item_id = i.id AND ao.organization_id = v_org_id
  WHERE i.id = v_assignment.item_id AND i.organization_id = v_org_id;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Task is not from an approved request'; END IF;

  SELECT kind INTO v_kind FROM public.work_change_requests
  WHERE id = v_request_id AND organization_id = v_org_id AND status = 'APPROVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved request not found'; END IF;

  IF (p_category_type_id, p_task_type_id, p_tailor_id) IS NOT DISTINCT FROM
     (v_assignment.category_type_id, v_assignment.task_type_id, v_assignment.tailor_id) THEN
    RAISE EXCEPTION 'Choose a different task or tailor';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rate_cards rc
    JOIN public.category_types ct ON ct.id = rc.category_type_id AND ct.organization_id = v_org_id
    JOIN public.task_types tt ON tt.id = rc.task_type_id AND tt.organization_id = v_org_id
    JOIN public.tailors t ON t.id = p_tailor_id AND t.organization_id = v_org_id AND t.active
    WHERE rc.organization_id = v_org_id AND rc.product_type_id = v_product_type_id
      AND rc.category_type_id = p_category_type_id AND rc.task_type_id = p_task_type_id
      AND rc.active AND (v_kind = 'REPLACEMENT' OR lower(ct.name) = 'amendment')
  ) THEN RAISE EXCEPTION 'Task or tailor is no longer available'; END IF;

  INSERT INTO public.work_assignment_corrections (
    organization_id, request_id, assignment_id, before_assignment,
    proposed_assignment, note, created_by
  ) VALUES (
    v_org_id, v_request_id, p_assignment_id,
    jsonb_build_object('category_type_id', v_assignment.category_type_id,
      'task_type_id', v_assignment.task_type_id, 'tailor_id', v_assignment.tailor_id,
      'pay_amount', v_assignment.pay_amount),
    jsonb_build_object('category_type_id', p_category_type_id,
      'task_type_id', p_task_type_id, 'tailor_id', p_tailor_id),
    btrim(p_note), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.review_work_assignment_correction(
  p_correction_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_correction public.work_assignment_corrections%ROWTYPE;
  v_assignment public.work_assignments%ROWTYPE;
  v_request public.work_change_requests%ROWTYPE;
  v_proposal jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_match_count integer := 0;
  v_pay record;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('manage_customer_service') THEN
    RAISE EXCEPTION 'Customer Service permission required';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Review decision is required'; END IF;
  SELECT * INTO v_correction FROM public.work_assignment_corrections
  WHERE id = p_correction_id AND organization_id = v_org_id FOR UPDATE;
  IF NOT FOUND OR v_correction.status <> 'PENDING' THEN RAISE EXCEPTION 'Pending correction not found'; END IF;
  IF v_correction.created_by = auth.uid() THEN RAISE EXCEPTION 'Requester cannot review their own correction'; END IF;
  IF NOT p_approve AND nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_assignment FROM public.work_assignments
  WHERE id = v_correction.assignment_id AND organization_id = v_org_id FOR UPDATE;
  IF NOT FOUND OR v_assignment.status::text <> 'CREATED' THEN
    RAISE EXCEPTION 'Task has progressed; correction cannot be applied';
  END IF;
  IF v_correction.before_assignment->>'category_type_id' IS DISTINCT FROM v_assignment.category_type_id::text
    OR v_correction.before_assignment->>'task_type_id' IS DISTINCT FROM v_assignment.task_type_id::text
    OR v_correction.before_assignment->>'tailor_id' IS DISTINCT FROM v_assignment.tailor_id::text THEN
    RAISE EXCEPTION 'Task changed since correction was submitted';
  END IF;
  IF NOT p_approve THEN
    UPDATE public.work_assignment_corrections SET status = 'REJECTED',
      reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
    WHERE id = p_correction_id;
    RETURN true;
  END IF;

  SELECT * INTO v_request FROM public.work_change_requests
  WHERE id = v_correction.request_id AND organization_id = v_org_id AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved request not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rate_cards rc
    JOIN public.category_types ct ON ct.id = rc.category_type_id AND ct.organization_id = v_org_id
    JOIN public.tailors t ON t.id = (v_correction.proposed_assignment->>'tailor_id')::uuid
      AND t.organization_id = v_org_id AND t.active
    WHERE rc.organization_id = v_org_id
      AND rc.product_type_id = (SELECT product_type_id FROM public.items WHERE id = v_assignment.item_id)
      AND rc.category_type_id = (v_correction.proposed_assignment->>'category_type_id')::uuid
      AND rc.task_type_id = (v_correction.proposed_assignment->>'task_type_id')::uuid
      AND rc.active AND (v_request.kind = 'REPLACEMENT' OR lower(ct.name) = 'amendment')
  ) THEN RAISE EXCEPTION 'Proposed task or tailor is no longer available'; END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_request.proposed_assignments) LOOP
    IF v_entry->>'category_type_id' = v_assignment.category_type_id::text
      AND v_entry->>'task_type_id' = v_assignment.task_type_id::text
      AND v_entry->>'tailor_id' = v_assignment.tailor_id::text THEN
      v_proposal := v_proposal || jsonb_build_array(v_correction.proposed_assignment);
      v_match_count := v_match_count + 1;
    ELSE
      IF v_entry->>'category_type_id' = v_correction.proposed_assignment->>'category_type_id'
        AND v_entry->>'task_type_id' = v_correction.proposed_assignment->>'task_type_id' THEN
        RAISE EXCEPTION 'That task already exists in the approved request';
      END IF;
      v_proposal := v_proposal || jsonb_build_array(v_entry);
    END IF;
  END LOOP;
  IF v_match_count <> 1 THEN RAISE EXCEPTION 'Approved task proposal no longer matches'; END IF;

  SELECT * INTO v_pay FROM public.calculate_assignment_pay(
    v_assignment.item_id,
    (v_correction.proposed_assignment->>'category_type_id')::uuid,
    (v_correction.proposed_assignment->>'task_type_id')::uuid,
    (v_correction.proposed_assignment->>'tailor_id')::uuid
  );

  UPDATE public.work_change_requests SET proposed_assignments = v_proposal,
    updated_by = auth.uid(), updated_at = now(), version = version + 1
  WHERE id = v_request.id;

  UPDATE public.work_assignment_corrections SET status = 'APPROVED',
    reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_correction_id;

  UPDATE public.work_assignments SET
    category_type_id = (v_correction.proposed_assignment->>'category_type_id')::uuid,
    task_type_id = (v_correction.proposed_assignment->>'task_type_id')::uuid,
    tailor_id = (v_correction.proposed_assignment->>'tailor_id')::uuid,
    pay_band_snapshot = v_pay.pay_band,
    rate_snapshot = v_pay.base_fee,
    pay_amount = v_pay.final_fee,
    pay_source = CASE WHEN v_pay.special_fee IS NULL THEN 'RATE_CARD' ELSE 'SPECIAL_PAY' END,
    negotiated_pay_amount = NULL, negotiated_price_note = NULL,
    negotiated_price_set_by = NULL, negotiated_price_set_at = NULL,
    price_review_requested = false, price_review_reason = NULL,
    price_review_requested_by = NULL, price_review_requested_at = NULL,
    price_review_resolved_at = NULL
  WHERE id = v_assignment.id;

  UPDATE public.work_assignment_corrections SET applied_at = now()
  WHERE id = p_correction_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_work_change_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_proposal jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.amendment_occurrence_id IS DISTINCT FROM OLD.amendment_occurrence_id THEN
      RAISE EXCEPTION 'Amendment occurrence cannot be changed';
    END IF;
    IF (NEW.item_id, NEW.category_type_id, NEW.task_type_id, NEW.tailor_id)
      IS DISTINCT FROM (OLD.item_id, OLD.category_type_id, OLD.task_type_id, OLD.tailor_id)
      AND (OLD.amendment_occurrence_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.items i WHERE i.id = OLD.item_id
          AND i.approved_work_change_request_id IS NOT NULL
      ))
      AND NOT (
        OLD.status::text = 'CREATED' AND NEW.item_id = OLD.item_id
        AND EXISTS (
          SELECT 1 FROM public.work_assignment_corrections c
          WHERE c.assignment_id = OLD.id AND c.organization_id = OLD.organization_id
            AND c.status = 'APPROVED' AND c.applied_at IS NULL
            AND c.before_assignment->>'category_type_id' = OLD.category_type_id::text
            AND c.before_assignment->>'task_type_id' = OLD.task_type_id::text
            AND c.before_assignment->>'tailor_id' = OLD.tailor_id::text
            AND c.proposed_assignment->>'category_type_id' = NEW.category_type_id::text
            AND c.proposed_assignment->>'task_type_id' = NEW.task_type_id::text
            AND c.proposed_assignment->>'tailor_id' = NEW.tailor_id::text
        )
      ) THEN
      RAISE EXCEPTION 'Approved request tasks and tailors require a reviewed correction';
    END IF;
  END IF;

  IF NEW.amendment_occurrence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.amendment_occurrences ao
    JOIN public.category_types ct ON ct.id = NEW.category_type_id
    WHERE ao.id = NEW.amendment_occurrence_id AND ao.item_id = NEW.item_id
      AND ao.organization_id = NEW.organization_id
      AND ct.organization_id = NEW.organization_id AND lower(ct.name) = 'amendment'
  ) THEN RAISE EXCEPTION 'Amendment assignment must belong to its garment and Amendment category'; END IF;

  IF NEW.amendment_occurrence_id IS NOT NULL THEN
    SELECT request_id INTO v_request_id FROM public.amendment_occurrences WHERE id = NEW.amendment_occurrence_id;
  ELSE
    SELECT approved_work_change_request_id INTO v_request_id FROM public.items WHERE id = NEW.item_id;
  END IF;
  IF v_request_id IS NOT NULL THEN
    SELECT proposed_assignments INTO v_proposal FROM public.work_change_requests WHERE id = v_request_id;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_proposal) AS proposal(value)
      WHERE proposal.value->>'category_type_id' = NEW.category_type_id::text
        AND proposal.value->>'task_type_id' = NEW.task_type_id::text
        AND proposal.value->>'tailor_id' = NEW.tailor_id::text
    ) THEN RAISE EXCEPTION 'Assignment differs from approved request'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_approved_work_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.amendment_occurrence_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.items i
    WHERE i.id = OLD.item_id AND i.organization_id = OLD.organization_id
      AND i.approved_work_change_request_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Approved request tasks cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER prevent_approved_work_assignment_delete
BEFORE DELETE ON public.work_assignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_work_assignment_delete();

REVOKE ALL ON FUNCTION public.submit_work_assignment_correction(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_work_assignment_correction(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_approved_work_assignment_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_work_assignment_correction(uuid, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_work_assignment_correction(uuid, boolean, text) TO authenticated;
