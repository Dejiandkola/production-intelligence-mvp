import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  if (!(await hasPermission('admin'))) redirect('/unauthorized')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !profile) redirect('/unauthorized')

  const orgId = profile.organization_id
  const [profilesResult, rolesResult, assignmentsResult] = await Promise.all([
    supabase.from('profiles').select('user_id, email, full_name').eq('organization_id', orgId).order('full_name'),
    supabase.from('roles').select('id, name').eq('organization_id', orgId).order('name'),
    supabase.from('user_roles').select('user_id, role_id').eq('organization_id', orgId),
  ])

  const error = profilesResult.error || rolesResult.error || assignmentsResult.error
  if (error) {
    return <p role="alert" className="text-red-700">Could not load users: {error.message}</p>
  }

  return (
    <UsersClient
      currentUserId={user.id}
      profiles={profilesResult.data || []}
      roles={rolesResult.data || []}
      assignments={assignmentsResult.data || []}
    />
  )
}
