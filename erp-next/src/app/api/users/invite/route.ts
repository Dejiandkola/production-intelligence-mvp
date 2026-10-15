import { NextRequest, NextResponse } from 'next/server'
import { getUserPermissions } from '@/lib/auth/permissions'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
  }

  const { user, permissions } = await getUserPermissions()
  if (!user || !permissions.includes('admin')) {
    return NextResponse.json({ error: 'Admin permission required.' }, { status: 403 })
  }

  let input: { email?: unknown; fullName?: unknown; roleId?: unknown }
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
  const roleId = typeof input.roleId === 'string' ? input.roleId : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || !fullName || fullName.length > 120 || !/^[0-9a-f-]{36}$/i.test(roleId)) {
    return NextResponse.json({ error: 'Enter a valid name, email, and role.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()
  if (profileError || !profile) {
    return NextResponse.json({ error: 'Organization not found.' }, { status: 403 })
  }

  const orgId = profile.organization_id
  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id')
    .eq('id', roleId)
    .eq('organization_id', orgId)
    .single()
  if (roleError || !role) {
    return NextResponse.json({ error: 'Role not found in your organization.' }, { status: 400 })
  }

  const { data: existingProfile, error: existingError } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('organization_id', orgId)
    .ilike('email', email)
    .maybeSingle()
  if (existingError) {
    return NextResponse.json({ error: 'Could not check existing users.' }, { status: 500 })
  }
  if (existingProfile) {
    return NextResponse.json({ error: 'This user already belongs to your organization. Assign a role in the list below.' }, { status: 409 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Invitations are not configured on the server.' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data: anyProfile, error: globalLookupError } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()
  if (globalLookupError) {
    return NextResponse.json({ error: 'Could not check existing accounts.' }, { status: 500 })
  }
  if (anyProfile) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${request.nextUrl.origin}/reset-password`,
  })
  if (inviteError || !invited.user) {
    return NextResponse.json({ error: inviteError?.message || 'Could not send invitation.' }, { status: 400 })
  }

  const invitedUserId = invited.user.id
  const { data: existingInvitedProfile, error: lookupError } = await admin
    .from('profiles')
    .select('organization_id')
    .eq('user_id', invitedUserId)
    .maybeSingle()
  if (lookupError || (existingInvitedProfile && existingInvitedProfile.organization_id !== orgId)) {
    return NextResponse.json({ error: 'Invitation sent, but this account could not be linked. Contact an administrator before the invitee signs in.' }, { status: 500 })
  }

  const { error: linkError } = await admin.from('profiles').upsert({
    user_id: invitedUserId,
    organization_id: orgId,
    email,
    full_name: fullName,
  }, { onConflict: 'user_id' })
  if (linkError) {
    return NextResponse.json({ error: 'Invitation sent, but the profile could not be linked. Contact an administrator before the invitee signs in.' }, { status: 500 })
  }

  const { error: assignmentError } = await admin.from('user_roles').upsert({
    user_id: invitedUserId,
    organization_id: orgId,
    role_id: roleId,
  }, { onConflict: 'user_id,organization_id' })
  if (assignmentError) {
    return NextResponse.json({ error: 'Invitation sent, but the role could not be assigned. Assign a role in Users before the invitee signs in.' }, { status: 500 })
  }

  return NextResponse.json({ message: `Invitation sent to ${email}.` }, { status: 201 })
}
