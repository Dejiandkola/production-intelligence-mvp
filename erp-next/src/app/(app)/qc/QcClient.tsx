// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { Modal } from '@/components/UI/Modal';
import { format } from 'date-fns';
import { Search, FilterX, ChevronDown, Download } from 'lucide-react';
import ManageItemTasks from './item/[itemId]/QcItemClient';
import { hasPerm } from '@/lib/permissions';

const QC_PAGE_SIZE = 50;
const ITEM_STATUS_OPTIONS = ['IN_PRODUCTION', 'OUT_OF_PRODUCTION', 'ARCHIVED'];

export default function QCQueue({ permissions = [] }: { permissions?: string[] }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [totalTickets, setTotalTickets] = useState(0);
    const [filter, setFilter] = useState('all'); // all, unassigned, in_progress

    const [filters, setFilters] = useState({
        ticketId: '',
        customerName: '',
        productType: '',
        category: '',
        status: '',
        startDate: '',
        endDate: ''
    });

    const [rateCard, setRateCard] = useState([]);
    const [tailors, setTailors] = useState([]);
    const [productTypes, setProductTypes] = useState([]);
    const [categoryOptions, setCategoryOptions] = useState([]);

    const [selectedItemId, setSelectedItemId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadItems({ reset: true });
    }, [filter, filters]);

    const loadItems = async ({ reset = true } = {}) => {
        const nextPage = reset ? 1 : page + 1;
        if (reset) setLoading(true);
        else setLoadingMore(true);

        try {
            const assignmentFilter = filter === 'all' ? '' : filter;
            const [result, rc, t, productTypesData, categoriesData] = await Promise.all([
                db.getTicketPaginatedItems(filters, nextPage, QC_PAGE_SIZE, { excludeCancelled: true }),
                reset ? db.getRates() : Promise.resolve(rateCard),
                reset ? db.getTailors() : Promise.resolve(tailors),
                reset ? db.getProductTypes() : Promise.resolve(productTypes),
                reset ? db.getCategories() : Promise.resolve(categoryOptions.map(name => ({ name })))
            ]);

            const filteredByAssignment = result.items.filter(item => {
                const assignmentCount = item.work_assignments?.length || 0;
                if (assignmentFilter === 'unassigned') return assignmentCount === 0;
                if (assignmentFilter === 'in_progress') return assignmentCount > 0;
                return true;
            });

            setItems(prev => reset ? filteredByAssignment : [...prev, ...filteredByAssignment]);
            setTotalTickets(result.totalTickets);
            setPage(nextPage);
            if (reset) {
                setRateCard(rc);
                setTailors(t);
                setProductTypes(productTypesData);
                setCategoryOptions(categoriesData.map(category => category.name).filter(Boolean).sort());
            }
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const tabFilteredItems = items;

    const uniqueProductTypes = productTypes.map(productType => productType.name).filter(Boolean);
    const uniqueStatuses = ITEM_STATUS_OPTIONS;
    const uniqueCategories = categoryOptions;

    const filteredItems = tabFilteredItems;

    const canManageQc =
        permissions.includes('manage_qc') ||
        (permissions.length > 0 && hasPerm(permissions, 'manage_qc'));

    const getStatusVariant = (status) => {
        switch (status) {
            case 'IN_PRODUCTION': return 'brand';
            case 'OUT_OF_PRODUCTION': return 'success';
            case 'ARCHIVED': return 'warning';
            default: return 'neutral';
        }
    };

    const getStatusLabel = (status) => {
        if (status === 'IN_PRODUCTION') return 'In Production';
        if (status === 'OUT_OF_PRODUCTION') return 'Out of Production';
        if (status === 'ARCHIVED') return 'Archived';
        return status;
    };

    const getStatusSelectClass = (status) => {
        switch (status) {
            case 'IN_PRODUCTION':
                return 'border-sky-200 bg-sky-50 text-sky-800';
            case 'OUT_OF_PRODUCTION':
                return 'border-emerald-200 bg-emerald-50 text-emerald-800';
            default:
                return 'border-gray-200 bg-white text-gray-700';
        }
    };

    const handleStatusChange = async (itemId, newStatus) => {
        if (!canManageQc) return;
        await db.updateItemStatus(itemId, newStatus);
        await loadItems();
    };

    const handleExport = () => {
        if (filteredItems.length === 0) {
            alert('No items match the current filters.');
            return;
        }

        const headers = ['Item Key', 'Ticket ID', 'Customer Name', 'Product Type', 'Categories', 'Status', 'Assigned Date'];
        const rows = filteredItems.map(item => {
            const assignedCategories = item.work_assignments?.map((wa: any) => wa.category_types?.name).filter(Boolean) || [];
            const categories = [...new Set(assignedCategories)].join('; ');

            return [
                item.item_key || '',
                item.ticket_number || '',
                item.customer_name || '',
                item.product_type_name || '',
                categories,
                getStatusLabel(item.status),
                item.assigned_date ? format(new Date(item.assigned_date), 'yyyy-MM-dd') : ''
            ];
        });

        const escapeCell = (value) => {
            const text = String(value ?? '');
            if (text.includes(',') || text.includes('"') || text.includes('\n')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };

        const csv = [headers, ...rows]
            .map(row => row.map(escapeCell).join(','))
            .join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStamp = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `qc-items-${dateStamp}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const getCategoryBadgeClass = (categoryName) => {
        const normalized = (categoryName || '').trim().toLowerCase();

        if (normalized === 'sewing') return 'bg-sky-50 text-sky-700';
        if (normalized === 'amendment') return 'bg-rose-50 text-rose-700';
        if (normalized === 'laundry') return 'bg-emerald-50 text-emerald-700';

        const palette = [
            'bg-amber-50 text-amber-700',
            'bg-sky-50 text-sky-700',
            'bg-emerald-50 text-emerald-700',
            'bg-rose-50 text-rose-700',
            'bg-violet-50 text-violet-700',
            'bg-orange-50 text-orange-700',
        ];

        const value = (categoryName || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return palette[value % palette.length];
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Quality Control</h1>
                    <p className="text-sm text-maison-secondary">Assign tasks and verify quality</p>
                </div>

                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={handleExport}>
                        <Download size={16} className="mr-2" />
                        Export
                    </Button>
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'all' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            All Items
                        </button>
                        <button
                            onClick={() => setFilter('unassigned')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'unassigned' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            Unassigned
                        </button>
                        <button
                            onClick={() => setFilter('in_progress')}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'in_progress' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            In Progress
                        </button>
                    </div>
                </div>
            </div>

            <Card className="pb-4">
                <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Ticket ID</label>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search ticket..."
                                value={filters.ticketId}
                                onChange={(e) => setFilters(prev => ({ ...prev, ticketId: e.target.value }))}
                                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                        </div>
                    </div>

                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Customer</label>
                        <input
                            type="text"
                            placeholder="Search customer..."
                            value={filters.customerName}
                            onChange={(e) => setFilters(prev => ({ ...prev, customerName: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>

                    <div className="w-full sm:w-auto min-w-[140px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Product Type</label>
                        <select
                            value={filters.productType}
                            onChange={(e) => setFilters(prev => ({ ...prev, productType: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                        >
                            <option value="">All Products</option>
                            {uniqueProductTypes.map(pt => (
                                <option key={pt} value={pt}>{pt}</option>
                            ))}
                        </select>
                    </div>

                    <div className="w-full sm:w-auto min-w-[140px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                        <select
                            value={filters.category}
                            onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                        >
                            <option value="">All Categories</option>
                            {uniqueCategories.map(category => (
                                <option key={category} value={category}>{category}</option>
                            ))}
                        </select>
                    </div>

                    <div className="w-full sm:w-auto min-w-[130px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
                        <select
                            value={filters.status}
                            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                        >
                            <option value="">All Statuses</option>
                            {uniqueStatuses.map(status => (
                                <option key={status} value={status}>{status}</option>
                            ))}
                        </select>
                    </div>

                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Date Range</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                                className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                            />
                            <span className="text-gray-400">-</span>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                                className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                            />
                        </div>
                    </div>

                    <Button
                        variant="ghost"
                        onClick={() =>
                            setFilters({
                                ticketId: '',
                                customerName: '',
                                productType: '',
                                category: '',
                                status: '',
                                startDate: '',
                                endDate: ''
                            })
                        }
                        className="text-gray-500 hover:text-gray-700 bg-gray-50 px-3"
                        title="Clear Filters"
                    >
                        <FilterX size={16} />
                    </Button>
                </div>
            </Card>

            <Card padding="p-0">
                <Table headers={['Item Key', 'Customer Name', 'Product Type', 'Categories', 'Status', 'Assigned Date']}>
                    {filteredItems.map((item) => {
                        const assignedCategories = item.work_assignments?.map((wa: any) => wa.category_types?.name).filter(Boolean) || [];
                        const uniqueCategories = [...new Set(assignedCategories)];

                        return (
                            <TableRow
                                key={item.id}
                                onClick={() => {
                                    setSelectedItemId(item.id);
                                    setIsModalOpen(true);
                                }}
                                className="cursor-pointer hover:bg-gray-50 transition-colors"
                            >
                                <TableCell className="font-medium font-mono text-xs">{item.item_key}</TableCell>
                                <TableCell className="font-medium">{item.customer_name}</TableCell>
                                <TableCell>{item.product_type_name}</TableCell>
                                <TableCell className="whitespace-normal">
                                    {uniqueCategories.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                            {uniqueCategories.map((category) => (
                                                <Badge
                                                    key={category}
                                                    variant="neutral"
                                                    className={getCategoryBadgeClass(category)}
                                                >
                                                    {category}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-gray-300">-</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-2">
                                        {canManageQc && item.status !== 'ARCHIVED' ? (
                                            <div
                                                className="relative min-w-[190px]"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <select
                                                    value={item.status}
                                                    onChange={(e) => handleStatusChange(item.id, e.target.value)}
                                                    className={`w-full appearance-none rounded-xl border px-4 py-2.5 pr-10 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-maison-primary/20 ${getStatusSelectClass(item.status)}`}
                                                >
                                                    <option value="IN_PRODUCTION">In Production</option>
                                                    <option value="OUT_OF_PRODUCTION">Out of Production</option>
                                                </select>
                                                <ChevronDown
                                                    size={16}
                                                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-current opacity-70"
                                                />
                                            </div>
                                        ) : (
                                            <Badge variant={getStatusVariant(item.status)}>
                                                {getStatusLabel(item.status)}
                                            </Badge>
                                        )}
                                        {item.needs_qc_attention && <Badge variant="warning">Check</Badge>}
                                    </div>
                                </TableCell>
                                <TableCell className="text-gray-500">
                                    {item.assigned_date ? format(new Date(item.assigned_date), 'MMM d') : '-'}
                                </TableCell>
                            </TableRow>
                        );
                    })}

                    {filteredItems.length === 0 && !loading && (
                        <tr>
                            <td colSpan="6" className="px-6 py-8 text-center text-gray-500 text-sm">
                                No items match the selected filters.
                            </td>
                        </tr>
                    )}
                </Table>
            </Card>

            {page * QC_PAGE_SIZE < totalTickets && (
                <div className="flex justify-center py-4">
                    <Button
                        variant="secondary"
                        disabled={loadingMore}
                        isLoading={loadingMore}
                        onClick={() => loadItems({ reset: false })}
                    >
                        Load More
                    </Button>
                </div>
            )}

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title=""
                maxWidth="max-w-4xl"
            >
                {selectedItemId && (
                    <ManageItemTasks
                        itemId={selectedItemId}
                        onClose={() => {
                            setIsModalOpen(false);
                            loadItems();
                        }}
                        canManageQc={canManageQc}
                        rateCard={rateCard}
                        tailors={tailors}
                    />
                )}
            </Modal>
        </div>
    );
}
