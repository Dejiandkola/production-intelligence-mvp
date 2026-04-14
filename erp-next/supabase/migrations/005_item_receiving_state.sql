ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS is_received boolean NOT NULL DEFAULT false;

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS received_at timestamp with time zone;

DROP POLICY IF EXISTS "Update items" ON public.items;

CREATE POLICY "Update items" ON public.items
FOR UPDATE
USING (
  organization_id = current_org_id()
  AND (
    public.has_permission('manage_production')
    OR public.has_permission('manage_qc')
    OR public.has_permission('manage_completion')
  )
)
WITH CHECK (
  organization_id = current_org_id()
  AND (
    public.has_permission('manage_production')
    OR public.has_permission('manage_qc')
    OR public.has_permission('manage_completion')
  )
);
