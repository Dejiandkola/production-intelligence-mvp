-- Confirm or withdraw completion for all tasks in one amendment round atomically.
CREATE FUNCTION public.set_amendment_request_completion(
  p_request_id uuid,
  p_completed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_request public.work_change_requests%ROWTYPE;
  v_occurrence_id uuid;
  v_assignment public.work_assignments%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')
  ) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;

  IF p_completed IS NULL THEN
    RAISE EXCEPTION 'Completion status is required';
  END IF;

  SELECT * INTO v_request FROM public.work_change_requests
  WHERE id = p_request_id AND organization_id = v_org_id
    AND kind = 'AMENDMENT' AND status = 'APPROVED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved amendment request not found';
  END IF;

  SELECT id INTO v_occurrence_id FROM public.amendment_occurrences
  WHERE request_id = p_request_id AND organization_id = v_org_id;
  IF v_occurrence_id IS NULL THEN
    RAISE EXCEPTION 'Amendment tasks are not linked to this request';
  END IF;

  FOR v_assignment IN
    SELECT * FROM public.work_assignments
    WHERE amendment_occurrence_id = v_occurrence_id AND organization_id = v_org_id
    ORDER BY id FOR UPDATE
  LOOP
    v_count := v_count + 1;
    IF v_assignment.status::text NOT IN ('CREATED', 'QC_PASSED') THEN
      RAISE EXCEPTION 'Amendment has a paid or otherwise locked task';
    END IF;
    IF NOT p_completed AND EXISTS (
      SELECT 1 FROM public.assignment_disbursements d
      WHERE d.assignment_id = v_assignment.id AND d.organization_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'Paid work cannot be returned to in progress';
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Amendment has no linked tasks';
  END IF;

  UPDATE public.work_assignments
  SET status = CASE WHEN p_completed THEN 'QC_PASSED'::public.work_assignment_status
                    ELSE 'CREATED'::public.work_assignment_status END,
      qc_notes = CASE WHEN p_completed THEN 'Completion confirmed by Consultant or Customer Service'
                      ELSE 'Completion confirmation withdrawn' END,
      updated_at = now()
  WHERE amendment_occurrence_id = v_occurrence_id AND organization_id = v_org_id
    AND status::text IS DISTINCT FROM CASE WHEN p_completed THEN 'QC_PASSED' ELSE 'CREATED' END;
END;
$$;

REVOKE ALL ON FUNCTION public.set_amendment_request_completion(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_amendment_request_completion(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_amendment_task_completion(uuid, boolean) FROM authenticated;
