// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Download, FilterX, Search } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table';
import { hasPerm } from '@/lib/permissions';

const TAILOR_GROUP_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

const TASK_STATUS_OPTIONS = [
    { value: 'CREATED', label: 'Created' },
    { value: 'QC_PASSED', label: 'QC Passed' },
    { value: 'QC_FAILED', label: 'QC Failed' },
    { value: 'PAID', label: 'Paid' },
    { value: 'REVERSED', label: 'Reversed' },
];

function getTaskStatusLabel(status) {
    if (!status) return 'Created';
    if (status === 'QC_PASSED' || status === 'Approved') return 'QC Passed';
    if (status === 'QC_FAILED' || status === 'Rejected') return 'QC Failed';
    if (status === 'CREATED') return 'Created';
    if (status === 'PAID') return 'Paid';
    if (status === 'REVERSED') return 'Reversed';
    return status;
}

function getTaskStatusVariant(status) {
    if (status === 'QC_PASSED' || status === 'Approved' || status === 'PAID') return 'success';
    if (status === 'QC_FAILED' || status === 'Rejected' || status === 'REVERSED') return 'danger';
    if (status === 'CREATED') return 'warning';
    return 'neutral';
}

function getItemStatusLabel(status) {
    if (status === 'NEW') return 'New';
    if (status === 'IN_PRODUCTION') return 'In Production';
    if (status === 'OUT_OF_PRODUCTION') return 'Out of Production';
    if (status === 'ARCHIVED') return 'Archived';
    if (status === 'CANCELLED') return 'Cancelled';
    return status || '-';
}

function getItemStatusVariant(status) {
    if (status === 'NEW') return 'warning';
    if (status === 'IN_PRODUCTION') return 'brand';
    if (status === 'OUT_OF_PRODUCTION') return 'success';
    if (status === 'CANCELLED') return 'danger';
    return 'neutral';
}

function getCategoryBadgeClass(categoryName) {
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
}

function escapeCsvCell(value) {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function getCurrentWeekDateRange() {
    const today = new Date();
    const day = today.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysFromMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
        dateFrom: format(monday, 'yyyy-MM-dd'),
        dateTo: format(sunday, 'yyyy-MM-dd'),
    };
}

function getDefaultFilters() {
    return {
        searchCustomer: '',
        searchTicket: '',
        searchTailor: '',
        searchTask: '',
        searchCategory: '',
        searchProduct: '',
        status: '',
        ...getCurrentWeekDateRange(),
    };
}

