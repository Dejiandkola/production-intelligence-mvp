'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/UI/Modal'
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table'

type Profile = { user_id: string; email: string | null; full_name: string | null }
type Role = { id: string; name: string }
type Assignment = { user_id: string; role_id: string }

export default function UsersClient({
  currentUserId,
  profiles,
  roles,
  assignments,
}: {
  currentUserId: string
  profiles: Profile[]
  roles: Role[]
  assignments: Assignment[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoleId, setInviteRoleId] = useState(roles.find(role => role.name === 'consultant')?.id || roles[0]?.id || '')
  const [inviting, setInviting] = useState(false)
  const roleById = useMemo(() => new Map(roles.map(role => [role.id, role.name])), [roles])
  const assignedRoleByUser = useMemo(() => new Map(assignments.map(row => [row.user_id, row.role_id])), [assignments])
  const visibleProfiles = profiles.filter(profile =>
    `${profile.full_name || ''} ${profile.email || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  )

  async function changeRole(profile: Profile, roleId: string) {
    const oldRoleId = assignedRoleByUser.get(profile.user_id)
    if (oldRoleId === roleId) return
    const label = profile.full_name || profile.email || 'this user'
    const roleName = roleById.get(roleId) || 'the selected role'
    if (!window.confirm(`Assign ${roleName} to ${label}? Their access will change immediately.`)) {
      const select = document.getElementById(`role-${profile.user_id}`) as HTMLSelectElement | null
      if (select) select.value = oldRoleId || ''
      return
    }

    setError('')
    setNotice('')
    setSavingId(profile.user_id)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('set_organization_user_role', {
      p_user_id: profile.user_id,
      p_role_id: roleId,
    })
    setSavingId(null)
    if (rpcError) {
      setError(rpcError.message)
      const select = document.getElementById(`role-${profile.user_id}`) as HTMLSelectElement | null
      if (select) select.value = oldRoleId || ''
      return
    }
    setNotice(`${label} is now ${roleName}.`)
    router.refresh()
  }

  async function inviteUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setInviting(true)
    try {
      const response = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, fullName: inviteName, roleId: inviteRoleId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not invite user.')
      setNotice(result.message)
      setInviteOpen(false)
      setInviteName('')
      setInviteEmail('')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not invite user.')
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-maison-primary">Users</h1>
          <p className="text-sm text-maison-secondary">Manage organization users and roles.</p>
        </div>
        <button type="button" onClick={() => { setError(''); setInviteOpen(true) }} className="inline-flex items-center gap-2 rounded-md bg-maison-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-black">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add User
        </button>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label htmlFor="user-search" className="block text-xs font-semibold text-gray-500">Name or email</label>
        <div className="relative mt-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            id="user-search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search users..."
            className="w-full rounded-md border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
          />
        </div>
      </div>
      {error && !inviteOpen && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      <Modal isOpen={inviteOpen} onClose={() => { if (!inviting) setInviteOpen(false) }} title="Add User" maxWidth="max-w-lg" scrollable>
            <form onSubmit={inviteUser} className="space-y-4">
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <label className="block text-sm font-medium text-maison-secondary">Name
                <input type="text" required maxLength={120} autoFocus value={inviteName} onChange={event => setInviteName(event.target.value)} className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20" />
              </label>
              <label className="block text-sm font-medium text-maison-secondary">Email
                <input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20" />
              </label>
              <label className="block text-sm font-medium text-maison-secondary">Role
                <span className="relative mt-1.5 block">
                  <select required value={inviteRoleId} onChange={event => setInviteRoleId(event.target.value)} className="w-full appearance-none rounded-md border border-gray-200 bg-white py-2 pl-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20">
                    {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" aria-hidden="true" />
                </span>
              </label>
              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                <button type="button" disabled={inviting} onClick={() => setInviteOpen(false)} className="rounded-md px-4 py-2 text-sm text-maison-secondary hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={inviting || !inviteRoleId} className="rounded-md bg-maison-primary px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">{inviting ? 'Sending...' : 'Send Invite'}</button>
              </div>
            </form>
      </Modal>
      <Table headers={['User', 'Email', 'Role']} className="" tableClassName="">
        {visibleProfiles.map(profile => {
          const assignedRoleId = assignedRoleByUser.get(profile.user_id) || ''
          return (
            <TableRow key={profile.user_id} className="" onClick={undefined}>
              <TableCell className="font-medium"><span className="inline-flex items-center gap-2">{profile.full_name || profile.email || 'Unnamed user'}{profile.user_id === currentUserId && <Badge className="" variant="neutral">You</Badge>}</span></TableCell>
              <TableCell className="text-gray-600">{profile.email || 'No email on profile'}</TableCell>
              <TableCell className="">
                <span className="relative block w-44">
                  <select
                    id={`role-${profile.user_id}`}
                    key={assignedRoleId}
                    aria-label={`Role for ${profile.full_name || profile.email || 'user'}`}
                    defaultValue={assignedRoleId}
                    disabled={savingId !== null}
                    onChange={event => void changeRole(profile, event.target.value)}
                    className="w-full appearance-none rounded-md border border-gray-200 bg-white py-2 pl-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                  >
                    {!assignedRoleId && <option value="" disabled>Unassigned</option>}
                    {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" aria-hidden="true" />
                </span>
              </TableCell>
            </TableRow>
          )
        })}
        {visibleProfiles.length === 0 && <TableRow className="" onClick={undefined}><td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-500">No users found.</td></TableRow>}
      </Table>
    </div>
  )
}
