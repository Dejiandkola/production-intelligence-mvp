import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/auth/permissions'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
    const canManageSettings = await hasPermission('admin')

    if (!canManageSettings) {
        redirect('/unauthorized')
    }

    return <SettingsClient />
}
