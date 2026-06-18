// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight, FilterX, History, Search } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge } from '@/components/UI/Table';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

const CATEGORY_TABS = [
    { key: 'all', label: 'All' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'items', label: 'Items' },
    { key: 'production_tasks', label: 'Production Tasks' },
    { key: 'payments', label: 'Payments' },
    { key: 'rates', label: 'Rates' },
    { key: 'tailors', label: 'Tailors' },
];

const ACTION_OPTIONS = [
    { value: '', label: 'All Actions' },
    { value: 'INSERT', label: 'Created' },
    { value: 'UPDATE', label: 'Updated' },
    { value: 'DELETE', label: 'Deleted' },
];

const STATUS_LABELS = {
    NEW: 'New',
    IN_PRODUCTION: 'In Production',
    OUT_OF_PRODUCTION: 'Out of Production',
    ARCHIVED: 'Archived',
    CANCELLED: 'Cancelled',
    CREATED: 'Created',
    QC_PASSED: 'Approved',
    QC_FAILED: 'Rejected',
    PAID: 'Paid',
    REVERSED: 'Reversed',
};

const FIELD_LABELS = {
    ticket_number: 'Ticket ID',
    customer_name: 'Customer',
    item_key: 'Item Key',
    status: 'Status',
    product_type_id: 'Product Type',
    tailor_id: 'Tailor',
    task_type_id: 'Task',
    category_type_id: 'Category',
    pay_amount: 'Pay Amount',
    rate_snapshot: 'Rate',
    pay_band_snapshot: 'Pay Band',
    name: 'Name',
    active: 'Active',
    band: 'Band',
    notes: 'Notes',
    reversal_reason: 'Reversal Reason',
    reversal_notes: 'Reversal Notes',
};

const HIDDEN_DETAIL_FIELDS = new Set([
    'id',
    'organization_id',
    'created_at',
    'updated_at',
]);

function defaultDateRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);

    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
    };
}

function getActorLabel(entry) {
    const profile = entry.actor_profile || {};
    return (
        profile.full_name ||
        profile.name ||
        profile.display_name ||
        profile.email ||
        (entry.actor_user_id ? `User ${String(entry.actor_user_id).slice(0, 8)}` : null) ||
        'Unknown user'
    );
}

function getRecord(entry) {
    return entry.after || entry.before || {};
}

function labelStatus(value) {
    return STATUS_LABELS[value] || value || '-';
}

function getActionLabel(action) {
    if (action === 'INSERT') return 'Created';
    if (action === 'UPDATE') return 'Updated';
    if (action === 'DELETE') return 'Deleted';
    return action || 'Activity';
}

function getCategory(entry) {
    if (entry.table_name === 'tickets') return 'Tickets';
    if (entry.table_name === 'items') return 'Items';
    if (entry.table_name === 'rate_cards') return 'Rates';
    if (entry.table_name === 'tailors') return 'Tailors';

    if (entry.table_name === 'work_assignments') {
        const beforeStatus = entry.before?.status;
        const afterStatus = entry.after?.status;
        if ([beforeStatus, afterStatus].some(status => ['QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED'].includes(status))) {
            return 'Payments';
        }
        return 'Production Tasks';
    }

    return entry.table_name || 'Activity';
}

function getCategoryVariant(category) {
    if (category === 'Payments') return 'success';
    if (category === 'Rates') return 'warning';
    if (category === 'Tailors') return 'brand';
    if (category === 'Production Tasks') return 'neutral';
    if (category === 'Items') return 'brand';
    if (category === 'Tickets') return 'neutral';
    return 'neutral';
}

function recordName(entry) {
    const record = getRecord(entry);
    if (entry.table_name === 'tickets') {
        return record.ticket_number ? `ticket ${record.ticket_number}` : 'a ticket';
    }
    if (entry.table_name === 'items') {
        return record.item_key ? `item ${record.item_key}` : 'an item';
    }
    if (entry.table_name === 'work_assignments') {
        return record.item_key ? `task on ${record.item_key}` : 'a task';
    }
    if (entry.table_name === 'rate_cards') return 'a rate';
    if (entry.table_name === 'tailors') return record.name ? `tailor ${record.name}` : 'a tailor';
    return entry.record_id ? `record ${entry.record_id}` : 'a record';
}

