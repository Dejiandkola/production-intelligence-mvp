-- Migration 020: Read-only tailor work and pay portal.
--
-- Tailors authenticate with a private link token and a six-digit PIN. Plaintext
-- credentials are returned once when generated and are never stored.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tailor_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tailor_id uuid NOT NULL REFERENCES public.tailors(id) ON DELETE CASCADE,
  link_token_hash text NOT NULL UNIQUE,
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  last_accessed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, tailor_id)
);

CREATE TABLE IF NOT EXISTS public.tailor_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL REFERENCES public.tailor_portal_access(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tailor_portal_sessions_access_id_idx
ON public.tailor_portal_sessions (access_id);

CREATE INDEX IF NOT EXISTS work_assignments_tailor_updated_at_idx
ON public.work_assignments (tailor_id, updated_at DESC);

ALTER TABLE public.tailor_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tailor_portal_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tailor_portal_access FROM anon, authenticated;
REVOKE ALL ON public.tailor_portal_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_tailor_portal_access(p_tailor_id uuid)
RETURNS TABLE (access_token text, pin text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org_id uuid;
  v_access_id uuid;
  v_access_token text;
  v_pin text;
  v_pin_bytes bytea;
BEGIN
  v_org_id := public.current_org_id();

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('manage_tailors') THEN
    RAISE EXCEPTION 'Requires manage_tailors permission';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tailors t
    WHERE t.id = p_tailor_id
      AND t.organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Tailor not found';
  END IF;

  v_access_token := encode(gen_random_bytes(32), 'hex');
  v_pin_bytes := gen_random_bytes(3);
  v_pin := lpad((
    (
      get_byte(v_pin_bytes, 0) * 65536
      + get_byte(v_pin_bytes, 1) * 256
      + get_byte(v_pin_bytes, 2)
    ) % 1000000
  )::text, 6, '0');

  INSERT INTO public.tailor_portal_access (
    organization_id,
    tailor_id,
    link_token_hash,
    pin_hash,
    is_active,
    failed_attempts,
    locked_until,
    last_accessed_at,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_org_id,
    p_tailor_id,
    encode(digest(v_access_token, 'sha256'), 'hex'),
    crypt(v_pin, gen_salt('bf', 10)),
    true,
    0,
    null,
    null,
    auth.uid(),
    now(),
    now()
  )
  ON CONFLICT (organization_id, tailor_id)
  DO UPDATE SET
    link_token_hash = EXCLUDED.link_token_hash,
    pin_hash = EXCLUDED.pin_hash,
    is_active = true,
    failed_attempts = 0,
    locked_until = null,
    last_accessed_at = null,
    created_by = auth.uid(),
    created_at = now(),
    updated_at = now()
  RETURNING id INTO v_access_id;

  DELETE FROM public.tailor_portal_sessions
  WHERE access_id = v_access_id;

  RETURN QUERY SELECT v_access_token, v_pin;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tailor_portal_access_status(p_tailor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  v_org_id := public.current_org_id();

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('manage_tailors') THEN
    RAISE EXCEPTION 'Requires manage_tailors permission';
  END IF;

  SELECT jsonb_build_object(
    'exists', true,
    'is_active', tpa.is_active,
    'created_at', tpa.created_at,
    'last_accessed_at', tpa.last_accessed_at,
    'locked_until', tpa.locked_until
  )
  INTO v_result
  FROM public.tailor_portal_access tpa
  WHERE tpa.tailor_id = p_tailor_id
    AND tpa.organization_id = v_org_id;

  RETURN COALESCE(v_result, jsonb_build_object('exists', false, 'is_active', false));
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_tailor_portal_access(p_tailor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_access_id uuid;
BEGIN
  v_org_id := public.current_org_id();

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('manage_tailors') THEN
    RAISE EXCEPTION 'Requires manage_tailors permission';
  END IF;

  UPDATE public.tailor_portal_access
  SET is_active = false,
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  WHERE tailor_id = p_tailor_id
    AND organization_id = v_org_id
  RETURNING id INTO v_access_id;

  IF v_access_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.tailor_portal_sessions
  WHERE access_id = v_access_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.authenticate_tailor_portal(
  p_access_token text,
  p_pin text
)
RETURNS TABLE (
  session_token text,
  tailor_name text,
  expires_at timestamptz,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_access public.tailor_portal_access%ROWTYPE;
  v_tailor_name text;
  v_session_token text;
  v_expires_at timestamptz;
  v_failed_attempts integer;
BEGIN
  IF p_access_token IS NULL OR length(p_access_token) < 32 OR p_pin !~ '^\d{6}$' THEN
    RETURN QUERY SELECT null::text, null::text, null::timestamptz, 'INVALID_CREDENTIALS'::text;
    RETURN;
  END IF;

  SELECT tpa.*
  INTO v_access
  FROM public.tailor_portal_access tpa
  WHERE tpa.link_token_hash = encode(digest(p_access_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND OR NOT v_access.is_active THEN
    RETURN QUERY SELECT null::text, null::text, null::timestamptz, 'INVALID_CREDENTIALS'::text;
    RETURN;
  END IF;

  IF v_access.locked_until IS NOT NULL AND v_access.locked_until > now() THEN
    RETURN QUERY SELECT null::text, null::text, v_access.locked_until, 'LOCKED'::text;
    RETURN;
  END IF;

  IF crypt(p_pin, v_access.pin_hash) <> v_access.pin_hash THEN
    v_failed_attempts := CASE
      WHEN v_access.locked_until IS NOT NULL AND v_access.locked_until <= now() THEN 1
      ELSE v_access.failed_attempts + 1
    END;

    UPDATE public.tailor_portal_access
    SET failed_attempts = v_failed_attempts,
        locked_until = CASE WHEN v_failed_attempts >= 5 THEN now() + interval '15 minutes' ELSE null END,
        updated_at = now()
    WHERE id = v_access.id;

    RETURN QUERY SELECT
      null::text,
      null::text,
      CASE WHEN v_failed_attempts >= 5 THEN now() + interval '15 minutes' ELSE null END,
      CASE WHEN v_failed_attempts >= 5 THEN 'LOCKED' ELSE 'INVALID_CREDENTIALS' END::text;
    RETURN;
  END IF;

  SELECT t.name
  INTO v_tailor_name
  FROM public.tailors t
  WHERE t.id = v_access.tailor_id
    AND t.organization_id = v_access.organization_id;

  IF v_tailor_name IS NULL THEN
    RETURN QUERY SELECT null::text, null::text, null::timestamptz, 'INVALID_CREDENTIALS'::text;
    RETURN;
  END IF;

  v_session_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '7 days';

  DELETE FROM public.tailor_portal_sessions AS tps
  WHERE tps.access_id = v_access.id
    AND tps.expires_at <= now();

  INSERT INTO public.tailor_portal_sessions (access_id, session_token_hash, expires_at)
  VALUES (v_access.id, encode(digest(v_session_token, 'sha256'), 'hex'), v_expires_at);

  UPDATE public.tailor_portal_access
  SET failed_attempts = 0,
      locked_until = null,
      last_accessed_at = now(),
      updated_at = now()
  WHERE id = v_access.id;

  RETURN QUERY SELECT v_session_token, v_tailor_name, v_expires_at, null::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tailor_portal_work(
  p_session_token text,
  p_status text DEFAULT 'all',
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_access_id uuid;
  v_tailor_id uuid;
  v_tailor_name text;
  v_department text;
  v_result jsonb;
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) < 32 THEN
    RETURN jsonb_build_object('error_code', 'SESSION_EXPIRED');
  END IF;

  SELECT tpa.id, tpa.tailor_id, t.name, t.department
  INTO v_access_id, v_tailor_id, v_tailor_name, v_department
  FROM public.tailor_portal_sessions tps
  JOIN public.tailor_portal_access tpa ON tpa.id = tps.access_id
  JOIN public.tailors t ON t.id = tpa.tailor_id
    AND t.organization_id = tpa.organization_id
  WHERE tps.session_token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    AND tps.expires_at > now()
    AND tpa.is_active = true;

  IF v_access_id IS NULL THEN
    RETURN jsonb_build_object('error_code', 'SESSION_EXPIRED');
  END IF;

  UPDATE public.tailor_portal_sessions
  SET last_used_at = now()
  WHERE session_token_hash = encode(digest(p_session_token, 'sha256'), 'hex');

  WITH period_work AS (
    SELECT wa.*
    FROM public.work_assignments wa
    WHERE wa.tailor_id = v_tailor_id
      AND (p_start_date IS NULL OR wa.updated_at >= p_start_date::timestamptz)
      AND (p_end_date IS NULL OR wa.updated_at < (p_end_date + 1)::timestamptz)
  ),
  filtered_work AS (
    SELECT pw.*
    FROM period_work pw
    WHERE COALESCE(p_status, 'all') = 'all'
      OR (p_status = 'assigned' AND pw.status::text = 'CREATED')
      OR (p_status = 'approved' AND pw.status::text = 'QC_PASSED')
      OR (p_status = 'paid' AND pw.status::text = 'PAID')
      OR (p_status = 'rejected' AND pw.status::text = 'QC_FAILED')
      OR (p_status = 'reversed' AND pw.status::text = 'REVERSED')
  ),
  totals AS (
    SELECT
      COALESCE(SUM(pay_amount) FILTER (WHERE status::text IN ('QC_PASSED', 'PAID')), 0) AS earned_total,
      COALESCE(SUM(pay_amount) FILTER (WHERE status::text = 'QC_PASSED'), 0) AS approved_total,
      COALESCE(SUM(pay_amount) FILTER (WHERE status::text = 'PAID'), 0) AS paid_total,
      COUNT(*) FILTER (WHERE status::text = 'CREATED') AS assigned_count,
      COUNT(*) FILTER (WHERE status::text = 'QC_FAILED') AS rejected_count
    FROM period_work
  ),
  counted AS (
    SELECT COUNT(*) AS total_count FROM filtered_work
  ),
  entries AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', fw.id,
        'item_reference', i.item_key,
        'task_name', tt.name,
        'category_name', ct.name,
        'status', fw.status,
        'pay_amount', fw.pay_amount,
        'updated_at', fw.updated_at
      )
      ORDER BY fw.updated_at DESC, fw.id DESC
    ) AS rows
    FROM (
      SELECT *
      FROM filtered_work
      ORDER BY updated_at DESC, id DESC
      LIMIT LEAST(GREATEST(p_page_size, 1), 100)
      OFFSET GREATEST(p_page - 1, 0) * LEAST(GREATEST(p_page_size, 1), 100)
    ) fw
    LEFT JOIN public.items i ON i.id = fw.item_id
    LEFT JOIN public.task_types tt ON tt.id = fw.task_type_id
    LEFT JOIN public.category_types ct ON ct.id = fw.category_type_id
  )
  SELECT jsonb_build_object(
    'tailor', jsonb_build_object('name', v_tailor_name, 'department', v_department),
    'summary', jsonb_build_object(
      'earned_total', totals.earned_total,
      'approved_total', totals.approved_total,
      'paid_total', totals.paid_total,
      'assigned_count', totals.assigned_count,
      'rejected_count', totals.rejected_count
    ),
    'entries', COALESCE(entries.rows, '[]'::jsonb),
    'total_count', counted.total_count,
    'page', GREATEST(p_page, 1),
    'page_size', LEAST(GREATEST(p_page_size, 1), 100)
  )
  INTO v_result
  FROM totals
  CROSS JOIN counted
  CROSS JOIN entries;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_tailor_portal_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tailor_portal_access_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_tailor_portal_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authenticate_tailor_portal(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tailor_portal_work(text, text, date, date, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_tailor_portal_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tailor_portal_access_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_tailor_portal_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_tailor_portal(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tailor_portal_work(text, text, date, date, integer, integer) TO anon, authenticated;
