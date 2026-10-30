-- First amendments are assigned on submission. A Consultant or Customer Service
-- confirms each task after the physical work is done; only then can Accounts pay.
-- Further amendment rounds are intentionally not created by this flow.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, submit.id
FROM public.roles r
JOIN public.role_permissions existing ON existing.role_id = r.id
JOIN public.permissions admin_permission ON admin_permission.id = existing.permission_id
  AND admin_permission.name = 'admin'
JOIN public.permissions submit ON submit.name = 'submit_work_requests'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE FUNCTION public.submit_first_amendment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ordinal integer;
  v_occurrence_id uuid;
  v_entry jsonb;
  v_pay record;
  v_pay_source text;
BEGIN
  IF NEW.kind <> 'AMENDMENT' OR NEW.status <> 'PENDING' THEN
    RETURN NEW;
  END IF;

  IF NOT (public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')) THEN
    RAISE EXCEPTION 'Request permission required';
  END IF;

  -- save_work_change_request locks this item before inserting or editing.
  IF EXISTS (
    SELECT 1 FROM public.work_change_requests r
    WHERE r.organization_id = NEW.organization_id AND r.item_id = NEW.item_id
      AND r.id <> NEW.id AND r.kind = 'AMENDMENT' AND r.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'An amendment request is already pending for this item';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.amendment_occurrences ao
    WHERE ao.organization_id = NEW.organization_id AND ao.item_id = NEW.item_id
  ) OR EXISTS (
    SELECT 1 FROM public.work_assignments wa
    JOIN public.category_types ct ON ct.id = wa.category_type_id
    WHERE wa.organization_id = NEW.organization_id AND wa.item_id = NEW.item_id
      AND wa.amendment_occurrence_id IS NULL AND lower(ct.name) = 'amendment'
  ) THEN
    RAISE EXCEPTION 'This item already has an amendment. Further amendments are not available in this flow';
  END IF;

  v_ordinal := 0;
  INSERT INTO public.amendment_occurrences (organization_id, item_id, request_id, ordinal)
  VALUES (NEW.organization_id, NEW.item_id, NEW.id, v_ordinal)
  RETURNING id INTO v_occurrence_id;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(NEW.proposed_assignments)
  LOOP
    SELECT * INTO v_pay FROM public.calculate_assignment_pay(
      NEW.item_id,
      (v_entry->>'category_type_id')::uuid,
      (v_entry->>'task_type_id')::uuid,
      (v_entry->>'tailor_id')::uuid
    );
    v_pay_source := CASE WHEN v_pay.special_fee IS NOT NULL THEN 'SPECIAL_PAY' ELSE 'RATE_CARD' END;

    INSERT INTO public.work_assignments (
      organization_id, item_id, category_type_id, task_type_id,
      tailor_id, amendment_occurrence_id, status, pay_band_snapshot,
      rate_snapshot, pay_amount, pay_source
    ) VALUES (
      NEW.organization_id, NEW.item_id, (v_entry->>'category_type_id')::uuid,
      (v_entry->>'task_type_id')::uuid, (v_entry->>'tailor_id')::uuid,
      v_occurrence_id, 'CREATED', v_pay.pay_band, v_pay.base_fee,
      v_pay.final_fee, v_pay_source
    );
  END LOOP;

  UPDATE public.work_change_requests
  SET status = 'APPROVED', reviewed_by = NULL, reviewed_at = NULL,
      updated_by = auth.uid(), version = version + 1, updated_at = now(),
      approved_snapshot = jsonb_build_object(
        'kind', kind, 'note', note, 'proposed_assignments', proposed_assignments,
        'target_item_id', item_id, 'amendment_occurrence_id', v_occurrence_id
      )
  WHERE id = NEW.id;

  INSERT INTO public.work_change_request_revisions (
    request_id, organization_id, version, actor_user_id, action,
    before_state, after_state
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.version + 1, auth.uid(), 'ASSIGNED',
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object('status', 'APPROVED', 'amendment_occurrence_id', v_occurrence_id)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER submit_first_amendment
AFTER INSERT OR UPDATE OF kind, proposed_assignments ON public.work_change_requests
FOR EACH ROW EXECUTE FUNCTION public.submit_first_amendment();

CREATE FUNCTION public.set_amendment_task_completion(
  p_assignment_id uuid,
  p_completed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_assignment public.work_assignments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT (
    public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')
  ) THEN
    RAISE EXCEPTION 'Amendment permission required';
  END IF;

  SELECT wa.* INTO v_assignment
  FROM public.work_assignments wa
  JOIN public.amendment_occurrences ao ON ao.id = wa.amendment_occurrence_id
  WHERE wa.id = p_assignment_id AND wa.organization_id = v_org_id
    AND ao.organization_id = v_org_id
  FOR UPDATE OF wa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment task not found';
  END IF;

  IF p_completed IS NULL OR (p_completed AND v_assignment.status::text <> 'CREATED')
    OR (NOT p_completed AND v_assignment.status::text <> 'QC_PASSED') THEN
    RAISE EXCEPTION 'Amendment task status changed. Refresh and try again';
  END IF;

  IF NOT p_completed AND EXISTS (
    SELECT 1 FROM public.assignment_disbursements d
    WHERE d.assignment_id = p_assignment_id AND d.organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Paid work cannot be returned to in progress';
  END IF;

  UPDATE public.work_assignments
  SET status = CASE WHEN p_completed THEN 'QC_PASSED'::public.work_assignment_status
                    ELSE 'CREATED'::public.work_assignment_status END,
      qc_notes = CASE WHEN p_completed THEN 'Completion confirmed by Consultant or Customer Service'
                      ELSE 'Completion confirmation withdrawn' END,
      updated_at = now()
  WHERE id = p_assignment_id AND organization_id = v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_amendment_task_completion(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_amendment_task_completion(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.qc_pass(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_status public.work_assignment_status;
  v_occurrence_id uuid;
BEGIN
  IF NOT public.has_permission('manage_qc') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT status, amendment_occurrence_id INTO v_status, v_occurrence_id
  FROM public.work_assignments
  WHERE id = p_assignment_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work assignment not found';
  END IF;
  IF v_occurrence_id IS NOT NULL THEN
    RAISE EXCEPTION 'Amendment completion is confirmed by Consultant or Customer Service';
  END IF;
  IF v_status NOT IN ('CREATED', 'QC_FAILED') THEN
    RAISE EXCEPTION 'Must be CREATED or QC_FAILED to pass QC';
  END IF;

  UPDATE public.work_assignments SET status = 'QC_PASSED'
  WHERE id = p_assignment_id AND organization_id = v_org_id;
END;
$$;

CREATE FUNCTION public.prevent_ordinary_amendment_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.amendment_occurrence_id IS NULL AND EXISTS (
    SELECT 1 FROM public.category_types ct
    WHERE ct.id = NEW.category_type_id AND lower(ct.name) = 'amendment'
  ) THEN
    RAISE EXCEPTION 'Record amendments through Consultants or Customer Service';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_ordinary_amendment_assignment
BEFORE INSERT ON public.work_assignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_ordinary_amendment_assignment();

-- Existing QC/Production policies permit direct updates. Keep request-backed
-- amendment changes on the audited security-definer workflows instead.
CREATE POLICY work_assignments_amendment_update_via_function
ON public.work_assignments AS RESTRICTIVE FOR UPDATE TO authenticated
USING (amendment_occurrence_id IS NULL)
WITH CHECK (amendment_occurrence_id IS NULL);