function activitySummary(entry) {
    const actor = getActorLabel(entry);
    const before = entry.before || {};
    const after = entry.after || {};
    const record = getRecord(entry);

    if (entry.table_name === 'tickets') {
        if (entry.action === 'INSERT') return `${actor} created ticket ${record.ticket_number || entry.record_id}`;
        if (entry.action === 'DELETE') return `${actor} deleted ticket ${record.ticket_number || entry.record_id}`;
        return `${actor} updated ticket ${record.ticket_number || entry.record_id}`;
    }

    if (entry.table_name === 'items') {
        const itemLabel = record.item_key || entry.record_id;
        if (entry.action === 'INSERT') return `${actor} created item ${itemLabel}`;
        if (entry.action === 'DELETE') return `${actor} deleted item ${itemLabel}`;
        if (before.status !== after.status && after.status) {
            return `${actor} changed item ${itemLabel} from ${labelStatus(before.status)} to ${labelStatus(after.status)}`;
        }
        return `${actor} updated item ${itemLabel}`;
    }

    if (entry.table_name === 'work_assignments') {
        const target = record.item_key || entry.record_id;
        if (entry.action === 'INSERT') return `${actor} assigned a task on ${target}`;
        if (entry.action === 'DELETE') return `${actor} deleted a task on ${target}`;

        if (before.status !== after.status && after.status) {
            if (after.status === 'QC_PASSED' || after.status === 'PAID') return `${actor} approved payment for ${target}`;
            if (after.status === 'QC_FAILED') return `${actor} rejected payment for ${target}`;
            if (after.status === 'REVERSED') return `${actor} reversed payment for ${target}`;
            if (after.status === 'CREATED' && ['QC_PASSED', 'QC_FAILED', 'PAID', 'REVERSED'].includes(before.status)) {
                return `${actor} reopened payment task for ${target}`;
            }
            return `${actor} changed task status on ${target} from ${labelStatus(before.status)} to ${labelStatus(after.status)}`;
        }

        return `${actor} updated a task on ${target}`;
    }

    if (entry.table_name === 'rate_cards') {
        if (entry.action === 'INSERT') return `${actor} created a rate`;
        if (entry.action === 'DELETE') return `${actor} deleted a rate`;
        return `${actor} updated a rate`;
    }

    if (entry.table_name === 'tailors') {
        const tailor = record.name || entry.record_id;
        if (entry.action === 'INSERT') return `${actor} created tailor ${tailor}`;
        if (entry.action === 'DELETE') return `${actor} deleted tailor ${tailor}`;
        return `${actor} updated tailor ${tailor}`;
    }

    return `${actor} ${getActionLabel(entry.action).toLowerCase()} ${recordName(entry)}`;
}

