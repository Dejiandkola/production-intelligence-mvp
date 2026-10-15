-- Approved amendments create a distinct work occurrence on the same garment.
-- Approved replacements create a linked new garment and normal assignments.

CREATE TABLE public.amendment_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE REFERENCES public.work_change_requests(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, item_id, ordinal)
);

ALTER TABLE public.items
ADD COLUMN replacement_of_item_id uuid REFERENCES public.items(id) ON DELETE RESTRICT;

ALTER TABLE public.items
ADD COLUMN approved_work_change_request_id uuid UNIQUE
REFERENCES public.work_change_requests(id) ON DELETE RESTRICT;

CREATE INDEX items_replacement_of_idx
ON public.items (organization_id, replacement_of_item_id)
WHERE replacement_of_item_id IS NOT NULL;

ALTER TABLE public.work_assignments
ADD COLUMN amendment_occurrence_id uuid REFERENCES public.amendment_occurrences(id) ON DELETE RESTRICT;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.work_assignments'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, item_id, category_type_id, task_type_id)';

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'Expected work assignment uniqueness constraint not found';
  END IF;

  EXECUTE format('ALTER TABLE public.work_assignments DROP CONSTRAINT %I', v_constraint_name);
END;
$$;

CREATE UNIQUE INDEX work_assignments_base_task_unique
ON public.work_assignments (organization_id, item_id, category_type_id, task_type_id)
WHERE amendment_occurrence_id IS NULL;

CREATE UNIQUE INDEX work_assignments_amendment_task_unique
ON public.work_assignments (amendment_occurrence_id, category_type_id, task_type_id)
WHERE amendment_occurrence_id IS NOT NULL;

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

    IF (
      NEW.item_id IS DISTINCT FROM OLD.item_id OR
      NEW.category_type_id IS DISTINCT FROM OLD.category_type_id OR
      NEW.task_type_id IS DISTINCT FROM OLD.task_type_id OR
      NEW.tailor_id IS DISTINCT FROM OLD.tailor_id
    ) AND (
      OLD.amendment_occurrence_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.items i
        WHERE i.id = OLD.item_id
          AND i.approved_work_change_request_id IS NOT NULL
      )
    ) THEN
      RAISE EXCEPTION 'Approved request tasks and tailors cannot be edited';
    END IF;
  END IF;

  IF NEW.amendment_occurrence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.amendment_occurrences ao
    JOIN public.category_types ct ON ct.id = NEW.category_type_id
    WHERE ao.id = NEW.amendment_occurrence_id
      AND ao.item_id = NEW.item_id
      AND ao.organization_id = NEW.organization_id
      AND ct.organization_id = NEW.organization_id
      AND lower(ct.name) = 'amendment'
  ) THEN
    RAISE EXCEPTION 'Amendment assignment must belong to its garment and Amendment category';
  END IF;

  IF NEW.amendment_occurrence_id IS NOT NULL THEN
    SELECT request_id INTO v_request_id
    FROM public.amendment_occurrences
    WHERE id = NEW.amendment_occurrence_id;
  ELSE
    SELECT approved_work_change_request_id INTO v_request_id
    FROM public.items WHERE id = NEW.item_id;
  END IF;

  IF v_request_id IS NOT NULL THEN
    SELECT proposed_assignments INTO v_proposal
    FROM public.work_change_requests WHERE id = v_request_id;

    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_proposal) AS proposal(value)
      WHERE proposal.value->>'category_type_id' = NEW.category_type_id::text
        AND proposal.value->>'task_type_id' = NEW.task_type_id::text
        AND proposal.value->>'tailor_id' = NEW.tailor_id::text
    ) THEN
      RAISE EXCEPTION 'Assignment differs from approved request';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_work_change_assignment
BEFORE INSERT OR UPDATE ON public.work_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_work_change_assignment();

CREATE OR REPLACE FUNCTION public.validate_replacement_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.replacement_of_item_id IS DISTINCT FROM OLD.replacement_of_item_id OR
       NEW.approved_work_change_request_id IS DISTINCT FROM OLD.approved_work_change_request_id THEN
      RAISE EXCEPTION 'Replacement origin cannot be changed';
    END IF;
  END IF;

  IF (NEW.replacement_of_item_id IS NULL) <> (NEW.approved_work_change_request_id IS NULL) THEN
    RAISE EXCEPTION 'Replacement origin and approved request must be supplied together';
  END IF;

  IF NEW.replacement_of_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.items original
    WHERE original.id = NEW.replacement_of_item_id
      AND original.organization_id = NEW.organization_id
      AND original.ticket_id = NEW.ticket_id
      AND original.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Replacement must belong to the same ticket and organization';
  END IF;

  IF NEW.approved_work_change_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.work_change_requests request
    WHERE request.id = NEW.approved_work_change_request_id
      AND request.organization_id = NEW.organization_id
      AND request.item_id = NEW.replacement_of_item_id
      AND request.kind = 'REPLACEMENT'
  ) THEN
    RAISE EXCEPTION 'Replacement request does not match the original garment';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_replacement_item
