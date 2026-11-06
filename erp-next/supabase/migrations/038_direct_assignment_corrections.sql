-- Pencil edits apply immediately, retaining a correction record for audit.
CREATE FUNCTION public.correct_work_assignment(
  p_assignment_id uuid, p_category_type_id uuid, p_task_type_id uuid,
  p_tailor_id uuid, p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_request_id uuid;
  v_request public.work_change_requests%ROWTYPE;
  v_assignment public.work_assignments%ROWTYPE;
  v_product uuid;
  v_entry jsonb;
  v_proposal jsonb := '[]'::jsonb;
  v_new jsonb;
  v_matches integer := 0;
  v_pay record;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (
    public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service') OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Request permission required';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A correction reason is required';
  END IF;
  SELECT COALESCE(ao.request_id, i.approved_work_change_request_id), i.product_type_id
  INTO v_request_id, v_product
  FROM public.work_assignments wa JOIN public.items i ON i.id = wa.item_id AND i.organization_id = wa.organization_id
  LEFT JOIN public.amendment_occurrences ao ON ao.id = wa.amendment_occurrence_id AND ao.organization_id = wa.organization_id
  WHERE wa.id = p_assignment_id AND wa.organization_id = v_org;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Task is not from an approved request'; END IF;
  -- Match completion's request-first lock order.
  SELECT * INTO v_request FROM public.work_change_requests
  WHERE id = v_request_id AND organization_id = v_org AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved request not found'; END IF;
  SELECT * INTO v_assignment FROM public.work_assignments
  WHERE id = p_assignment_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND OR v_assignment.status::text <> 'CREATED'
    OR v_assignment.amendment_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only unfinished tasks awaiting approval can be edited';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assignment_disbursements
    WHERE assignment_id = p_assignment_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'Paid work cannot be edited';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_assignment_corrections
    WHERE assignment_id = p_assignment_id AND organization_id = v_org AND status = 'PENDING') THEN
    RAISE EXCEPTION 'Resolve the existing pending correction before editing this task';
  END IF;
  IF (p_category_type_id, p_task_type_id, p_tailor_id) IS NOT DISTINCT FROM
    (v_assignment.category_type_id, v_assignment.task_type_id, v_assignment.tailor_id) THEN
    RAISE EXCEPTION 'Choose a different task or tailor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rate_cards rc
    JOIN public.category_types ct ON ct.id = rc.category_type_id AND ct.organization_id = v_org
    JOIN public.task_types tt ON tt.id = rc.task_type_id AND tt.organization_id = v_org
    JOIN public.tailors t ON t.id = p_tailor_id AND t.organization_id = v_org AND t.active
    WHERE rc.organization_id = v_org AND rc.product_type_id = v_product
      AND rc.category_type_id = p_category_type_id AND rc.task_type_id = p_task_type_id
      AND rc.active AND (v_request.kind = 'REPLACEMENT' OR lower(ct.name) = 'amendment')) THEN
    RAISE EXCEPTION 'Task or tailor is no longer available';
  END IF;
  v_new := jsonb_build_object('category_type_id', p_category_type_id,
    'task_type_id', p_task_type_id, 'tailor_id', p_tailor_id);
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_request.proposed_assignments) LOOP
    IF v_entry->>'category_type_id' = v_assignment.category_type_id::text
      AND v_entry->>'task_type_id' = v_assignment.task_type_id::text
      AND v_entry->>'tailor_id' = v_assignment.tailor_id::text THEN
      v_proposal := v_proposal || jsonb_build_array(v_new);
      v_matches := v_matches + 1;
    ELSE
      IF v_entry->>'category_type_id' = p_category_type_id::text AND v_entry->>'task_type_id' = p_task_type_id::text THEN
        RAISE EXCEPTION 'That task already exists in this round';
      END IF;
      v_proposal := v_proposal || jsonb_build_array(v_entry);
    END IF;
  END LOOP;
  IF v_matches <> 1 THEN RAISE EXCEPTION 'Assignment changed. Refresh and try again'; END IF;
  SELECT * INTO v_pay FROM public.calculate_assignment_pay(v_assignment.item_id,
    p_category_type_id, p_task_type_id, p_tailor_id);
  INSERT INTO public.work_assignment_corrections (organization_id, request_id, assignment_id,
    before_assignment, proposed_assignment, note, created_by, status, reviewed_by, reviewed_at)
  VALUES (v_org, v_request_id, p_assignment_id,
    jsonb_build_object('category_type_id', v_assignment.category_type_id,
      'task_type_id', v_assignment.task_type_id, 'tailor_id', v_assignment.tailor_id,
      'pay_amount', v_assignment.pay_amount), v_new, btrim(p_note), auth.uid(), 'APPROVED', auth.uid(), now())
  RETURNING id INTO v_id;
  UPDATE public.work_change_requests SET proposed_assignments = v_proposal,
    approved_snapshot = jsonb_set(COALESCE(approved_snapshot, '{}'::jsonb), '{proposed_assignments}', v_proposal),
    updated_by = auth.uid(), updated_at = now(), version = version + 1 WHERE id = v_request_id;
  UPDATE public.work_assignments SET category_type_id = p_category_type_id,
    task_type_id = p_task_type_id, tailor_id = p_tailor_id,
    pay_band_snapshot = v_pay.pay_band, rate_snapshot = v_pay.base_fee, pay_amount = v_pay.final_fee,
    pay_source = CASE WHEN v_pay.special_fee IS NULL THEN 'RATE_CARD' ELSE 'SPECIAL_PAY' END,
    negotiated_pay_amount = NULL, negotiated_price_note = NULL,
    negotiated_price_set_by = NULL, negotiated_price_set_at = NULL,
    price_review_requested = false, price_review_reason = NULL,
    price_review_requested_by = NULL, price_review_requested_at = NULL,
    price_review_resolved_at = NULL, updated_at = now()
  WHERE id = p_assignment_id;
  UPDATE public.work_assignment_corrections SET applied_at = now() WHERE id = v_id;
  INSERT INTO public.work_change_request_revisions (request_id, organization_id, version,
    actor_user_id, action, before_state, after_state)
  VALUES (v_request_id, v_org, v_request.version + 1, auth.uid(), 'EDITED',
    jsonb_build_object('proposed_assignments', v_request.proposed_assignments),
    jsonb_build_object('proposed_assignments', v_proposal, 'correction_id', v_id));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.correct_work_assignment(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_work_assignment(uuid, uuid, uuid, uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_work_assignment_correction(uuid, uuid, uuid, uuid, text) FROM authenticated;
