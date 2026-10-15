-- Admin-only role assignment for existing users in the current organization.
-- Direct writes to user_roles remain revoked from browser clients.

CREATE OR REPLACE FUNCTION public.set_organization_user_role(
  p_user_id uuid,
  p_role_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := public.current_org_id();
  v_old_role_id uuid;
  v_old_is_admin boolean;
  v_new_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT public.has_permission('admin') THEN
    RAISE EXCEPTION 'Admin permission required';
  END IF;

  -- Serialize role changes so two admins cannot demote each other concurrently.
  PERFORM 1 FROM public.organizations WHERE id = v_org_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'User not found in organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE id = p_role_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Role not found in organization';
  END IF;

  SELECT role_id INTO v_old_role_id
  FROM public.user_roles
  WHERE user_id = p_user_id AND organization_id = v_org_id
  FOR UPDATE;

  IF v_old_role_id = p_role_id THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_old_role_id AND p.name = 'admin'
  ) INTO v_old_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = p_role_id AND p.name = 'admin'
  ) INTO v_new_is_admin;

  IF v_old_is_admin AND NOT v_new_is_admin AND (
    SELECT count(*)
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id AND p.name = 'admin'
    WHERE ur.organization_id = v_org_id
  ) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last Admin';
  END IF;

  INSERT INTO public.user_roles (user_id, organization_id, role_id)
  VALUES (p_user_id, v_org_id, p_role_id)
  ON CONFLICT (user_id, organization_id)
  DO UPDATE SET role_id = EXCLUDED.role_id;

  INSERT INTO public.audit_logs (
    organization_id, actor_user_id, action, table_name, record_id, before, after
  ) VALUES (
    v_org_id, auth.uid(), 'UPDATE', 'user_roles', p_user_id::text,
    jsonb_build_object('role_id', v_old_role_id),
    jsonb_build_object('role_id', p_role_id)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_user_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_organization_user_role(uuid, uuid) TO authenticated;
