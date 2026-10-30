-- Request-capable users can see every request in their organization.
-- Submission, editing, and review permissions remain separate.

DROP POLICY IF EXISTS work_change_requests_read ON public.work_change_requests;

CREATE POLICY work_change_requests_read ON public.work_change_requests
FOR SELECT TO authenticated
USING (
  organization_id = public.current_org_id()
  AND (
    created_by = auth.uid()
    OR public.has_permission('submit_work_requests')
    OR public.has_permission('manage_customer_service')
    OR public.has_permission('admin')
  )
);
