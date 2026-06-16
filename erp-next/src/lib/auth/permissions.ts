import { createClient } from '../supabase/server'

export async function getUserPermissions() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { user: null, permissions: [] as string[] }
  }

  // Identify active organization (for MVP, we assume the first/only org the user belongs to)
  const { data: orgData } = await supabase
    .from('user_roles')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!orgData) {
    return { user, permissions: [] as string[] }
  }

  // Get permissions from DB strictly scoped to that organization
  const { data, error } = await supabase
    .from('user_roles')
    .select(`
      role_id,
      roles (
        role_permissions (
          permissions (name)
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('organization_id', orgData.organization_id)
    .single()

  if (error || !data || !data.roles) {
    return { user, permissions: [] as string[] }
  }

  // Define typing ad-hoc
  type RolePermsRow = { permissions: { name: string } | null };
  type RolesPayload = { role_permissions?: RolePermsRow[] };
  const roles = data.roles as RolesPayload;
  const rp = roles.role_permissions || [];
  const permissions: string[] = rp
    .map(item => item.permissions?.name)
    .filter((name): name is string => Boolean(name));

  return { user, permissions }
}

export async function hasPermission(permissionName: string) {
  const { permissions } = await getUserPermissions()
  return permissions.includes(permissionName)
}
