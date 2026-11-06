-- Completion records physical work; Accounts separately approves/rejects it.
ALTER TABLE public.work_assignments
  ADD COLUMN amendment_completed_at timestamptz,
  ADD COLUMN amendment_completed_by uuid REFERENCES auth.users(id);

-- Preserve prior completion. Undo only identifiable automatic approvals,
-- never a recorded payment or an approval carrying a different review note.
UPDATE public.work_assignments wa SET
  amendment_completed_at = wa.updated_at,
  status = CASE WHEN wa.status::text = 'QC_PASSED'
    AND wa.qc_notes = 'Completion confirmed by Consultant or Customer Service'
    AND NOT EXISTS (SELECT 1 FROM public.assignment_disbursements d WHERE d.assignment_id = wa.id)
    THEN 'CREATED'::public.work_assignment_status ELSE wa.status END
WHERE wa.amendment_occurrence_id IS NOT NULL AND wa.status::text = 'QC_PASSED';

CREATE OR REPLACE FUNCTION public.set_amendment_request_completion(p_request_id uuid, p_completed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_occurrence uuid;
  v_task public.work_assignments%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (
    public.has_permission('submit_work_requests') OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')) THEN RAISE EXCEPTION 'Amendment permission required'; END IF;
  IF p_completed IS NULL THEN RAISE EXCEPTION 'Completion status is required'; END IF;
  PERFORM 1 FROM public.work_change_requests
    WHERE id = p_request_id AND organization_id = v_org AND kind = 'AMENDMENT' AND status = 'APPROVED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned amendment request not found'; END IF;
  SELECT id INTO v_occurrence FROM public.amendment_occurrences
    WHERE request_id = p_request_id AND organization_id = v_org;
  FOR v_task IN SELECT * FROM public.work_assignments
    WHERE amendment_occurrence_id = v_occurrence AND organization_id = v_org ORDER BY id FOR UPDATE
  LOOP
    v_count := v_count + 1;
    IF v_task.status::text <> 'CREATED' OR EXISTS (
      SELECT 1 FROM public.assignment_disbursements WHERE assignment_id = v_task.id
    ) THEN RAISE EXCEPTION 'Accounts must reverse its decision before completion can change; paid work is locked'; END IF;
    IF p_completed AND EXISTS (SELECT 1 FROM public.work_assignment_corrections
      WHERE assignment_id = v_task.id AND status = 'PENDING') THEN
      RAISE EXCEPTION 'Resolve pending assignment corrections before confirming completion';
    END IF;
  END LOOP;
  IF v_count = 0 THEN RAISE EXCEPTION 'Amendment has no linked tasks'; END IF;
  UPDATE public.work_assignments SET
    amendment_completed_at = CASE WHEN p_completed THEN COALESCE(amendment_completed_at, now()) ELSE NULL END,
    amendment_completed_by = CASE WHEN p_completed THEN COALESCE(amendment_completed_by, auth.uid()) ELSE NULL END,
    updated_at = now()
  WHERE amendment_occurrence_id = v_occurrence AND organization_id = v_org;
END;
$$;
REVOKE ALL ON FUNCTION public.set_amendment_request_completion(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_amendment_request_completion(uuid, boolean) TO authenticated;

CREATE FUNCTION public.review_amendment_task(p_assignment_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_task public.work_assignments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT (
    public.has_permission('manage_payments') OR public.has_permission('admin')
  ) THEN RAISE EXCEPTION 'Accounts permission required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject', 'reverse') THEN
    RAISE EXCEPTION 'Invalid Accounts decision'; END IF;
  SELECT * INTO v_task FROM public.work_assignments
    WHERE id = p_assignment_id AND organization_id = v_org AND amendment_occurrence_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment task not found'; END IF;
  IF v_task.status::text = 'PAID' OR EXISTS (
    SELECT 1 FROM public.assignment_disbursements WHERE assignment_id = v_task.id
  ) THEN RAISE EXCEPTION 'Paid work cannot be changed'; END IF;
  IF p_action IN ('reject', 'reverse') AND COALESCE(length(btrim(p_reason)), 0) = 0 THEN
    RAISE EXCEPTION 'A reason is required'; END IF;
  IF p_action = 'reverse' THEN
    IF v_task.status::text NOT IN ('QC_PASSED', 'QC_FAILED') THEN
      RAISE EXCEPTION 'Only approved or rejected work can be reversed'; END IF;
    UPDATE public.work_assignments SET status = 'CREATED', reversal_reason = btrim(p_reason), updated_at = now()
      WHERE id = v_task.id;
  ELSE
    IF v_task.status::text <> 'CREATED' OR v_task.amendment_completed_at IS NULL THEN
      RAISE EXCEPTION 'Consultant or Customer Service must confirm completion before Accounts review'; END IF;
    UPDATE public.work_assignments SET
      status = CASE WHEN p_action = 'approve' THEN 'QC_PASSED'::public.work_assignment_status ELSE 'QC_FAILED'::public.work_assignment_status END,
      qc_notes = CASE WHEN p_action = 'approve' THEN 'Approved by Accounts' ELSE btrim(p_reason) END,
      updated_at = now()
    WHERE id = v_task.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_amendment_task(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_amendment_task(uuid, text, text) TO authenticated;

-- Enforce the same boundary for older RPC entry points, including qc_fail.
CREATE FUNCTION public.guard_amendment_accounts_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amendment_occurrence_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('QC_PASSED', 'QC_FAILED') THEN
    IF NEW.amendment_completed_at IS NULL OR auth.uid() IS NULL OR NOT (
      public.has_permission('manage_payments') OR public.has_permission('admin')
    ) THEN RAISE EXCEPTION 'Completed amendment and Accounts permission required'; END IF;
  END IF;
  IF OLD.amendment_completed_at IS NOT NULL AND
    (NEW.category_type_id, NEW.task_type_id, NEW.tailor_id) IS DISTINCT FROM
    (OLD.category_type_id, OLD.task_type_id, OLD.tailor_id) THEN
    RAISE EXCEPTION 'Return amendment to In progress before correcting assignments';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_amendment_accounts_review BEFORE UPDATE ON public.work_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_amendment_accounts_review();

CREATE FUNCTION public.guard_completed_amendment_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.work_assignments WHERE id = NEW.assignment_id
    AND amendment_occurrence_id IS NOT NULL AND amendment_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Return amendment to In progress before requesting a correction';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_completed_amendment_correction BEFORE INSERT ON public.work_assignment_corrections
FOR EACH ROW EXECUTE FUNCTION public.guard_completed_amendment_correction();
REVOKE ALL ON FUNCTION public.guard_amendment_accounts_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_completed_amendment_correction() FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.get_garment_work_history(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_root_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('manage_production')
    OR public.has_permission('manage_qc')
    OR public.has_permission('manage_payments')
    OR public.has_permission('admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT i.id, i.replacement_of_item_id, i.ticket_id, 0 AS depth
    FROM public.items i WHERE i.id = p_item_id AND i.organization_id = v_org_id
    UNION ALL
    SELECT parent.id, parent.replacement_of_item_id, parent.ticket_id, a.depth + 1
    FROM ancestors a
    JOIN public.items parent ON parent.id = a.replacement_of_item_id
      AND parent.organization_id = v_org_id AND parent.ticket_id = a.ticket_id
    WHERE a.depth < 50
  )
  SELECT id INTO v_root_id FROM ancestors ORDER BY depth DESC LIMIT 1;

  IF v_root_id IS NULL THEN
    RAISE EXCEPTION 'Garment not found';
  END IF;

  WITH RECURSIVE lineage AS (
    SELECT i.id, i.replacement_of_item_id, i.ticket_id, 0 AS depth
    FROM public.items i WHERE i.id = v_root_id AND i.organization_id = v_org_id
    UNION ALL
    SELECT child.id, child.replacement_of_item_id, child.ticket_id, l.depth + 1
    FROM lineage l
    JOIN public.items child ON child.replacement_of_item_id = l.id
      AND child.organization_id = v_org_id AND child.ticket_id = l.ticket_id
    WHERE l.depth < 50
  ), item_history AS (
    SELECT jsonb_build_object(
      'id', i.id, 'item_key', i.item_key, 'status', i.status,
      'product_name', pt.name, 'product_type_id', i.product_type_id,
      'replacement_of_item_id', i.replacement_of_item_id,
      'created_at', i.created_at, 'depth', l.depth,
      'request_note', replacement_request.note,
      'amendments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ao.id, 'ordinal', ao.ordinal, 'note', r.note,
          'approved_at', r.reviewed_at
        ) ORDER BY ao.ordinal)
        FROM public.amendment_occurrences ao
        JOIN public.work_change_requests r ON r.id = ao.request_id
        WHERE ao.item_id = i.id AND ao.organization_id = v_org_id
      ), '[]'::jsonb),
      'tasks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', wa.id, 'category', ct.name, 'task', tt.name,
          'category_type_id', wa.category_type_id, 'task_type_id', wa.task_type_id,
          'tailor_id', wa.tailor_id, 'tailor', tailor.name, 'status', wa.status,
          'amendment_completed_at', wa.amendment_completed_at, 'pay_amount', wa.pay_amount, 'amendment_occurrence_id', wa.amendment_occurrence_id,
          'created_at', wa.created_at, 'updated_at', wa.updated_at
        ) ORDER BY wa.created_at, wa.id)
        FROM public.work_assignments wa
        LEFT JOIN public.category_types ct ON ct.id = wa.category_type_id
        LEFT JOIN public.task_types tt ON tt.id = wa.task_type_id
        LEFT JOIN public.tailors tailor ON tailor.id = wa.tailor_id
        WHERE wa.item_id = i.id AND wa.organization_id = v_org_id
      ), '[]'::jsonb)
    ) AS entry, l.depth, i.created_at, i.id
    FROM lineage l
    JOIN public.items i ON i.id = l.id
    JOIN public.product_types pt ON pt.id = i.product_type_id
    LEFT JOIN public.work_change_requests replacement_request
      ON replacement_request.id = i.approved_work_change_request_id
  )
  SELECT jsonb_build_object(
    'root_item_id', v_root_id,
    'items', COALESCE(jsonb_agg(entry ORDER BY depth, created_at, id), '[]'::jsonb)
  ) INTO v_result FROM item_history;

  RETURN v_result;
END;
$$;
