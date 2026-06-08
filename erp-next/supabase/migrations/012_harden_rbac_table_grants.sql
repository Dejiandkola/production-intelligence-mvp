-- Migration 012: Harden RBAC table grants.
--
-- Normal browser users should be able to read role/permission state through RLS,
-- but they should not have direct table-write grants on RBAC tables.

REVOKE INSERT, UPDATE, DELETE ON public.roles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;
