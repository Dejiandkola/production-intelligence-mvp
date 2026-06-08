import { getUserPermissions } from '@/lib/auth/permissions';
import CustomerServiceClient from './CustomerServiceClient';

export default async function CustomerServicePage() {
    const { permissions } = await getUserPermissions();
    return <CustomerServiceClient permissions={permissions} />;
}