BEFORE INSERT OR UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.validate_replacement_item();

ALTER TABLE public.amendment_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.amendment_occurrences FROM anon, authenticated;
GRANT SELECT ON public.amendment_occurrences TO authenticated;

CREATE POLICY amendment_occurrences_read ON public.amendment_occurrences
FOR SELECT TO authenticated
USING (organization_id = public.current_org_id());

-- Keep ordinary QC/Production assignments on the baseline uniqueness index.
CREATE OR REPLACE FUNCTION public.create_work_assignment(
  p_item_id uuid,
  p_category_type_id uuid,
  p_task_type_id uuid,
  p_tailor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_assignment_id uuid;
  v_item_status item_status;
  v_approved_request_id uuid;
  v_pay record;
  v_pay_source text;
BEGIN
  IF NOT (public.has_permission('manage_production') OR public.has_permission('manage_qc')) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT status, approved_work_change_request_id
  INTO v_item_status, v_approved_request_id
  FROM public.items
  WHERE id = p_item_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_item_status IN ('CANCELLED', 'ARCHIVED', 'OUT_OF_PRODUCTION') THEN
    RAISE EXCEPTION 'Cannot assign work on item with status %', v_item_status;
  END IF;

  IF v_approved_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'Approved replacement tasks cannot be changed through production';
  END IF;

  SELECT * INTO v_pay FROM public.calculate_assignment_pay(
    p_item_id, p_category_type_id, p_task_type_id, p_tailor_id
  );
  v_pay_source := CASE WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY' ELSE 'RATE_CARD' END;

  INSERT INTO public.work_assignments (
    organization_id, item_id, category_type_id, task_type_id,
    tailor_id, status, pay_band_snapshot, rate_snapshot, pay_amount,
    pay_source, price_review_requested, price_review_reason,
    price_review_requested_by, price_review_requested_at, price_review_resolved_at,
    negotiated_pay_amount, negotiated_price_note, negotiated_price_set_by,
    negotiated_price_set_at
  ) VALUES (
    v_org_id, p_item_id, p_category_type_id, p_task_type_id,
    p_tailor_id, 'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee,
    v_pay_source, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  )
  ON CONFLICT (organization_id, item_id, category_type_id, task_type_id)
    WHERE amendment_occurrence_id IS NULL
  DO UPDATE SET
    tailor_id = EXCLUDED.tailor_id,
    pay_band_snapshot = EXCLUDED.pay_band_snapshot,
    rate_snapshot = EXCLUDED.rate_snapshot,
    pay_amount = EXCLUDED.pay_amount,
    pay_source = EXCLUDED.pay_source,
    price_review_requested = false,
    price_review_reason = NULL,
    price_review_requested_by = NULL,
    price_review_requested_at = NULL,
    price_review_resolved_at = NULL,
    negotiated_pay_amount = NULL,
    negotiated_price_note = NULL,
    negotiated_price_set_by = NULL,
    negotiated_price_set_at = NULL
  RETURNING id INTO v_assignment_id;

  IF v_item_status = 'NEW' THEN
    UPDATE public.items SET status = 'IN_PRODUCTION'
    WHERE id = p_item_id AND organization_id = v_org_id;
  END IF;

  RETURN v_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_work_change_request(
  p_request_id uuid,
  p_expected_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_original public.items%ROWTYPE;
  v_target_item_id uuid;
  v_occurrence_id uuid;
  v_ordinal integer;
  v_entry jsonb;
  v_category_id uuid;
  v_task_id uuid;
  v_tailor_id uuid;
  v_pay record;
  v_pay_source text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('manage_customer_service') THEN
    RAISE EXCEPTION 'Customer Service permission required';
  END IF;

  SELECT * INTO v_original
  FROM public.items
  WHERE id = (
    SELECT item_id FROM public.work_change_requests
    WHERE id = p_request_id AND organization_id = v_org_id
  ) AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_original.status::text IN ('ARCHIVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Garment is no longer eligible';
  END IF;

  SELECT * INTO v_request
  FROM public.work_change_requests
  WHERE id = p_request_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Pending request not found';
  END IF;

  IF v_request.created_by = auth.uid() THEN
    RAISE EXCEPTION 'The requester cannot review their own request';
  END IF;

  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'Request changed since it was opened. Refresh and try again';
  END IF;

  IF v_request.kind = 'AMENDMENT' THEN
    SELECT GREATEST(
      COALESCE(MAX(ao.ordinal), -1),
      CASE WHEN EXISTS (
        SELECT 1 FROM public.work_assignments wa
        JOIN public.category_types ct ON ct.id = wa.category_type_id
        WHERE wa.item_id = v_original.id
          AND wa.organization_id = v_org_id
          AND wa.amendment_occurrence_id IS NULL
          AND lower(ct.name) = 'amendment'
      ) THEN 0 ELSE -1 END
    ) + 1 INTO v_ordinal
    FROM public.amendment_occurrences ao
    WHERE ao.item_id = v_original.id AND ao.organization_id = v_org_id;

    INSERT INTO public.amendment_occurrences (
      organization_id, item_id, request_id, ordinal
    ) VALUES (
      v_org_id, v_original.id, v_request.id, v_ordinal
    ) RETURNING id INTO v_occurrence_id;

    v_target_item_id := v_original.id;
  ELSE
    INSERT INTO public.items (
      organization_id, ticket_id, product_type_id, status,
      replacement_of_item_id, approved_work_change_request_id
    ) VALUES (
      v_org_id, v_original.ticket_id, v_original.product_type_id,
      'IN_PRODUCTION', v_original.id, v_request.id
    ) RETURNING id INTO v_target_item_id;

    INSERT INTO public.custom_field_values (
      organization_id, item_id, field_id, text_value, number_value,
      boolean_value, date_value, option_value
    )
    SELECT organization_id, v_target_item_id, field_id, text_value,
           number_value, boolean_value, date_value, option_value
    FROM public.custom_field_values
    WHERE organization_id = v_org_id AND item_id = v_original.id;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_request.proposed_assignments)
  LOOP
    v_category_id := (v_entry->>'category_type_id')::uuid;
    v_task_id := (v_entry->>'task_type_id')::uuid;
    v_tailor_id := (v_entry->>'tailor_id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.rate_cards rc
      JOIN public.category_types ct ON ct.id = rc.category_type_id
        AND ct.organization_id = rc.organization_id
      JOIN public.tailors t ON t.id = v_tailor_id
        AND t.organization_id = rc.organization_id AND t.active = true
      WHERE rc.organization_id = v_org_id
        AND rc.product_type_id = v_original.product_type_id
        AND rc.category_type_id = v_category_id
        AND rc.task_type_id = v_task_id
        AND rc.active = true
        AND (v_request.kind = 'REPLACEMENT' OR lower(ct.name) = 'amendment')
    ) THEN
      RAISE EXCEPTION 'Proposed task or tailor is no longer available';
    END IF;

    SELECT * INTO v_pay FROM public.calculate_assignment_pay(
      v_target_item_id, v_category_id, v_task_id, v_tailor_id
    );
    v_pay_source := CASE WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY' ELSE 'RATE_CARD' END;

    INSERT INTO public.work_assignments (
      organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot,
      rate_snapshot, pay_amount, pay_source
    ) VALUES (
      v_org_id, v_target_item_id, v_category_id, v_task_id,
      v_tailor_id, v_occurrence_id, 'CREATED', v_pay.pay_band,
      v_pay.base_fee, v_pay.final_fee, v_pay_source
    );
  END LOOP;

  UPDATE public.work_change_requests
  SET status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
      updated_by = auth.uid(), version = version + 1, updated_at = now(),
      approved_snapshot = jsonb_build_object(
        'kind', kind, 'note', note,
        'proposed_assignments', proposed_assignments,
        'target_item_id', v_target_item_id,
        'amendment_occurrence_id', v_occurrence_id
      )
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  INSERT INTO public.work_change_request_revisions (
    request_id, organization_id, version, actor_user_id, action,
    before_state, after_state
  ) VALUES (
    v_request.id, v_org_id, v_request.version, auth.uid(), 'APPROVED',
    jsonb_build_object('status', 'PENDING'),
    v_request.approved_snapshot
  );

  RETURN v_target_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_work_change_request(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_work_change_request(uuid, integer) TO authenticated;
