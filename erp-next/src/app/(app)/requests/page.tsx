import { redirect } from 'next/navigation'
import { getUserPermissions } from '@/lib/auth/permissions'
import RequestsClient from './RequestsClient'

export default async function RequestsPage() {
  const { user, permissions } = await getUserPermissions()
  if (!user || (!permissions.includes('submit_work_requests') && !permissions.includes('admin'))) {
    redirect('/unauthorized')
  }
  return <RequestsClient userId={user.id} />
}
