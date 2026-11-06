-- Add tasks without changing existing assignments, including any already approved.
CREATE FUNCTION public.add_amendment_round_tasks(
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
  IF NOT EXISTS (SELECT 1 FROM public.work_assignments wa WHERE wa.amendment_occurrence_id = v_occurrence
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
REVOKE ALL ON FUNCTION public.add_amendment_round_tasks(uuid, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_amendment_round_tasks(uuid, integer, text, jsonb) TO authenticated;

-- A pencil save must still refer to the round/version that the user opened.
CREATE FUNCTION public.correct_amendment_round_task(
  p_request_id uuid, p_expected_version integer, p_assignment_id uuid,
  p_category_type_id uuid, p_task_type_id uuid, p_tailor_id uuid, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_occurrence uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  SELECT * INTO v_request FROM public.work_change_requests WHERE id = p_request_id
    AND organization_id = v_org AND kind = 'AMENDMENT' AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment round not found'; END IF;
  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'This round changed. Refresh and try again';
  END IF;
  SELECT id INTO v_occurrence FROM public.amendment_occurrences WHERE organization_id = v_org
    AND item_id = v_request.item_id ORDER BY ordinal DESC LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.work_assignments wa JOIN public.amendment_occurrences ao ON ao.id = wa.amendment_occurrence_id
    WHERE wa.id = p_assignment_id AND wa.organization_id = v_org AND ao.organization_id = v_org
      AND ao.request_id = p_request_id AND ao.id = v_occurrence) THEN
    RAISE EXCEPTION 'Only assignments in the current round can be edited';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.items WHERE id = v_request.item_id AND organization_id = v_org
    AND status::text NOT IN ('ARCHIVED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'Garment is no longer eligible';
  END IF;
  RETURN public.correct_work_assignment(p_assignment_id, p_category_type_id, p_task_type_id, p_tailor_id, p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.correct_amendment_round_task(uuid, integer, uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_amendment_round_task(uuid, integer, uuid, uuid, uuid, uuid, text) TO authenticated;
