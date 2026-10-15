-- Run after migrations 026-028 in SQL Editor or psql. Read-only checks.
-- This does not exercise mutation paths; use a test organization for those.

DO $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_summary record;
  v_item_id uuid;
  v_history jsonb;
BEGIN
  SELECT p.user_id, p.organization_id INTO v_user_id, v_org_id
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.organization_id = p.organization_id
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions perm ON perm.id = rp.permission_id AND perm.name = 'admin'
  ORDER BY p.user_id LIMIT 1;

  IF v_user_id IS NULL THEN RAISE NOTICE 'Skipped tenant data checks: no Admin profile exists';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    SELECT * INTO v_summary FROM public.get_production_origin_summary();
    IF v_summary.first_pass_backlog + v_summary.replacement_backlog <> (
      SELECT count(*) FROM public.items
      WHERE organization_id = v_org_id
        AND status::text NOT IN ('OUT_OF_PRODUCTION', 'COMPLETED', 'ARCHIVED', 'CANCELLED')
    ) THEN RAISE EXCEPTION 'Backlog origin counts do not reconcile'; END IF;

    IF v_summary.first_pass_completed + v_summary.replacement_completed <> (
      SELECT count(*) FROM public.items
      WHERE organization_id = v_org_id AND status::text IN ('OUT_OF_PRODUCTION', 'COMPLETED')
    ) THEN RAISE EXCEPTION 'Completed origin counts do not reconcile'; END IF;

    SELECT id INTO v_item_id FROM public.items WHERE organization_id = v_org_id LIMIT 1;
    IF v_item_id IS NOT NULL THEN
      v_history := public.get_garment_work_history(v_item_id);
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_history->'items') entry
        WHERE entry->>'id' = v_item_id::text
      ) THEN RAISE EXCEPTION 'Selected garment is missing from its lineage'; END IF;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'work_assignment_corrections_one_pending'
  ) THEN RAISE EXCEPTION 'Pending-correction uniqueness index missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'assignment_disbursements'
  ) THEN RAISE EXCEPTION 'Disbursement ledger missing'; END IF;

  IF has_table_privilege('authenticated', 'public.work_assignment_corrections', 'INSERT')
    OR has_table_privilege('authenticated', 'public.assignment_disbursements', 'INSERT') THEN
    RAISE EXCEPTION 'Browser clients must not insert correction or payment records directly';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.work_assignments'::regclass
      AND tgname = 'prevent_approved_work_assignment_delete'
      AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Approved-assignment delete guard missing'; END IF;

  RAISE NOTICE 'Read-only work change checks passed';
END;
$$;
