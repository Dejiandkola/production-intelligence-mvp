-- Delete mistaken, uncompleted assignments. Keep only the immutable request audit.
-- Run directly after 040. No cancellation migration or cancellation columns are needed.
ALTER TABLE public.work_change_requests DROP CONSTRAINT IF EXISTS work_change_requests_proposed_assignments_check;
ALTER TABLE public.work_change_requests ADD CONSTRAINT work_change_requests_proposed_assignments_check CHECK (
  jsonb_typeof(proposed_assignments) = 'array' AND jsonb_array_length(proposed_assignments) <= 20
  AND (jsonb_array_length(proposed_assignments) >= 1 OR (kind = 'AMENDMENT' AND status = 'APPROVED'))
);

CREATE OR REPLACE FUNCTION public.prevent_approved_work_assignment_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF OLD.amendment_occurrence_id IS NOT NULL THEN
    SELECT request_id INTO v_request_id FROM public.amendment_occurrences
    WHERE id = OLD.amendment_occurrence_id AND organization_id = OLD.organization_id;
    IF auth.uid() IS NOT NULL AND OLD.amendment_completed_at IS NULL
      AND OLD.status::text = 'CREATED'
      AND (public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service') OR public.has_permission('admin'))
      AND NOT EXISTS (SELECT 1 FROM public.assignment_disbursements WHERE assignment_id = OLD.id)
      AND EXISTS (SELECT 1 FROM public.work_change_request_revisions r
        WHERE r.request_id = v_request_id AND r.organization_id = OLD.organization_id
          AND r.actor_user_id = auth.uid() AND r.created_at >= transaction_timestamp()
          AND r.after_state->>'action' = 'DELETED' AND r.after_state->>'assignment_id' = OLD.id::text
          AND r.before_state->'assignment' = to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Amendment assignments must be deleted through the audited deletion workflow';
  END IF;
  IF EXISTS (SELECT 1 FROM public.items WHERE id = OLD.item_id
    AND organization_id = OLD.organization_id AND approved_work_change_request_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Approved request tasks cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.delete_amendment_assignment(
  p_request_id uuid, p_expected_version integer, p_assignment_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_assignment public.work_assignments%ROWTYPE;
  v_occurrence uuid;
  v_proposal jsonb;
  v_corrections jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A deletion reason is required';
  END IF;
  SELECT * INTO v_request FROM public.work_change_requests WHERE id = p_request_id
    AND organization_id = v_org AND kind = 'AMENDMENT' AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment round not found'; END IF;
  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'This round changed. Refresh and try again';
  END IF;
  SELECT id INTO v_occurrence FROM public.amendment_occurrences WHERE organization_id = v_org
    AND item_id = v_request.item_id ORDER BY ordinal DESC LIMIT 1;
  SELECT wa.* INTO v_assignment FROM public.work_assignments wa
  JOIN public.amendment_occurrences ao ON ao.id = wa.amendment_occurrence_id AND ao.organization_id = wa.organization_id
  WHERE wa.id = p_assignment_id AND wa.organization_id = v_org
    AND ao.request_id = p_request_id AND ao.id = v_occurrence FOR UPDATE OF wa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment is not in the current amendment round'; END IF;
  IF v_assignment.amendment_completed_at IS NOT NULL OR v_assignment.status::text <> 'CREATED' THEN
    RAISE EXCEPTION 'Completed, approved or paid assignments cannot be deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assignment_disbursements WHERE assignment_id = p_assignment_id) THEN
    RAISE EXCEPTION 'Paid assignments cannot be deleted';
  END IF;
  SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO v_proposal
  FROM jsonb_array_elements(v_request.proposed_assignments)
  WHERE (value->>'category_type_id', value->>'task_type_id', value->>'tailor_id') IS DISTINCT FROM
    (v_assignment.category_type_id::text, v_assignment.task_type_id::text, v_assignment.tailor_id::text);
  IF jsonb_array_length(v_request.proposed_assignments) - jsonb_array_length(v_proposal) <> 1 THEN
    RAISE EXCEPTION 'Assignment changed. Refresh and try again';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_corrections
  FROM public.work_assignment_corrections c WHERE assignment_id = p_assignment_id AND organization_id = v_org;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version, actor_user_id, action, before_state, after_state)
  VALUES (p_request_id, v_org, v_request.version + 1, auth.uid(), 'EDITED',
    jsonb_build_object('assignment', to_jsonb(v_assignment), 'corrections', v_corrections,
      'proposed_assignments', v_request.proposed_assignments),
    jsonb_build_object('action', 'DELETED', 'assignment_id', p_assignment_id,
      'reason', btrim(p_reason), 'proposed_assignments', v_proposal));
  DELETE FROM public.work_assignment_corrections WHERE assignment_id = p_assignment_id AND organization_id = v_org;
  DELETE FROM public.work_assignments WHERE id = p_assignment_id AND organization_id = v_org;
  UPDATE public.work_change_requests SET proposed_assignments = v_proposal,
    approved_snapshot = jsonb_set(COALESCE(approved_snapshot, '{}'::jsonb), '{proposed_assignments}', v_proposal),
    version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_amendment_assignment(uuid, integer, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_amendment_assignment(uuid, integer, uuid, text) TO authenticated;

-- An empty round can accept tasks again, but cannot be marked as physically complete.
CREATE OR REPLACE FUNCTION public.add_amendment_round_tasks(
  p_request_id uuid, p_expected_version integer, p_reason text, p_assignments jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_occurrence uuid;
  v_product uuid;
  v_entry jsonb;
  v_added jsonb := '[]'::jsonb;
  v_category uuid;
  v_task uuid;
  v_tailor uuid;
  v_pay record;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A reason for adding tasks is required';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;
  IF jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;
  SELECT * INTO v_request FROM public.work_change_requests WHERE id = p_request_id
    AND organization_id = v_org AND kind = 'AMENDMENT' AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment round not found'; END IF;
  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'This round changed. Refresh and try again';
  END IF;
  SELECT id INTO v_occurrence FROM public.amendment_occurrences WHERE request_id = p_request_id AND organization_id = v_org;
  IF v_occurrence IS NULL OR v_occurrence IS DISTINCT FROM (
    SELECT id FROM public.amendment_occurrences WHERE item_id = v_request.item_id
      AND organization_id = v_org ORDER BY ordinal DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Tasks can only be added to the current round';
  END IF;
  SELECT product_type_id INTO v_product FROM public.items WHERE id = v_request.item_id
    AND organization_id = v_org AND status::text NOT IN ('ARCHIVED', 'CANCELLED');
  IF NOT FOUND THEN RAISE EXCEPTION 'Garment is no longer eligible'; END IF;
  PERFORM id FROM public.work_assignments WHERE amendment_occurrence_id = v_occurrence
    AND organization_id = v_org ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.work_assignments WHERE amendment_occurrence_id = v_occurrence
    AND organization_id = v_org)
    AND NOT EXISTS (SELECT 1 FROM public.work_assignments wa WHERE wa.amendment_occurrence_id = v_occurrence
    AND wa.organization_id = v_org AND wa.status::text = 'CREATED' AND wa.amendment_completed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.assignment_disbursements d WHERE d.assignment_id = wa.id AND d.organization_id = v_org)) THEN
    RAISE EXCEPTION 'This round is completed or locked. Start a new amendment round';
  END IF;
  IF jsonb_array_length(v_request.proposed_assignments) + jsonb_array_length(p_assignments) > 20 THEN
    RAISE EXCEPTION 'A round can contain at most 20 tasks';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN RAISE EXCEPTION 'Invalid task proposal'; END IF;
    v_category := (v_entry->>'category_type_id')::uuid;
    v_task := (v_entry->>'task_type_id')::uuid;
    v_tailor := (v_entry->>'tailor_id')::uuid;
    IF v_category IS NULL OR v_task IS NULL OR v_tailor IS NULL THEN
      RAISE EXCEPTION 'Category, task and tailor are required';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_request.proposed_assignments || v_added) prior
      WHERE prior.value->>'category_type_id' = v_category::text AND prior.value->>'task_type_id' = v_task::text)
      OR EXISTS (SELECT 1 FROM public.work_assignments WHERE organization_id = v_org
        AND amendment_occurrence_id = v_occurrence AND category_type_id = v_category AND task_type_id = v_task) THEN
      RAISE EXCEPTION 'That task is already assigned to this round';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rate_cards rc
      JOIN public.category_types ct ON ct.id = rc.category_type_id AND ct.organization_id = v_org
      JOIN public.task_types tt ON tt.id = rc.task_type_id AND tt.organization_id = v_org
      JOIN public.tailors t ON t.id = v_tailor AND t.organization_id = v_org AND t.active
      WHERE rc.organization_id = v_org AND rc.product_type_id = v_product AND rc.active
        AND rc.category_type_id = v_category AND rc.task_type_id = v_task AND lower(ct.name) = 'amendment') THEN
      RAISE EXCEPTION 'Task or tailor is no longer available';
    END IF;
    v_added := v_added || jsonb_build_array(jsonb_build_object('category_type_id', v_category,
      'task_type_id', v_task, 'tailor_id', v_tailor));
  END LOOP;
  UPDATE public.work_change_requests SET proposed_assignments = proposed_assignments || v_added,
    approved_snapshot = jsonb_set(COALESCE(approved_snapshot, '{}'::jsonb), '{proposed_assignments}', proposed_assignments || v_added),
    updated_by = auth.uid(), updated_at = now(), version = version + 1 WHERE id = p_request_id;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_added) LOOP
    SELECT * INTO v_pay FROM public.calculate_assignment_pay(v_request.item_id,
      (v_entry->>'category_type_id')::uuid, (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid);
    INSERT INTO public.work_assignments (organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot, rate_snapshot, pay_amount, pay_source)
    VALUES (v_org, v_request.item_id, (v_entry->>'category_type_id')::uuid,
      (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid, v_occurrence,
      'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee,
      CASE WHEN v_pay.special_fee IS NULL THEN 'RATE_CARD' ELSE 'SPECIAL_PAY' END);
  END LOOP;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version, actor_user_id, action, before_state, after_state)
  VALUES (p_request_id, v_org, v_request.version + 1, auth.uid(), 'EDITED',
    jsonb_build_object('proposed_assignments', v_request.proposed_assignments),
    jsonb_build_object('proposed_assignments', v_request.proposed_assignments || v_added, 'reason', btrim(p_reason)));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_additional_amendment_context(p_item_id uuid)
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
    'can_attest', jsonb_array_length(v_tasks) > 0 AND (v_previous.id IS NULL AND v_legacy_base OR v_previous.legacy_completion_attestation_allowed),
    'tasks', v_tasks);
END;
$$;
