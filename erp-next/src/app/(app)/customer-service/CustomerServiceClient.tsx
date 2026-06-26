// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Modal } from '@/components/UI/Modal';
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table';
import { ChevronDown, ChevronRight, Edit2, FilterX, Plus, Search, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_TABS = [
    { key: 'ALL', label: 'All', value: '' },
    { key: 'NEW', label: 'New', value: 'NEW' },
    { key: 'IN_PRODUCTION', label: 'In Production', value: 'IN_PRODUCTION' },
    { key: 'OUT_OF_PRODUCTION', label: 'Out of Production', value: 'OUT_OF_PRODUCTION' },
    { key: 'ARCHIVED', label: 'Archived', value: 'ARCHIVED' },
];

function refreshNewItemsBadge() {
    window.dispatchEvent(new Event('new-items-count:refresh'));
}

function getStatusLabel(status) {
    if (status === 'NEW') return 'New';
    if (status === 'IN_PRODUCTION') return 'In Production';
    if (status === 'OUT_OF_PRODUCTION') return 'Out of Production';
    if (status === 'ARCHIVED') return 'Archived';
    if (status === 'CANCELLED') return 'Cancelled';
    return status;
}

function getStatusVariant(status) {
    switch (status) {
        case 'NEW': return 'warning';
        case 'IN_PRODUCTION': return 'brand';
        case 'OUT_OF_PRODUCTION': return 'success';
        case 'ARCHIVED': return 'neutral';
        case 'CANCELLED': return 'danger';
        default: return 'neutral';
    }
}

function emptyProductRow() {
    return { product_type_id: '', quantity: 1, custom_values: {} };
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

export default function CustomerServiceClient({ permissions = [] }: { permissions?: string[] }) {
    const canManageCustomerService =
        permissions.includes('manage_customer_service') ||
        permissions.includes('admin');

    const [items, setItems] = useState([]);
    const [productTypes, setProductTypes] = useState([]);
    const [customFields, setCustomFields] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [totalTickets, setTotalTickets] = useState(0);
    const [activeTab, setActiveTab] = useState('ALL');
    const [expandedGroups, setExpandedGroups] = useState({});
    const [filters, setFilters] = useState({
        ticketId: '',
        customerName: '',
        productType: '',
        startDate: '',
        endDate: ''
    });
    const [debouncedFilters, setDebouncedFilters] = useState(filters);
    const activeRequestIdRef = useRef(0);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [createContext, setCreateContext] = useState(null);
    const [createLoading, setCreateLoading] = useState(false);
    const [createError, setCreateError] = useState('');
    const [ticketForm, setTicketForm] = useState({
        ticket_number: '',
        customer_name: ''
    });
    const [productRows, setProductRows] = useState([emptyProductRow()]);

    const [editingTicket, setEditingTicket] = useState(null);
    const [editCustomerName, setEditCustomerName] = useState('');
    const [editingItem, setEditingItem] = useState(null);
    const [editProductTypeId, setEditProductTypeId] = useState('');
    const [editCustomValues, setEditCustomValues] = useState({});

    useEffect(() => {
        loadPageData();
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedFilters(filters);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [filters]);

    useEffect(() => {
        loadItems({ reset: true });
    }, [activeTab, debouncedFilters]);

    const loadPageData = async () => {
        const [productTypesData, customFieldsData] = await Promise.all([
            db.getProductTypes(),
            db.getActiveCustomFields('items')
        ]);
        setProductTypes(productTypesData);
        setCustomFields(customFieldsData);
    };

    const getTabStatus = () => {
        const tab = STATUS_TABS.find(entry => entry.key === activeTab);
        return tab?.value || '';
    };

    const loadItems = async ({ reset = true } = {}) => {
        if (!reset && (loading || loadingMore || page * PAGE_SIZE >= totalTickets)) return;

        const requestId = activeRequestIdRef.current + 1;
        activeRequestIdRef.current = requestId;
        const nextPage = reset ? 1 : page + 1;

        if (reset) {
            setLoading(true);
            setLoadingMore(false);
            setItems([]);
            setPage(1);
            setTotalTickets(0);
        } else {
            setLoadingMore(true);
        }

        try {
            const result = await db.getTicketPaginatedItems(
                {
                    ...debouncedFilters,
                    status: getTabStatus()
                },
                nextPage,
                PAGE_SIZE,
                { excludeCancelled: false, excludeArchived: false }
            );

            if (requestId !== activeRequestIdRef.current) return;

            setItems(prev => reset ? result.items : [...prev, ...result.items]);
            setTotalTickets(result.totalTickets);
            setPage(nextPage);
        } finally {
            if (requestId === activeRequestIdRef.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    };

    const groupedItems = items.reduce((acc, item) => {
        const ticketNumber = item.ticket_number || 'Unassigned';
        if (!acc[ticketNumber]) {
            acc[ticketNumber] = {
                ticket_number: ticketNumber,
                ticket_id: item.ticket_id,
                customer_name: item.customer_name || '',
                items: []
            };
        }
        acc[ticketNumber].items.push(item);
        return acc;
    }, {});

    const resetCreateForm = () => {
        setCreateContext(null);
        setCreateError('');
        setTicketForm({ ticket_number: '', customer_name: '' });
        setProductRows([emptyProductRow()]);
        setCreateLoading(false);
    };

    const openCreateForNewTicket = () => {
        if (!canManageCustomerService) {
            alert('Customer Service writes are read-only for your role.');
            return;
        }
        resetCreateForm();
        setIsCreateOpen(true);
    };

    const openCreateForTicket = (group) => {
        if (!canManageCustomerService) {
            alert('Customer Service writes are read-only for your role.');
            return;
        }
        resetCreateForm();
        setCreateContext(group);
        setTicketForm({
            ticket_number: group.ticket_number,
            customer_name: group.customer_name || ''
        });
        setIsCreateOpen(true);
    };

    const closeCreate = () => {
        setIsCreateOpen(false);
        resetCreateForm();
    };

    const handleProductRowChange = (index, field, value) => {
        setProductRows(prev => prev.map((row, rowIndex) =>
            rowIndex === index ? { ...row, [field]: value } : row
        ));
    };

    const handleProductRowCustomValueChange = (index, fieldId, value) => {
        setProductRows(prev => prev.map((row, rowIndex) => (
            rowIndex === index
                ? { ...row, custom_values: { ...(row.custom_values || {}), [fieldId]: value } }
                : row
        )));
    };

    const handleEditCustomValueChange = (fieldId, value) => {
        setEditCustomValues(prev => ({ ...prev, [fieldId]: value }));
    };

    const handleSubmitCreate = async (event) => {
        event.preventDefault();
        if (!canManageCustomerService) return;

        const cleanedProducts = productRows.map(row => ({
            product_type_id: row.product_type_id,
            quantity: Number(row.quantity),
            custom_values: row.custom_values || {}
        }));

        if (!ticketForm.ticket_number.trim()) {
            setCreateError('Ticket ID is required.');
            return;
        }

        if (!ticketForm.customer_name.trim()) {
            setCreateError('Customer name/reference is required.');
            return;
        }

        if (cleanedProducts.some(row => !row.product_type_id || row.quantity < 1)) {
            setCreateError('Every product row needs a product type and quantity of at least 1.');
            return;
        }

        setCreateLoading(true);
        setCreateError('');

        try {
            let ticket = createContext
                ? { id: createContext.ticket_id }
                : await db.getTicketByNumber(ticketForm.ticket_number.trim());

            if (!ticket) {
                ticket = await db.createTicketCS({
                    ticket_number: ticketForm.ticket_number.trim(),
                    customer_name: ticketForm.customer_name.trim()
                });
            }

            for (const product of cleanedProducts) {
                await db.createItemsForTicketCS({
                    ticket_id: ticket.id,
                    product_type_id: product.product_type_id,
                    quantity: product.quantity,
                    custom_values: product.custom_values
                });
            }

            closeCreate();
            await loadItems({ reset: true });
            refreshNewItemsBadge();
        } catch (error) {
            setCreateError(error.message || 'Some items could not be created. Please review this ticket before trying again.');
            await loadItems({ reset: true });
            refreshNewItemsBadge();
        } finally {
            setCreateLoading(false);
        }
    };

    const ticketAllNew = (group) => group.items.every(item => item.raw_status === 'NEW' || item.status === 'NEW');
    const itemIsNew = (item) => item.raw_status === 'NEW' || item.status === 'NEW';

    const startTicketEdit = (group) => {
        if (!canManageCustomerService) return;
        if (!ticketAllNew(group)) {
            alert('Ticket details can only be edited while all items are New.');
            return;
        }
        setEditingTicket(group.ticket_id);
        setEditCustomerName(group.customer_name || '');
    };

    const saveTicketEdit = async (ticketId) => {
        if (!editCustomerName.trim()) return;
        try {
            await db.updateTicketCS(ticketId, { customer_name: editCustomerName.trim() });
            setEditingTicket(null);
            setEditCustomerName('');
            await loadItems({ reset: true });
        } catch (error) {
            alert(error.message);
        }
    };

    const deleteTicket = async (group) => {
        if (!canManageCustomerService) return;
        if (!ticketAllNew(group)) {
            alert('Tickets can only be deleted while all items are New.');
            return;
        }
        if (!window.confirm(`Delete ticket ${group.ticket_number} and all New items under it?`)) return;
        try {
            await db.deleteTicketCS(group.ticket_id);
            await loadItems({ reset: true });
            refreshNewItemsBadge();
        } catch (error) {
            alert(error.message);
        }
    };

    const openItemEdit = async (item) => {
        if (!canManageCustomerService) return;
        if (!itemIsNew(item)) {
            alert('Only New items can be edited by Customer Service.');
            return;
        }
        setEditingItem(item);
        setEditProductTypeId(item.product_type_id || '');
        try {
            const values = await db.getItemCustomFieldValues(item.id);
            setEditCustomValues(values || {});
        } catch {
            setEditCustomValues({});
        }
    };

    const saveItemEdit = async () => {
        if (!editingItem || !editProductTypeId) return;
        try {
            await db.updateItemProductTypeCS(editingItem.id, editProductTypeId);
            await db.saveItemCustomFieldValues(editingItem.id, editCustomValues);
            setEditingItem(null);
            setEditProductTypeId('');
            setEditCustomValues({});
            await loadItems({ reset: true });
            refreshNewItemsBadge();
        } catch (error) {
            alert(error.message);
        }
    };

    const deleteItem = async (item) => {
        if (!canManageCustomerService) return;
        if (!itemIsNew(item)) {
            alert('Only New items can be deleted by Customer Service.');
            return;
        }
        if (!window.confirm(`Delete item ${item.item_key || 'this item'}?`)) return;
        try {
            await db.deleteItemCS(item.id);
            await loadItems({ reset: true });
            refreshNewItemsBadge();
        } catch (error) {
            alert(error.message);
        }
    };

    const renderCustomFieldInput = (field, value, onChange) => {
        const label = `${field.label}${field.required ? ' *' : ''}`;
        const baseClass = "block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20";

        if (field.field_type === 'long_text') {
            return (
                <div key={field.id}>
                    <label className="mb-1.5 block text-sm font-medium text-maison-secondary">{label}</label>
                    <textarea
                        value={value || ''}
                        onChange={(event) => onChange(event.target.value)}
                        required={field.required}
                        rows={3}
                        className={baseClass}
                    />
                </div>
            );
        }

        if (field.field_type === 'dropdown') {
            return (
                <div key={field.id}>
                    <label className="mb-1.5 block text-sm font-medium text-maison-secondary">{label}</label>
                    <select
                        value={value || ''}
                        onChange={(event) => onChange(event.target.value)}
                        required={field.required}
                        className={baseClass}
                    >
                        <option value="">Select...</option>
                        {(field.options || []).map(option => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                    </select>
                </div>
            );
        }

        if (field.field_type === 'checkbox') {
            return (
                <label key={field.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-maison-secondary">
                    <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => onChange(event.target.checked)}
                    />
                    {label}
                </label>
            );
        }

        const inputType = field.field_type === 'number'
            ? 'number'
            : field.field_type === 'date'
                ? 'date'
                : 'text';

        return (
            <div key={field.id}>
                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">{label}</label>
                <input
                    type={inputType}
                    value={value || ''}
                    onChange={(event) => onChange(event.target.value)}
                    required={field.required}
                    className={baseClass}
                    step={field.field_type === 'number' ? 'any' : undefined}
                />
            </div>
        );
    };
    const clearFilters = () => {
        setFilters({
            ticketId: '',
            customerName: '',
            productType: '',
            startDate: '',
            endDate: ''
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Customer Service</h1>
                    <p className="text-sm text-maison-secondary">Create and correct intake items before production starts.</p>
                </div>
                {canManageCustomerService && (
                    <Button onClick={openCreateForNewTicket}>
                        <Plus size={16} className="mr-2" />
                        New Ticket
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {STATUS_TABS.map(tab => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === tab.key
                            ? 'bg-maison-primary text-white shadow-sm'
                            : 'bg-white text-maison-secondary border border-gray-200 hover:bg-gray-50'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <Card>
                <div className="flex flex-col flex-wrap items-end gap-4 sm:flex-row">
                    <div className="min-w-[150px] flex-1">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Ticket ID</label>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                value={filters.ticketId}
                                onChange={(event) => setFilters(prev => ({ ...prev, ticketId: event.target.value }))}
                                placeholder="Search ticket..."
                                className="w-full rounded-md border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                        </div>
                    </div>
                    <div className="min-w-[150px] flex-1">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Customer</label>
                        <input
                            type="text"
                            value={filters.customerName}
                            onChange={(event) => setFilters(prev => ({ ...prev, customerName: event.target.value }))}
                            placeholder="Search customer..."
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>
                    <div className="w-full min-w-[150px] sm:w-auto">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Product Type</label>
                        <select
                            value={filters.productType}
                            onChange={(event) => setFilters(prev => ({ ...prev, productType: event.target.value }))}
                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        >
                            <option value="">All Products</option>
                            {productTypes.map(product => (
                                <option key={product.id} value={product.name}>{product.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="mb-1 block text-xs font-semibold text-gray-500">Date Range</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(event) => setFilters(prev => ({ ...prev, startDate: event.target.value }))}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                            <span className="text-gray-400">-</span>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(event) => setFilters(prev => ({ ...prev, endDate: event.target.value }))}
                                className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                        </div>
                    </div>
                    <Button variant="ghost" onClick={clearFilters} className="text-gray-500 hover:text-gray-700 bg-gray-50 px-3">
                        <FilterX size={16} />
                    </Button>
                </div>
            </Card>

            <div className="space-y-4">
                {loading && (
                    <Card>
                        <div className="py-10 text-center text-sm text-gray-500">Loading customer service items...</div>
                    </Card>
                )}

                {!loading && Object.values(groupedItems).map(group => {
                    const isExpanded = expandedGroups[group.ticket_number] ?? true;
                    const allNew = ticketAllNew(group);
                    const newItemsCount = group.items.filter(item => item.status === 'NEW' || item.raw_status === 'NEW').length;

                    return (
                        <Card key={group.ticket_number} padding="p-0" className="overflow-hidden border border-gray-200">
                            <div
                                className={`flex items-center justify-between p-3 transition-colors ${isExpanded ? 'bg-gray-50 border-b border-gray-200' : 'hover:bg-gray-50'}`}
                            >
                                <div className="flex w-full items-center gap-3">
                                    <div
                                        className="min-w-5 cursor-pointer text-maison-primary"
                                        onClick={() => setExpandedGroups(prev => ({ ...prev, [group.ticket_number]: !isExpanded }))}
                                    >
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    </div>
                                    <div
                                        className="flex flex-1 cursor-pointer items-center justify-between"
                                        onClick={() => setExpandedGroups(prev => ({ ...prev, [group.ticket_number]: !isExpanded }))}
                                    >
                                        <div className="flex items-center gap-4">
                                            {editingTicket === group.ticket_id ? (
                                                <input
                                                    value={editCustomerName}
                                                    onChange={(event) => setEditCustomerName(event.target.value)}
                                                    onClick={(event) => event.stopPropagation()}
                                                    className="rounded-md border border-gray-200 px-2 py-1 text-lg"
                                                />
                                            ) : (
                                                <h3 className="font-serif text-lg font-medium text-maison-primary">
                                                    {group.customer_name || 'No customer reference'}
                                                </h3>
                                            )}
                                            <span className="text-gray-300">|</span>
                                            <span className="font-mono text-sm font-medium text-gray-500">
                                                {group.ticket_number}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm text-maison-secondary">
                                                {group.items.length} {group.items.length === 1 ? 'Product' : 'Products'} Total
                                            </span>
                                            <Badge variant={newItemsCount === group.items.length ? 'warning' : 'neutral'}>
                                                {newItemsCount} / {group.items.length} New
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="ml-3 flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                                        {canManageCustomerService && (
                                            <Button size="sm" variant="secondary" onClick={() => openCreateForTicket(group)}>
                                                <Plus size={14} className="mr-1" />
                                                Add Item
                                            </Button>
                                        )}
                                        {canManageCustomerService && editingTicket === group.ticket_id ? (
                                            <>
                                                <Button size="sm" onClick={() => saveTicketEdit(group.ticket_id)}>Save</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setEditingTicket(null)}>Cancel</Button>
                                            </>
                                        ) : canManageCustomerService && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => startTicketEdit(group)}
                                                    disabled={!allNew}
                                                    title={allNew ? 'Edit customer reference' : 'Ticket is locked after production starts'}
                                                    className={`rounded p-1.5 transition ${allNew ? 'text-gray-400 hover:bg-gray-100 hover:text-maison-primary' : 'cursor-not-allowed text-gray-300'}`}
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteTicket(group)}
                                                    disabled={!allNew}
                                                    title={allNew ? 'Delete ticket' : 'Ticket is locked after production starts'}
                                                    className={`rounded p-1.5 transition ${allNew ? 'text-gray-400 hover:bg-red-50 hover:text-red-600' : 'cursor-not-allowed text-gray-300'}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="bg-white">
                                <Table headers={['Item Key', 'Product', 'Categories', 'Status', 'Date', 'Actions']}>
                                    {group.items.map(item => {
                                        const isNew = itemIsNew(item);
                                        const assignmentNames = item.work_assignments?.map(assignment => assignment.category_types?.name).filter(Boolean) || [];
                                        const uniqueCategories = [...new Set(assignmentNames)];

                                        return (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-mono text-xs font-medium">{item.item_key || '-'}</TableCell>
                                                <TableCell>{item.product_type_name}</TableCell>
                                                <TableCell className="whitespace-normal">
                                                    {uniqueCategories.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {uniqueCategories.map(name => (
                                                                <Badge
                                                                    key={name}
                                                                    variant="neutral"
                                                                    className={getCategoryBadgeClass(name)}
                                                                >
                                                                    {name}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={getStatusVariant(item.status)}>{getStatusLabel(item.status)}</Badge>
                                                </TableCell>
                                                <TableCell className="text-sm text-gray-500">
                                                    {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {canManageCustomerService && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openItemEdit(item)}
                                                                    disabled={!isNew}
                                                                    title={isNew ? 'Edit item' : 'Only New items can be edited'}
                                                                    className={`rounded p-1.5 transition ${isNew ? 'text-gray-400 hover:bg-gray-100 hover:text-maison-primary' : 'cursor-not-allowed text-gray-300'}`}
                                                                >
                                                                    <Edit2 size={16} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => deleteItem(item)}
                                                                    disabled={!isNew}
                                                                    title={isNew ? 'Delete item' : 'Only New items can be deleted'}
                                                                    className={`rounded p-1.5 transition ${isNew ? 'text-gray-400 hover:bg-red-50 hover:text-red-600' : 'cursor-not-allowed text-gray-300'}`}
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </Table>
                                </div>
                            )}
                        </Card>
                    );
                })}

                {!loading && items.length === 0 && (
                    <Card>
                        <div className="py-12 text-center text-sm text-gray-500">No items found matching the selected filters.</div>
                    </Card>
                )}

                {page * PAGE_SIZE < totalTickets && (
                    <div className="flex justify-center py-4">
                        <Button variant="secondary" disabled={loadingMore} isLoading={loadingMore} onClick={() => loadItems({ reset: false })}>
                            Load More
                        </Button>
                    </div>
                )}
            </div>

            <Modal
                isOpen={isCreateOpen}
                onClose={closeCreate}
                title={createContext ? `Add Items to ${createContext.ticket_number}` : 'Create Customer Service Ticket'}
                maxWidth="max-w-2xl"
            >
                <form onSubmit={handleSubmitCreate} className="space-y-5">
                    {createError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {createError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Ticket ID *</label>
                            <input
                                value={ticketForm.ticket_number}
                                onChange={(event) => setTicketForm(prev => ({ ...prev, ticket_number: event.target.value }))}
                                disabled={Boolean(createContext)}
                                required
                                className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 disabled:bg-gray-50"
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Customer Name / Reference *</label>
                            <input
                                value={ticketForm.customer_name}
                                onChange={(event) => setTicketForm(prev => ({ ...prev, customer_name: event.target.value }))}
                                disabled={Boolean(createContext)}
                                required
                                className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 disabled:bg-gray-50"
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-maison-secondary">Products *</label>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setProductRows(prev => [...prev, emptyProductRow()])}>
                                <Plus size={14} className="mr-1" />
                                Add Product
                            </Button>
                        </div>

                        {productRows.map((row, index) => (
                            <div key={index} className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_40px]">
                                    <select
                                        value={row.product_type_id}
                                        onChange={(event) => handleProductRowChange(index, 'product_type_id', event.target.value)}
                                        required
                                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                    >
                                        <option value="">Select product...</option>
                                        {productTypes.map(product => (
                                            <option key={product.id} value={product.id}>{product.name}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min="1"
                                        max="50"
                                        value={row.quantity}
                                        onChange={(event) => handleProductRowChange(index, 'quantity', event.target.value)}
                                        required
                                        className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                    />
                                    <button
                                        type="button"
                                        disabled={productRows.length === 1}
                                        onClick={() => setProductRows(prev => prev.filter((_, rowIndex) => rowIndex !== index))}
                                        className="rounded-md p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                                        title="Remove product row"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                {customFields.length > 0 && (
                                    <div className="grid grid-cols-1 gap-3 border-t border-gray-200 pt-3 md:grid-cols-2">
                                        {customFields.map(field => renderCustomFieldInput(
                                            field,
                                            row.custom_values?.[field.id],
                                            (value) => handleProductRowCustomValueChange(index, field.id, value)
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                        <Button type="button" variant="ghost" onClick={closeCreate} disabled={createLoading}>Cancel</Button>
                        <Button type="submit" disabled={createLoading} isLoading={createLoading}>
                            Create Items
                        </Button>
                    </div>
                </form>
            </Modal>

            <Modal
                isOpen={Boolean(editingItem)}
                onClose={() => setEditingItem(null)}
                title="Edit Item"
                maxWidth="max-w-md"
            >
                {editingItem && (
                    <div className="space-y-5">
                        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                            <div className="font-mono text-xs text-maison-primary">{editingItem.item_key}</div>
                            <div className="mt-1 text-maison-secondary">{editingItem.ticket_number}</div>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Product Type</label>
                            <select
                                value={editProductTypeId}
                                onChange={(event) => setEditProductTypeId(event.target.value)}
                                className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            >
                                <option value="">Select product...</option>
                                {productTypes.map(product => (
                                    <option key={product.id} value={product.id}>{product.name}</option>
                                ))}
                            </select>
                        </div>
                        {customFields.length > 0 && (
                            <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                                <div className="text-sm font-medium text-maison-secondary">Custom Fields</div>
                                <div className="grid grid-cols-1 gap-3">
                                    {customFields.map(field => renderCustomFieldInput(
                                        field,
                                        editCustomValues[field.id],
                                        (value) => handleEditCustomValueChange(field.id, value)
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setEditingItem(null)}>Cancel</Button>
                            <Button onClick={saveItemEdit} disabled={!editProductTypeId}>Save</Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