export default function QcTailorWorkClient({ permissions = [] }: { permissions?: string[] }) {
    const canViewQc =
        permissions.includes('admin') ||
        permissions.includes('manage_qc') ||
        (permissions.length > 0 && hasPerm(permissions, 'manage_qc'));

    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [page, setPage] = useState(1);
    const [expandedGroups, setExpandedGroups] = useState({});
    const [taskOptions, setTaskOptions] = useState([]);
    const [categoryOptions, setCategoryOptions] = useState([]);
    const [productOptions, setProductOptions] = useState([]);
    const activeRequestIdRef = useRef(0);

    const [filters, setFilters] = useState(() => getDefaultFilters());
    const [debouncedFilters, setDebouncedFilters] = useState(filters);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            setPage(1);
            setDebouncedFilters(filters);
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(debounceTimer);
    }, [filters]);

    useEffect(() => {
        if (!canViewQc) {
            setLoading(false);
            return;
        }

        loadFilterOptions();
    }, [canViewQc]);

    useEffect(() => {
        if (canViewQc) {
            loadTasks();
        }
    }, [canViewQc, debouncedFilters]);

    const loadFilterOptions = async () => {
        try {
            const [taskTypes, categories, productTypes] = await Promise.all([
                db.getTaskTypes(),
                db.getCategories(),
                db.getProductTypes(),
            ]);
            setTaskOptions(taskTypes.map(task => task.name).filter(Boolean).sort());
            setCategoryOptions(categories.map(category => category.name).filter(Boolean).sort());
            setProductOptions(productTypes.map(product => product.name).filter(Boolean).sort());
        } catch (error) {
            console.error(error);
        }
    };

    const loadTasks = async () => {
        const requestId = activeRequestIdRef.current + 1;
        activeRequestIdRef.current = requestId;
        setLoading(true);
        setLoadError('');

        try {
            const data = await db.getQcTailorWork(debouncedFilters);
            if (requestId !== activeRequestIdRef.current) return;
            setTasks(data);
        } catch (error) {
            if (requestId !== activeRequestIdRef.current) return;
            console.error(error);
            setTasks([]);
            setLoadError(error?.message || 'Unable to load tailor work.');
        } finally {
            if (requestId === activeRequestIdRef.current) {
                setLoading(false);
            }
        }
    };

    const clearFilters = () => {
        const defaultFilters = getDefaultFilters();
        setPage(1);
        setFilters(defaultFilters);
        setDebouncedFilters(defaultFilters);
    };

    const hasActiveFilters = Object.values(filters).some(Boolean);

    const groupedTasks = useMemo(() => {
        const groups = tasks.reduce((acc, task) => {
            const tailorName = task.tailor_name || 'Unassigned';
            const tailorKey = task.tailor_id || tailorName;

            if (!acc[tailorKey]) {
                acc[tailorKey] = {
                    tailorKey,
                    tailorName,
                    tasks: [],
                };
            }

            acc[tailorKey].tasks.push(task);
            return acc;
        }, {});

        return Object.values(groups).sort((a, b) => a.tailorName.localeCompare(b.tailorName));
    }, [tasks]);

    const totalGroups = groupedTasks.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / TAILOR_GROUP_PAGE_SIZE));
    const visibleGroups = groupedTasks.slice((page - 1) * TAILOR_GROUP_PAGE_SIZE, page * TAILOR_GROUP_PAGE_SIZE);
    const pageStart = totalGroups === 0 ? 0 : ((page - 1) * TAILOR_GROUP_PAGE_SIZE) + 1;
    const pageEnd = Math.min(page * TAILOR_GROUP_PAGE_SIZE, totalGroups);

    const toggleGroup = (tailorKey) => {
        setExpandedGroups(prev => ({
            ...prev,
            [tailorKey]: !prev[tailorKey],
        }));
    };

    const handleExport = () => {
        if (tasks.length === 0) {
            alert('No tailor work matches the current filters.');
            return;
        }

        const headers = [
            'Tailor',
            'Ticket Number',
            'Assigned Date',
            'Customer',
            'Category',
            'Task',
            'Item Key',
            'Product',
            'Task Status',
            'Item Status',
        ];
        const rows = tasks.map(task => [
            task.tailor_name || '',
            task.ticket_number || '',
            task.created_at ? format(new Date(task.created_at), 'yyyy-MM-dd') : '',
            task.customer_name || '',
            task.category_name || '',
            task.task_type_name || '',
            task.item_key || '',
            task.product_type_name || '',
            getTaskStatusLabel(task.raw_status || task.status),
            getItemStatusLabel(task.item_status),
        ]);

        const csv = [headers, ...rows]
            .map(row => row.map(escapeCsvCell).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStamp = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `qc-tailor-work-${dateStamp}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    if (!canViewQc) {
        return (
            <Card>
                <div className="px-6 py-8 text-center text-sm text-gray-500">
                    You do not have access to view QC tailor work.
                </div>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Tailor Work</h1>
                    <p className="text-sm text-maison-secondary">Review assigned tailor work without pay details.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <Link href="/qc">
                        <Button variant="secondary">QC Queue</Button>
                    </Link>
                    <Button variant="secondary" onClick={handleExport}>
                        <Download size={16} className="mr-2" />
                        Export
                    </Button>
                </div>
            </div>

            <Card padding="p-4">
                <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Customer name"
                                value={filters.searchCustomer}
                                onChange={(e) => setFilters(prev => ({ ...prev, searchCustomer: e.target.value }))}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Ticket / Item key"
                                value={filters.searchTicket}
                                onChange={(e) => setFilters(prev => ({ ...prev, searchTicket: e.target.value }))}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Tailor name"
                                value={filters.searchTailor}
                                onChange={(e) => setFilters(prev => ({ ...prev, searchTailor: e.target.value }))}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <select
                            value={filters.searchProduct}
                            onChange={(e) => setFilters(prev => ({ ...prev, searchProduct: e.target.value }))}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All products</option>
                            {productOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>

                        <select
                            value={filters.searchCategory}
                            onChange={(e) => setFilters(prev => ({ ...prev, searchCategory: e.target.value }))}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All categories</option>
                            {categoryOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>

                        <select
                            value={filters.searchTask}
                            onChange={(e) => setFilters(prev => ({ ...prev, searchTask: e.target.value }))}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All tasks</option>
                            {taskOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <select
                            value={filters.status}
                            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                            className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All task statuses</option>
                            {TASK_STATUS_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>

                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">-</span>
                            <input
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-500 transition-all hover:bg-gray-50 hover:text-gray-700"
                            >
                                <FilterX size={14} />
                                Clear
                            </button>
                        )}

                        <span className="ml-auto text-xs text-gray-400">
                            {loading ? 'Loading...' : `${pageStart}-${pageEnd} of ${totalGroups} tailor group${totalGroups !== 1 ? 's' : ''}`}
                        </span>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={loading || page <= 1}
                            onClick={() => setPage(prev => Math.max(1, prev - 1))}
                        >
                            Previous
                        </Button>
                        <span className="text-xs text-gray-500">
                            Page {page} of {totalPages}
                        </span>
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={loading || page >= totalPages}
                            onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            </Card>

            {loadError && (
                <Card>
                    <div className="px-6 py-4 text-sm text-red-600">
                        {loadError}
                    </div>
                </Card>
            )}

            <div className="space-y-4">
                {visibleGroups.map((group) => {
                    const isExpanded = expandedGroups[group.tailorKey] ?? false;
                    const passedCount = group.tasks.filter(task => task.raw_status === 'QC_PASSED' || task.status === 'Approved').length;
                    const failedCount = group.tasks.filter(task => task.raw_status === 'QC_FAILED' || task.status === 'Rejected').length;
                    const pendingCount = group.tasks.filter(task => task.raw_status === 'CREATED').length;

                    return (
                        <Card key={group.tailorKey} padding="p-0" className="overflow-hidden">
                            <button
                                onClick={() => toggleGroup(group.tailorKey)}
                                className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="text-gray-400">
                                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <h3 className="font-serif text-lg font-medium text-maison-primary">
                                            {group.tailorName}
                                        </h3>
                                        <p className="text-sm text-maison-secondary">
                                            {group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''} assigned
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className="hidden flex-1 items-center justify-center gap-6 text-sm text-maison-secondary xl:flex">
                                        <span>Pending: {pendingCount}</span>
                                        <span>Passed: {passedCount}</span>
                                        <span>Failed: {failedCount}</span>
                                    </div>
                                    <Badge variant={pendingCount === 0 && group.tasks.length > 0 ? 'success' : 'neutral'}>
                                        {group.tasks.length - pendingCount} / {group.tasks.length} Reviewed
                                    </Badge>
                                </div>
                            </button>

                            {isExpanded && (
                                <div className="bg-white">
                                    <Table
                                        tableClassName="table-fixed min-w-[1100px]"
                                        headers={[
                                            { label: 'Date', className: 'w-[10%]' },
                                            { label: 'Ticket', className: 'w-[10%]' },
                                            { label: 'Customer', className: 'w-[16%]' },
                                            { label: 'Item', className: 'w-[13%]' },
                                            { label: 'Product', className: 'w-[12%]' },
                                            { label: 'Task', className: 'w-[17%]' },
                                            { label: 'Task Status', className: 'w-[11%]' },
                                            { label: 'Item Status', className: 'w-[11%]' },
                                        ]}
                                    >
                                        {group.tasks.map((task) => (
                                            <TableRow key={task.id}>
                                                <TableCell className="text-gray-500">
                                                    {task.created_at ? format(new Date(task.created_at), 'MMM d') : '-'}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    <span className="block truncate" title={task.ticket_number}>{task.ticket_number || '-'}</span>
                                                </TableCell>
                                                <TableCell className="max-w-0">
                                                    <span className="block truncate" title={task.customer_name}>{task.customer_name || '-'}</span>
                                                </TableCell>
                                                <TableCell className="max-w-0">
                                                    <Link
                                                        href={`/qc/item/${task.item_id}`}
                                                        className="block truncate font-mono text-xs font-medium text-maison-primary hover:underline"
                                                        title={task.item_key}
                                                    >
                                                        {task.item_key || '-'}
                                                    </Link>
                                                </TableCell>
                                                <TableCell className="max-w-0">
                                                    <span className="block truncate" title={task.product_type_name}>{task.product_type_name || '-'}</span>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="min-w-0">
                                                        <div className="truncate font-medium" title={task.task_type_name}>{task.task_type_name || '-'}</div>
                                                        {task.category_name ? (
                                                            <Badge
                                                                variant="neutral"
                                                                className={`${getCategoryBadgeClass(task.category_name)} mt-1 max-w-full truncate`}
                                                                title={task.category_name}
                                                            >
                                                                {task.category_name}
                                                            </Badge>
                                                        ) : (
                                                            <div className="mt-1 text-xs text-gray-400">No category</div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={getTaskStatusVariant(task.raw_status || task.status)}>
                                                        {getTaskStatusLabel(task.raw_status || task.status)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={getItemStatusVariant(task.item_status)}>
                                                        {getItemStatusLabel(task.item_status)}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </Table>
                                </div>
                            )}
                        </Card>
                    );
                })}

                {tasks.length === 0 && !loading && (
                    <Card>
                        <div className="px-6 py-8 text-center text-sm text-gray-500">
                            {hasActiveFilters ? 'No tailor work matches your filters.' : 'No tailor work found.'}
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
