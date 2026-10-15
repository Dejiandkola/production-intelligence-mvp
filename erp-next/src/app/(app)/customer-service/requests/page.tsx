import { redirect } from 'next/navigation'
import { getUserPermissions } from '@/lib/auth/permissions'
import CustomerServiceRequestsClient from './CustomerServiceRequestsClient'

export default async function CustomerServiceRequestsPage() {
  const { user, permissions } = await getUserPermissions()
  if (!user || (!permissions.includes('manage_customer_service') && !permissions.includes('submit_work_requests') && !permissions.includes('admin'))) redirect('/unauthorized')
  return <CustomerServiceRequestsClient userId={user.id} canReview={permissions.includes('manage_customer_service')} />
}
