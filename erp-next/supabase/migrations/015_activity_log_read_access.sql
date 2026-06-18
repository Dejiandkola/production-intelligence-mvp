-- Migration 015: Read-only activity log access.
--

-- This exposes audit log data to authenticated users in their own
-- organization and ensures the existing audited tables write to audit_logs.

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS actor_user_id uuid;

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS before jsonb;

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS after jsonb;

ALTER TABLE public.audit_logs
ALTER COLUMN record_id TYPE text
USING record_id::text;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS full_name text;

UPDATE public.profiles p
SET
  email = COALESCE(p.email, au.email),
  full_name = COALESCE(
    p.full_name,
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name'
  )
FROM auth.users au
WHERE au.id = p.user_id
  AND (p.email IS NULL OR p.full_name IS NULL);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE '
      UPDATE public.audit_logs
      SET actor_user_id = user_id
      WHERE actor_user_id IS NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'old_data'
  ) THEN
    EXECUTE '
      UPDATE public.audit_logs
      SET before = old_data
      WHERE before IS NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'new_data'
  ) THEN
    EXECUTE '
      UPDATE public.audit_logs
      SET after = new_data
      WHERE after IS NULL
    ';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_record_id text;
  v_before jsonb;
  v_after jsonb;
  v_has_legacy_user_id boolean;
BEGIN
  v_user_id := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
  ELSE
    v_org_id := NEW.organization_id;
  END IF;

  v_record_id := COALESCE(NEW.id::text, OLD.id::text);
  v_before := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE null END;
  v_after := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE null END;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'user_id'
  ) INTO v_has_legacy_user_id;

  IF v_has_legacy_user_id THEN
    EXECUTE '
      INSERT INTO public.audit_logs (
        organization_id, actor_user_id, user_id, action, table_name, record_id, before, after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    '
    USING v_org_id, v_user_id, v_user_id, TG_OP, TG_TABLE_NAME, v_record_id, v_before, v_after;
  ELSE
    INSERT INTO public.audit_logs (
      organization_id, actor_user_id, action, table_name, record_id, before, after
    ) VALUES (
      v_org_id,
      v_user_id,
      TG_OP,
      TG_TABLE_NAME,
      v_record_id,
      v_before,
      v_after
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

DROP POLICY IF EXISTS "audit_logs_select_org" ON public.audit_logs;

CREATE POLICY "audit_logs_select_org"
ON public.audit_logs
FOR SELECT
USING (organization_id = public.current_org_id());

CREATE OR REPLACE FUNCTION public.get_activity_log_entries(
  p_search text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  actor_user_id uuid,
  actor_profile jsonb,
  action text,
  table_name text,
  record_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT
      al.*,
      to_jsonb(p) AS actor_profile
    FROM public.audit_logs al
    LEFT JOIN public.profiles p
      ON p.user_id = al.actor_user_id
      AND p.organization_id = al.organization_id
    WHERE al.organization_id = public.current_org_id()
      AND (p_start_date IS NULL OR al.created_at >= p_start_date)
      AND (p_end_date IS NULL OR al.created_at <= p_end_date)
      AND (
        p_action IS NULL
        OR p_action = ''
        OR al.action = p_action
      )
      AND (
        p_category IS NULL
        OR p_category = ''
        OR p_category = 'all'
        OR (p_category = 'tickets' AND al.table_name = 'tickets')
        OR (p_category = 'items' AND al.table_name = 'items')
        OR (
          p_category = 'payments'
          AND al.table_name = 'work_assignments'
          AND al.action = 'UPDATE'
          AND (
            al.before->>'status' IN ('QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED')
            OR al.after->>'status' IN ('QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED')
          )
        )
        OR (
          p_category = 'production_tasks'
          AND al.table_name = 'work_assignments'
          AND NOT (
            al.action = 'UPDATE'
            AND (
              al.before->>'status' IN ('QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED')
              OR al.after->>'status' IN ('QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED')
            )
          )
        )
        OR (p_category = 'rates' AND al.table_name = 'rate_cards')
        OR (p_category = 'tailors' AND al.table_name = 'tailors')
      )
      AND (
        p_search IS NULL
        OR p_search = ''
        OR al.action ILIKE '%' || p_search || '%'
        OR al.table_name ILIKE '%' || p_search || '%'
        OR al.record_id::text ILIKE '%' || p_search || '%'
        OR al.before::text ILIKE '%' || p_search || '%'
        OR al.after::text ILIKE '%' || p_search || '%'
        OR to_jsonb(p)::text ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS total_count
    FROM filtered
  )
  SELECT
    f.id,
    f.organization_id,
    f.actor_user_id,
    f.actor_profile,
    f.action,
    f.table_name,
    f.record_id,
    f.before,
    f.after,
    f.created_at,
    c.total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT LEAST(GREATEST(p_page_size, 1), 100)
  OFFSET GREATEST(p_page - 1, 0) * LEAST(GREATEST(p_page_size, 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.get_activity_log_entries(text, text, text, timestamptz, timestamptz, integer, integer) TO authenticated;

DROP TRIGGER IF EXISTS audit_tickets ON public.tickets;
CREATE TRIGGER audit_tickets
AFTER INSERT OR UPDATE OR DELETE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_items ON public.items;
CREATE TRIGGER audit_items
AFTER INSERT OR UPDATE OR DELETE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_tailors ON public.tailors;
CREATE TRIGGER audit_tailors
AFTER INSERT OR UPDATE OR DELETE ON public.tailors
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_work_assignments ON public.work_assignments;
CREATE TRIGGER audit_work_assignments
AFTER INSERT OR UPDATE OR DELETE ON public.work_assignments
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_rate_cards ON public.rate_cards;
CREATE TRIGGER audit_rate_cards
AFTER INSERT OR UPDATE OR DELETE ON public.rate_cards
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
