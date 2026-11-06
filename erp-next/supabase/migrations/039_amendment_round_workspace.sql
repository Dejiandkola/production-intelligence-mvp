CREATE FUNCTION public.get_current_amendment_round(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_occurrence public.amendment_occurrences%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  SELECT * INTO v_occurrence FROM public.amendment_occurrences
  WHERE organization_id = v_org AND item_id = p_item_id ORDER BY ordinal DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('id', r.id, 'version', r.version, 'note', r.note,
    'ordinal', v_occurrence.ordinal, 'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('assignment_id', wa.id,
        'category_type_id', wa.category_type_id, 'task_type_id', wa.task_type_id,
        'tailor_id', wa.tailor_id, 'status', wa.status,
        'amendment_completed_at', wa.amendment_completed_at) ORDER BY wa.created_at, wa.id)
      FROM public.work_assignments wa WHERE wa.organization_id = v_org
        AND wa.amendment_occurrence_id = v_occurrence.id), '[]'::jsonb))
  INTO v_result FROM public.work_change_requests r
  WHERE r.id = v_occurrence.request_id AND r.organization_id = v_org AND r.status = 'APPROVED';
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.edit_amendment_round(
  p_request_id uuid, p_expected_version integer, p_note text, p_reason text, p_assignments jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_occurrence uuid;
  v_product uuid;
  v_entry jsonb;
  v_assignment public.work_assignments%ROWTYPE;
  v_pay record;
  v_added jsonb := '[]'::jsonb;
  v_before jsonb;
  v_proposal jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A note and change reason are required';
  END IF;
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;
  IF jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select between 1 and 20 tasks';
  END IF;
  SELECT * INTO v_request FROM public.work_change_requests
  WHERE id = p_request_id AND organization_id = v_org AND kind = 'AMENDMENT' AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment round not found'; END IF;
  IF p_expected_version IS DISTINCT FROM v_request.version THEN
    RAISE EXCEPTION 'This round changed. Refresh and try again';
  END IF;
  SELECT id INTO v_occurrence FROM public.amendment_occurrences
  WHERE request_id = p_request_id AND organization_id = v_org;
  IF v_occurrence IS NULL OR v_occurrence IS DISTINCT FROM (
    SELECT id FROM public.amendment_occurrences WHERE item_id = v_request.item_id
      AND organization_id = v_org ORDER BY ordinal DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Only the current round can be edited';
  END IF;
  SELECT product_type_id INTO v_product FROM public.items
  WHERE id = v_request.item_id AND organization_id = v_org AND status::text NOT IN ('ARCHIVED', 'CANCELLED');
  IF NOT FOUND THEN RAISE EXCEPTION 'Garment is no longer eligible'; END IF;
  PERFORM id FROM public.work_assignments WHERE amendment_occurrence_id = v_occurrence
    AND organization_id = v_org ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.work_assignments wa WHERE wa.amendment_occurrence_id = v_occurrence
    AND wa.organization_id = v_org AND (wa.status::text <> 'CREATED' OR wa.amendment_completed_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.assignment_disbursements d WHERE d.assignment_id = wa.id AND d.organization_id = v_org))) THEN
    RAISE EXCEPTION 'Completed, approved or paid rounds cannot be edited';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_assignments wa WHERE wa.amendment_occurrence_id = v_occurrence
    AND wa.organization_id = v_org AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) e
      WHERE e->>'assignment_id' = wa.id::text)) THEN
    RAISE EXCEPTION 'Existing assignments cannot be removed';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) e GROUP BY e->>'category_type_id', e->>'task_type_id' HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) e WHERE e->>'assignment_id' IS NOT NULL
      GROUP BY e->>'assignment_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Each task may appear only once in the current round';
  END IF;
  v_before := jsonb_build_object('note', v_request.note, 'proposed_assignments', v_request.proposed_assignments);
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    IF jsonb_typeof(v_entry) <> 'object' OR v_entry->>'category_type_id' IS NULL
      OR v_entry->>'task_type_id' IS NULL OR v_entry->>'tailor_id' IS NULL THEN
      RAISE EXCEPTION 'Category, task and tailor are required';
    END IF;
    IF v_entry->>'assignment_id' IS NOT NULL THEN
      SELECT * INTO v_assignment FROM public.work_assignments WHERE id = (v_entry->>'assignment_id')::uuid
        AND organization_id = v_org AND amendment_occurrence_id = v_occurrence;
      IF NOT FOUND THEN RAISE EXCEPTION 'Assignment does not belong to this round'; END IF;
      IF (v_assignment.category_type_id, v_assignment.task_type_id, v_assignment.tailor_id) IS DISTINCT FROM
        ((v_entry->>'category_type_id')::uuid, (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid) THEN
        PERFORM public.correct_work_assignment(v_assignment.id, (v_entry->>'category_type_id')::uuid,
          (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid, p_reason);
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.rate_cards rc
        JOIN public.category_types ct ON ct.id = rc.category_type_id AND ct.organization_id = v_org
        JOIN public.task_types tt ON tt.id = rc.task_type_id AND tt.organization_id = v_org
        JOIN public.tailors t ON t.id = (v_entry->>'tailor_id')::uuid AND t.organization_id = v_org AND t.active
        WHERE rc.organization_id = v_org AND rc.product_type_id = v_product AND rc.active
          AND rc.category_type_id = (v_entry->>'category_type_id')::uuid
          AND rc.task_type_id = (v_entry->>'task_type_id')::uuid AND lower(ct.name) = 'amendment') THEN
        RAISE EXCEPTION 'Task or tailor is no longer available';
      END IF;
      v_added := v_added || jsonb_build_array(jsonb_build_object('category_type_id', v_entry->>'category_type_id',
        'task_type_id', v_entry->>'task_type_id', 'tailor_id', v_entry->>'tailor_id'));
    END IF;
  END LOOP;
  SELECT proposed_assignments || v_added INTO v_proposal FROM public.work_change_requests WHERE id = p_request_id;
  UPDATE public.work_change_requests SET note = btrim(p_note), proposed_assignments = v_proposal,
    approved_snapshot = COALESCE(approved_snapshot, '{}'::jsonb) || jsonb_build_object('note', btrim(p_note), 'proposed_assignments', v_proposal),
    updated_by = auth.uid(), updated_at = now(), version = version + 1 WHERE id = p_request_id
    RETURNING * INTO v_request;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_added) LOOP
    SELECT * INTO v_pay FROM public.calculate_assignment_pay(v_request.item_id,
      (v_entry->>'category_type_id')::uuid, (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid);
    INSERT INTO public.work_assignments (organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot, rate_snapshot, pay_amount, pay_source)
    VALUES (v_org, v_request.item_id, (v_entry->>'category_type_id')::uuid, (v_entry->>'task_type_id')::uuid,
      (v_entry->>'tailor_id')::uuid, v_occurrence, 'CREATED', v_pay.pay_band, v_pay.base_fee, v_pay.final_fee,
      CASE WHEN v_pay.special_fee IS NULL THEN 'RATE_CARD' ELSE 'SPECIAL_PAY' END);
  END LOOP;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version, actor_user_id, action, before_state, after_state)
  VALUES (p_request_id, v_org, v_request.version, auth.uid(), 'EDITED', v_before,
    jsonb_build_object('note', v_request.note, 'proposed_assignments', v_proposal, 'reason', btrim(p_reason)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_current_amendment_round(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_amendment_round(uuid, integer, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_amendment_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_amendment_round(uuid, integer, text, text, jsonb) TO authenticated;