function formatValue(key, value) {
    if (value === null || value === undefined || value === '') return '-';
    if (key === 'status') return labelStatus(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function getChangedFields(entry) {
    const before = entry.before || {};
    const after = entry.after || {};
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
        .filter(key => !HIDDEN_DETAIL_FIELDS.has(key));

    if (entry.action === 'INSERT') {
        return keys
            .filter(key => after[key] !== null && after[key] !== undefined && after[key] !== '')
            .map(key => ({ key, before: null, after: after[key] }));
    }

    if (entry.action === 'DELETE') {
        return keys
            .filter(key => before[key] !== null && before[key] !== undefined && before[key] !== '')
            .map(key => ({ key, before: before[key], after: null }));
    }

    return keys
        .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .map(key => ({ key, before: before[key], after: after[key] }));
}

export default function ActivityLogClient() {
    const initialDates = useMemo(() => defaultDateRange(), []);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [page, setPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [expandedRows, setExpandedRows] = useState({});
    const [filters, setFilters] = useState({
        search: '',
        category: 'all',
        action: '',
        startDate: initialDates.startDate,
        endDate: initialDates.endDate,
    });
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const requestIdRef = useRef(0);

    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1);
            setDebouncedSearch(filters.search);
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [filters.search]);

    useEffect(() => {
        loadLogs();
    }, [filters.category, filters.action, filters.startDate, filters.endDate, debouncedSearch, page]);

    const loadLogs = async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setLoadError('');

        try {
            const result = await db.getActivityLogs({
                ...filters,
                search: debouncedSearch,
            }, page, PAGE_SIZE);

            if (requestId !== requestIdRef.current) return;
            setLogs(result.data);
            setTotalCount(result.count);
        } catch (error) {
            if (requestId !== requestIdRef.current) return;
            setLogs([]);
            setTotalCount(0);
            const message = error?.message || 'Unable to load activity logs.';
            setLoadError(
                message.includes('get_activity_log_entries')
                    ? 'Activity Log is not available yet because the read-access migration has not been applied to Supabase.'
                    : message
            );
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    };

    const updateFilter = (key, value) => {
        setPage(1);
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const resetFilters = () => {
        const dates = defaultDateRange();
        setPage(1);
        setFilters({
            search: '',
            category: 'all',
            action: '',
            startDate: dates.startDate,
            endDate: dates.endDate,
        });
        setDebouncedSearch('');
    };

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const pageStart = totalCount === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
    const pageEnd = Math.min(page * PAGE_SIZE, totalCount);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Activity Log</h1>
                    <p className="text-sm text-maison-secondary">Read-only history of system activity.</p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-maison-secondary shadow-sm">
                    <History size={16} />
                    Last 30 days by default
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {CATEGORY_TABS.map(tab => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => updateFilter('category', tab.key)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${filters.category === tab.key
                            ? 'bg-maison-primary text-white shadow-sm'
                            : 'bg-white text-maison-secondary border border-gray-200 hover:bg-gray-50'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <Card>
                <div className="flex flex-col flex-wrap items-end gap-4 lg:flex-row">
                    <div className="min-w-[220px] flex-1">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Search</label>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                value={filters.search}
                                onChange={(event) => updateFilter('search', event.target.value)}
                                placeholder="Ticket, item, customer, user, action..."
                                className="w-full rounded-md border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                        </div>
                    </div>
                    <div className="w-full min-w-[150px] lg:w-auto">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Action</label>
                        <select
                            value={filters.action}
                            onChange={(event) => updateFilter('action', event.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        >
                            {ACTION_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="w-full lg:w-auto">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Date Range</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(event) => updateFilter('startDate', event.target.value)}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                            <span className="text-gray-400">-</span>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(event) => updateFilter('endDate', event.target.value)}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                        </div>
                    </div>
                    <Button variant="ghost" onClick={resetFilters} className="text-gray-500 hover:text-gray-700 bg-gray-50 px-3">
                        <FilterX size={16} />
                    </Button>
                </div>
            </Card>

            {loadError && (
                <Card>
                    <div className="text-sm text-red-600">{loadError}</div>
                </Card>
            )}

            <div className="space-y-3">
                {logs.map(entry => {
                    const category = getCategory(entry);
                    const expanded = Boolean(expandedRows[entry.id]);
                    const changedFields = getChangedFields(entry);
                    const createdAt = entry.created_at ? new Date(entry.created_at) : null;

                    return (
                        <Card key={entry.id} padding="p-0" className="overflow-hidden border border-gray-200">
                            <button
                                type="button"
                                onClick={() => setExpandedRows(prev => ({ ...prev, [entry.id]: !expanded }))}
                                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-gray-50"
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="text-maison-primary">
                                        {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant={getCategoryVariant(category)}>{category}</Badge>
                                            <Badge variant="neutral">{getActionLabel(entry.action)}</Badge>
                                        </div>
                                        <p className="mt-2 truncate text-sm font-medium text-maison-primary">
                                            {activitySummary(entry)}
                                        </p>
                                    </div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="text-sm font-medium text-maison-primary">
                                        {createdAt ? formatDistanceToNow(createdAt, { addSuffix: true }) : '-'}
                                    </div>
                                    <div className="mt-1 text-xs text-maison-secondary">
                                        {createdAt ? format(createdAt, 'MMM d, yyyy, h:mm a') : '-'}
                                    </div>
                                </div>
                            </button>

                            {expanded && (
                                <div className="border-t border-gray-100 bg-white px-5 py-4">
                                    <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Actor</div>
                                            <div className="mt-1 text-maison-primary">{getActorLabel(entry)}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Record</div>
                                            <div className="mt-1 font-mono text-xs text-maison-primary">{entry.record_id}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Source</div>
                                            <div className="mt-1 text-maison-primary">{entry.table_name}</div>
                                        </div>
                                    </div>

                                    <div className="mt-4 rounded-lg border border-gray-100">
                                        <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            <span>Field</span>
                                            <span>Before</span>
                                            <span>After</span>
                                        </div>
                                        {changedFields.length > 0 ? changedFields.slice(0, 12).map(field => (
                                            <div key={field.key} className="grid grid-cols-[1fr_1fr_1fr] gap-3 border-b border-gray-50 px-4 py-2 text-sm last:border-b-0">
                                                <span className="font-medium text-maison-primary">{FIELD_LABELS[field.key] || field.key}</span>
                                                <span className="break-words text-maison-secondary">{formatValue(field.key, field.before)}</span>
                                                <span className="break-words text-maison-primary">{formatValue(field.key, field.after)}</span>
                                            </div>
                                        )) : (
                                            <div className="px-4 py-3 text-sm text-gray-500">No field-level details available.</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </Card>
                    );
                })}

                {!loading && logs.length === 0 && (
                    <Card>
                        <div className="py-12 text-center text-sm text-gray-500">No activity found for the selected filters.</div>
                    </Card>
                )}

                {loading && (
                    <Card>
                        <div className="py-10 text-center text-sm text-gray-500">Loading activity...</div>
                    </Card>
                )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-maison-secondary">
                    {loading ? 'Loading...' : `${pageStart}-${pageEnd} of ${totalCount} activities`}
                </span>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={loading || page <= 1}
                        onClick={() => setPage(prev => Math.max(1, prev - 1))}
                    >
                        Previous
                    </Button>
                    <span className="text-sm text-maison-secondary">Page {page} of {totalPages}</span>
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
        </div>
    );
}
