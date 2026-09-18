-- One-time bulk credential generator for active tailors.
--
-- 1. Find the intended organization ID:
--      SELECT id, name FROM public.organizations ORDER BY name;
-- 2. Replace REPLACE_WITH_ORGANIZATION_ID in the final SELECT.
-- 3. Run the complete script and immediately copy the result table.
--
-- Running this again rotates every active tailor's link and PIN and invalidates
-- all of their existing portal sessions. Plaintext credentials are not stored.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION pg_temp.generate_active_tailor_portal_credentials(
  p_organization_id uuid,
  p_base_url text
)
RETURNS TABLE (
  tailor_name text,
  portal_url text,
  pin text
)
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tailor record;
  v_access_id uuid;
  v_access_token text;
  v_pin text;
  v_pin_bytes bytea;
  v_base_url text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  v_base_url := rtrim(trim(p_base_url), '/');

  IF v_base_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'A valid HTTPS base URL is required';
  END IF;

  FOR v_tailor IN
    SELECT t.id, t.name
    FROM public.tailors t
    WHERE t.organization_id = p_organization_id
      AND t.active = true
    ORDER BY t.name, t.id
  LOOP
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
      p_organization_id,
      v_tailor.id,
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

    tailor_name := v_tailor.name;
    portal_url := v_base_url || '/tailor-access/' || v_access_token;
    pin := v_pin;
    RETURN NEXT;
  END LOOP;
END;
$$;

SELECT tailor_name, portal_url, pin
FROM pg_temp.generate_active_tailor_portal_credentials(
  'REPLACE_WITH_ORGANIZATION_ID'::uuid,
  'https://erp.dejiandkola.com/'
);
