-- Let Customer Service submit amendment and replacement requests without
-- replacing their existing role or changing the independent review rule.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name = 'submit_work_requests'
WHERE r.name = 'customer_service'
ON CONFLICT (role_id, permission_id) DO NOTHING;
