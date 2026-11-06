-- A later round is separate work on the same garment, never an edit to the prior round.
ALTER TABLE public.work_change_requests
  ADD COLUMN additional_round_previous_id uuid REFERENCES public.amendment_occurrences(id),
  ADD COLUMN prior_completion_attested_at timestamptz,
  ADD COLUMN prior_completion_attested_by uuid;

ALTER TABLE public.amendment_occurrences ADD COLUMN legacy_completion_attestation_allowed boolean NOT NULL DEFAULT false;
UPDATE public.amendment_occurrences SET legacy_completion_attestation_allowed = true;

-- The dedicated RPC creates later rounds; the first-round trigger must leave them alone.
CREATE OR REPLACE FUNCTION public.submit_first_amendment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_occurrence_id uuid;
  v_entry jsonb;
  v_pay record;
BEGIN
  IF NEW.kind <> 'AMENDMENT' OR NEW.status <> 'PENDING'
     OR NEW.additional_round_previous_id IS NOT NULL
     OR NEW.prior_completion_attested_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT (public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Request permission required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_change_requests r
    WHERE r.organization_id = NEW.organization_id AND r.item_id = NEW.item_id
      AND r.id <> NEW.id AND r.kind = 'AMENDMENT' AND r.status = 'PENDING') THEN
    RAISE EXCEPTION 'An amendment request is already pending for this item';
  END IF;
  IF EXISTS (SELECT 1 FROM public.amendment_occurrences WHERE organization_id = NEW.organization_id AND item_id = NEW.item_id)
     OR EXISTS (SELECT 1 FROM public.work_assignments wa JOIN public.category_types ct ON ct.id = wa.category_type_id
       WHERE wa.organization_id = NEW.organization_id AND wa.item_id = NEW.item_id
         AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment') THEN
    RAISE EXCEPTION 'This item already has an amendment. Open its history to start another round';
  END IF;
  INSERT INTO public.amendment_occurrences (organization_id, item_id, request_id, ordinal)
  VALUES (NEW.organization_id, NEW.item_id, NEW.id, 0) RETURNING id INTO v_occurrence_id;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(NEW.proposed_assignments) LOOP
    SELECT * INTO v_pay FROM public.calculate_assignment_pay(NEW.item_id,
      (v_entry->>'category_type_id')::uuid, (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid);
    INSERT INTO public.work_assignments (organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot, rate_snapshot, pay_amount, pay_source)
    VALUES (NEW.organization_id, NEW.item_id, (v_entry->>'category_type_id')::uuid,
      (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid, v_occurrence_id,
      'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee,
      CASE WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY' ELSE 'RATE_CARD' END);
  END LOOP;
  UPDATE public.work_change_requests SET status = 'APPROVED', reviewed_by = NULL, reviewed_at = NULL,
    updated_by = auth.uid(), version = version + 1, updated_at = now(),
    approved_snapshot = jsonb_build_object('kind', kind, 'note', note,
      'proposed_assignments', proposed_assignments, 'target_item_id', item_id,
      'amendment_occurrence_id', v_occurrence_id) WHERE id = NEW.id;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version, actor_user_id,
    action, before_state, after_state)
  VALUES (NEW.id, NEW.organization_id, NEW.version + 1, auth.uid(), 'APPROVED',
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'APPROVED', 'amendment_occurrence_id', v_occurrence_id));
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.submit_additional_amendment(
  p_item_id uuid, p_previous_occurrence_id uuid, p_reason text,
  p_assignments jsonb, p_confirm_separate_work boolean, p_attest_prior_completion boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_product_type_id uuid;
  v_previous public.amendment_occurrences%ROWTYPE;
  v_legacy_base boolean;
  v_legacy boolean;
  v_normalized jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_category_id uuid;
  v_task_id uuid;
  v_tailor_id uuid;
  v_request_id uuid;
  v_occurrence_id uuid;
  v_pay record;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  IF p_confirm_separate_work IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm this is separate work, not a correction to the previous round';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A reason for another round is required';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;
  -- Lock the garment so two users cannot both start the next round.
  SELECT product_type_id INTO v_product_type_id FROM public.items
  WHERE id = p_item_id AND organization_id = v_org_id AND status::text NOT IN ('ARCHIVED', 'CANCELLED') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Garment is no longer eligible'; END IF;
  SELECT * INTO v_previous FROM public.amendment_occurrences
  WHERE item_id = p_item_id AND organization_id = v_org_id ORDER BY ordinal DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.work_assignments wa JOIN public.category_types ct ON ct.id = wa.category_type_id
    WHERE wa.item_id = p_item_id AND wa.organization_id = v_org_id
      AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment') INTO v_legacy_base;
  IF v_previous.id IS NULL AND NOT v_legacy_base THEN
    RAISE EXCEPTION 'No previous amendment exists. Use Assign Amendment';
  END IF;
  IF p_previous_occurrence_id IS DISTINCT FROM v_previous.id THEN
    RAISE EXCEPTION 'Amendment history changed. Refresh and try again';
  END IF;
  IF v_previous.id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.work_assignments
      WHERE organization_id = v_org_id AND amendment_occurrence_id = v_previous.id) THEN
      RAISE EXCEPTION 'Previous amendment has no linked tasks';
    END IF;
    v_legacy := v_previous.legacy_completion_attestation_allowed;
    IF EXISTS (SELECT 1 FROM public.work_assignments
      WHERE organization_id = v_org_id AND amendment_occurrence_id = v_previous.id
        AND amendment_completed_at IS NULL) THEN
      IF NOT v_legacy OR p_attest_prior_completion IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Previous amendment must be confirmed completed first';
      END IF;
    END IF;
  ELSIF p_attest_prior_completion IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm the historical amendment was physically completed';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN RAISE EXCEPTION 'Invalid task proposal'; END IF;
    v_category_id := (v_entry->>'category_type_id')::uuid;
    v_task_id := (v_entry->>'task_type_id')::uuid;
    v_tailor_id := (v_entry->>'tailor_id')::uuid;
    IF v_category_id IS NULL OR v_task_id IS NULL OR v_tailor_id IS NULL THEN
      RAISE EXCEPTION 'Category, task, and tailor are required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rate_cards rc
      JOIN public.category_types ct ON ct.id = rc.category_type_id AND ct.organization_id = rc.organization_id
      JOIN public.task_types tt ON tt.id = rc.task_type_id AND tt.organization_id = rc.organization_id
      JOIN public.tailors t ON t.id = v_tailor_id AND t.organization_id = rc.organization_id AND t.active = true
      WHERE rc.organization_id = v_org_id AND rc.product_type_id = v_product_type_id
        AND rc.category_type_id = v_category_id AND rc.task_type_id = v_task_id
        AND rc.active = true AND lower(ct.name) = 'amendment') THEN
      RAISE EXCEPTION 'Task or tailor is not available for this garment';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_normalized) prior
      WHERE prior.value->>'category_type_id' = v_category_id::text
        AND prior.value->>'task_type_id' = v_task_id::text) THEN
      RAISE EXCEPTION 'A task type can only appear once in this round';
    END IF;
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'category_type_id', v_category_id, 'task_type_id', v_task_id, 'tailor_id', v_tailor_id));
  END LOOP;
  INSERT INTO public.work_change_requests (organization_id, item_id, kind, note,
    proposed_assignments, created_by, updated_by, additional_round_previous_id,
    prior_completion_attested_at, prior_completion_attested_by)
  VALUES (v_org_id, p_item_id, 'AMENDMENT', btrim(p_reason), v_normalized,
    auth.uid(), auth.uid(), v_previous.id,
    CASE WHEN p_attest_prior_completion AND (v_previous.id IS NULL OR v_legacy) THEN now() END,
    CASE WHEN p_attest_prior_completion AND (v_previous.id IS NULL OR v_legacy) THEN auth.uid() END)
  RETURNING id INTO v_request_id;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version,
    actor_user_id, action, after_state)
  VALUES (v_request_id, v_org_id, 1, auth.uid(), 'SUBMITTED',
    jsonb_build_object('kind', 'AMENDMENT', 'note', btrim(p_reason),
      'proposed_assignments', v_normalized));
  INSERT INTO public.amendment_occurrences (organization_id, item_id, request_id, ordinal)
  VALUES (v_org_id, p_item_id, v_request_id, 0) RETURNING id INTO v_occurrence_id;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_normalized) LOOP
    SELECT * INTO v_pay FROM public.calculate_assignment_pay(p_item_id,
      (v_entry->>'category_type_id')::uuid, (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid);
    INSERT INTO public.work_assignments (organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot, rate_snapshot, pay_amount, pay_source)
    VALUES (v_org_id, p_item_id, (v_entry->>'category_type_id')::uuid,
      (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid, v_occurrence_id,
      'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee,
      CASE WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY' ELSE 'RATE_CARD' END);
  END LOOP;
  UPDATE public.work_change_requests SET status = 'APPROVED', updated_by = auth.uid(),
    version = version + 1, updated_at = now(),
    approved_snapshot = jsonb_build_object('kind', kind, 'note', note,
      'proposed_assignments', proposed_assignments, 'target_item_id', item_id,
      'amendment_occurrence_id', v_occurrence_id) WHERE id = v_request_id;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version,
    actor_user_id, action, after_state)
  VALUES (v_request_id, v_org_id, 2, auth.uid(), 'APPROVED',
    jsonb_build_object('status', 'APPROVED', 'amendment_occurrence_id', v_occurrence_id,
      'previous_amendment_occurrence_id', v_previous.id,
      'prior_completion_attested', p_attest_prior_completion));
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_additional_amendment(uuid, uuid, text, jsonb, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_additional_amendment(uuid, uuid, text, jsonb, boolean, boolean) TO authenticated;

CREATE FUNCTION public.get_additional_amendment_context(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_previous public.amendment_occurrences%ROWTYPE;
  v_tasks jsonb;
  v_completed boolean;
  v_legacy_base boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.items WHERE id = p_item_id AND organization_id = v_org_id) THEN
    RAISE EXCEPTION 'Garment not found';
  END IF;
  SELECT * INTO v_previous FROM public.amendment_occurrences
  WHERE organization_id = v_org_id AND item_id = p_item_id ORDER BY ordinal DESC LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.work_assignments wa JOIN public.category_types ct ON ct.id = wa.category_type_id
    WHERE wa.organization_id = v_org_id AND wa.item_id = p_item_id
      AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment') INTO v_legacy_base;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('category_type_id', wa.category_type_id,
    'task_type_id', wa.task_type_id, 'task', tt.name)), '[]'::jsonb),
    COALESCE(bool_and(wa.amendment_completed_at IS NOT NULL), false)
  INTO v_tasks, v_completed
  FROM public.work_assignments wa JOIN public.task_types tt ON tt.id = wa.task_type_id
  WHERE wa.organization_id = v_org_id AND wa.item_id = p_item_id
    AND (v_previous.id IS NOT NULL AND wa.amendment_occurrence_id = v_previous.id
      OR v_previous.id IS NULL AND v_legacy_base AND wa.amendment_occurrence_id IS NULL
        AND EXISTS (SELECT 1 FROM public.category_types ct WHERE ct.id = wa.category_type_id AND lower(ct.name) = 'amendment'));
  RETURN jsonb_build_object('previous_occurrence_id', v_previous.id,
    'has_previous', v_previous.id IS NOT NULL OR v_legacy_base,
    'previous_completed', v_completed,
    'can_attest', v_previous.id IS NULL AND v_legacy_base OR v_previous.legacy_completion_attestation_allowed,
    'tasks', v_tasks);
END;
$$;
REVOKE ALL ON FUNCTION public.get_additional_amendment_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_additional_amendment_context(uuid) TO authenticated;
