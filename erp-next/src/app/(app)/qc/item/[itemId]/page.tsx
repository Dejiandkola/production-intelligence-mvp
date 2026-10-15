import { hasPermission } from '@/lib/auth/permissions';
import QcItemClient from './QcItemClient';

export default async function ManageItemTasksPage({ params }: { params: { itemId: string } }) {
    const [canManageQc, canSubmitRequests, canManageCustomerService] = await Promise.all([
        hasPermission('manage_qc'),
        hasPermission('submit_work_requests'),
        hasPermission('manage_customer_service'),
    ]);
    return <QcItemClient canManageQc={canManageQc} canRequestCorrection={canSubmitRequests || canManageCustomerService} itemId={params.itemId} />;
}
