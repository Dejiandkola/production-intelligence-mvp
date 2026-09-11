import { getUserPermissions } from '@/lib/auth/permissions';
import QcTailorWorkClient from './QcTailorWorkClient';

export default async function QcTailorWorkPage() {
    const { permissions } = await getUserPermissions();
    return <QcTailorWorkClient permissions={permissions} />;
}
