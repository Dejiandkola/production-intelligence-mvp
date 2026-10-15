-- Consultant request access. Request tables and RPCs are added separately.
-- This permission grants no existing operational table writes by itself.

INSERT INTO public.permissions (name)
VALUES ('submit_work_requests')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (organization_id, name)
SELECT id, 'consultant'
FROM public.organizations
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name = 'submit_work_requests'
WHERE r.name IN ('consultant', 'Admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
