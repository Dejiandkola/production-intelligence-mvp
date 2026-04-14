// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { Modal } from '@/components/UI/Modal';
import { CSVImporter } from '@/components/Shared/CSVImporter';
import { Plus, Trash2, Edit2, Search, FilterX, Clock, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { format, startOfDay, endOfDay } from 'date-fns';
import { CreateItemModal } from '@/components/Production/CreateItemModal';

export default function ItemList({ canManageProduction, permissions = [] }: { canManageProduction: boolean, permissions?: string[] }) {
    const router = useRouter();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [rateCards, setRateCards] = useState([]);
    const [tailors, setTailors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        ticketId: '',
        customerName: '',
        productType: '',
        status: '',
        startDate: '',
        endDate: ''
    });
    const [expandedGroups, setExpandedGroups] = useState({});
    const [activeCutterDialog, setActiveCutterDialog] = useState({ itemId: '', mode: '' });
    const [cutterForm, setCutterForm] = useState({
        itemId: '',
        assignmentId: '',
        category_type_id: '',
        task_type_id: '',
        tailor_id: '',
    });
    const [cutterSearch, setCutterSearch] = useState('');

    useEffect(() => {
        loadPageData();
    }, []);

    const loadPageData = async () => {
        setLoading(true);
        const [data, ratesData, tailorsData] = await Promise.all([
            db.getItems(),
            db.getRates(),
            db.getTailors()
        ]);
        setItems(data);
        setRateCards(ratesData);
        setTailors(tailorsData);
        setLoading(false);
    };

    const loadItems = async () => {
        setLoading(true);
        const data = await db.getItems();
        setItems(data);
        setLoading(false);
    };

    const getStatusVariant = (status) => {
        switch (status) {
            case 'IN_PRODUCTION': return 'brand';
            case 'OUT_OF_PRODUCTION': return 'success';
            case 'CANCELLED': return 'danger';
            default: return 'neutral';
        }
    };

    const getStatusLabel = (status) => {
        if (status === 'IN_PRODUCTION') return 'In Production';
        if (status === 'OUT_OF_PRODUCTION') return 'Out of Production';
        return status;
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

    const getCuttingCategoryId = (item) => {
        const cuttingRate = rateCards.find(rate =>
            rate.product_type_id === item.product_type_id &&
            rate.category_name?.toLowerCase() === 'cutting'
        );

        return cuttingRate?.category_type_id || '';
    };

    const getCuttingAssignment = (item) => {
        return item.work_assignments?.find(assignment =>
            assignment.category_types?.name?.toLowerCase() === 'cutting'
        ) || null;
    };

    const getCuttingTaskOptions = (item) => {
        const cuttingCategoryId = getCuttingCategoryId(item);

        return rateCards
            .filter(rate =>
                rate.product_type_id === item.product_type_id &&
                rate.category_type_id === cuttingCategoryId
            )
            .map(rate => ({
                id: rate.task_type_id,
                name: rate.name
            }))
            .filter((option, index, all) => all.findIndex(task => task.id === option.id) === index);
    };

    const activeTailors = tailors.filter(tailor => tailor.active);
    const activeCutterItem = items.find(item => item.id === activeCutterDialog.itemId) || null;
    const filteredCutterTailors = activeTailors.filter(tailor =>
        tailor.name?.toLowerCase().includes(cutterSearch.trim().toLowerCase())
    );

    const [editingTicket, setEditingTicket] = useState(null);
const [editCustomerName, setEditCustomerName] = useState('');

const handleEditTicket = (group) => {
    setEditingTicket(group.ticket_id);
    setEditCustomerName(group.customer_name);
};

const handleSaveTicket = async (ticketId) => {
    if (!editCustomerName.trim()) return;
    try {
        await db.updateTicket(ticketId, { customer_name: editCustomerName.trim() });
        await loadItems();
        setEditingTicket(null);
    } catch (err) {
        alert(err.message);
    }
};

const handleDeleteTicket = async (group) => {
    if (!window.confirm(`Are you sure you want to permanently delete ticket ${group.ticket_id} and all ${group.items.length} item(s) under it? This cannot be undone.`)) return;
    try {
        await db.deleteTicket(group.realTicketId);
        await loadItems();
    } catch (err) {
        alert(err.message);
    }
};

const handleDeleteItem = async (id) => {
        if (!canManageProduction) {
            alert("Master Data writes are read-only for your role.");
            return;
        }
        if (window.confirm("Are you sure you want to delete this item? All associated tasks will also be removed.")) {
            await db.deleteItem(id);
            await loadItems();
        }
    };

    const openCutterForm = (item, mode = 'create') => {
        const cuttingAssignment = getCuttingAssignment(item);
        const cuttingCategoryId = getCuttingCategoryId(item) || cuttingAssignment?.category_type_id || '';

        setActiveCutterDialog({ itemId: item.id, mode });
        setCutterForm({
            itemId: item.id,
            assignmentId: mode === 'edit' ? (cuttingAssignment?.id || '') : '',
            category_type_id: cuttingCategoryId,
            task_type_id: mode === 'edit' ? (cuttingAssignment?.task_type_id || '') : '',
            tailor_id: mode === 'edit' ? (cuttingAssignment?.tailor_id || '') : '',
        });
        setCutterSearch(mode === 'edit' ? (cuttingAssignment?.tailors?.name || '') : '');
    };

    const openDeleteCutterDialog = (item) => {
        const cuttingAssignment = getCuttingAssignment(item);

        setActiveCutterDialog({ itemId: item.id, mode: 'delete' });
        setCutterForm({
            itemId: item.id,
            assignmentId: cuttingAssignment?.id || '',
            category_type_id: cuttingAssignment?.category_type_id || getCuttingCategoryId(item) || '',
            task_type_id: cuttingAssignment?.task_type_id || '',
            tailor_id: cuttingAssignment?.tailor_id || '',
        });
    };

    const closeCutterDialog = () => {
        setActiveCutterDialog({ itemId: '', mode: '' });
        setCutterForm({
            itemId: '',
            assignmentId: '',
            category_type_id: '',
            task_type_id: '',
            tailor_id: '',
        });
        setCutterSearch('');
    };

    const handleCreateCutterAssignment = async (item) => {
        if (!canManageProduction) return;

        if (!cutterForm.category_type_id || !cutterForm.task_type_id || !cutterForm.tailor_id) {
            alert('Please select a cutter and task type.');
            return;
        }

        await db.createWorkAssignment({
            item_id: item.id,
            category_type_id: cutterForm.category_type_id,
            task_type_id: cutterForm.task_type_id,
            tailor_id: cutterForm.tailor_id
        });

        closeCutterDialog();
        await loadItems();
    };

    const handleUpdateCutterAssignment = async () => {
        if (!canManageProduction) return;

        if (!cutterForm.assignmentId || !cutterForm.category_type_id || !cutterForm.task_type_id || !cutterForm.tailor_id) {
            alert('Please select a cutter and task type.');
            return;
        }

        await db.updateWorkAssignment(cutterForm.assignmentId, {
            category_type_id: cutterForm.category_type_id,
            task_type_id: cutterForm.task_type_id,
            tailor_id: cutterForm.tailor_id
        });

        closeCutterDialog();
        await loadItems();
    };

    const handleDeleteCutterAssignment = async (assignmentId) => {
        if (!canManageProduction) return;
        await db.deleteWorkAssignment(assignmentId);
        closeCutterDialog();
        await loadItems();
    };

    const handleStatusChange = async (itemId, newStatus) => {
        if (!canManageProduction) return;
        await db.updateItemStatus(itemId, newStatus);
        await loadItems();
    };

    const totalBacklog = items.filter(i => i.status !== 'OUT_OF_PRODUCTION' && i.status !== 'CANCELLED').length;
    const totalCompleted = items.filter(i => i.status === 'OUT_OF_PRODUCTION').length;

    const uniqueProductTypes = [...new Set(items.map(i => i.product_type_name))].filter(Boolean);
    const uniqueStatuses = [...new Set(items.map(i => i.status))].filter(Boolean);

    const filteredItems = items.filter(item => {
        let match = true;

        if (filters.ticketId && !item.ticket_number?.toLowerCase().includes(filters.ticketId.toLowerCase())) match = false;
        if (filters.customerName && !item.customer_name?.toLowerCase().includes(filters.customerName.toLowerCase())) match = false;
        if (filters.productType && item.product_type_name !== filters.productType) match = false;
        if (filters.status && item.status !== filters.status) match = false;

        if (filters.startDate || filters.endDate) {
            const itemDate = new Date(item.created_at);
            if (filters.startDate && itemDate < startOfDay(new Date(filters.startDate))) match = false;
            if (filters.endDate && itemDate > endOfDay(new Date(filters.endDate))) match = false;
        }

        return match;
    });

    const groupedItems = filteredItems.reduce((acc, item) => {
        const tId = item.ticket_number || 'Unassigned';
        if (!acc[tId]) {
            acc[tId] = {
                ticket_id: tId,
                realTicketId: item.ticket_id,
                customer_name: item.customer_name || 'Unknown Client',
                items: []
            };
        }
        acc[tId].items.push(item);
        return acc;
    }, {});

    const toggleGroup = (ticketId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [ticketId]: !prev[ticketId]
        }));
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Production Items</h1>
                    <p className="text-sm text-maison-secondary">Track all physical items in the pipeline</p>
                </div>
                <div className="flex gap-3">
                    {canManageProduction && (
                        <CSVImporter
                            onImport={async (data) => {
                                if (!canManageProduction) {
                                    alert("Master Data writes are read-only for your role.");
                                    return;
                                }

                                let count = 0;
                                let skipped = 0;
                                const skippedRows = [];

                                setLoading(true);

                                try {
                                    // Pre-fetch product types once
                                    const productTypes = await db.getProductTypes();

                                    for (const row of data) {
                                        try {
                                            const ticket_id = row['Ticket ID'];
                                            const customer_name = row.Customer;
                                            const productTypeName = row['Product Type'];
                                            const quantity = parseInt(row.Quantity) || 1;
                                            const notes = row.Notes || '';

                                            // Skip invalid rows
                                            if (!ticket_id || !customer_name || !productTypeName) {
                                                skipped++;
                                                skippedRows.push({ row, reason: 'Missing required fields' });
                                                continue;
                                            }

                                            let pt = productTypes.find(
                                                p => p.name.toLowerCase() === productTypeName.toLowerCase()
                                            );

                                            if (!pt) {
                                                pt = await db.createProductType(productTypeName);
                                            }

                                            await db.createItem({
                                                ticket_id,
                                                customer_name,
                                                product_type_id: pt.id,
                                                quantity,
                                                notes,
                                                created_by_role: 'production'
                                            });

                                            count++;
                                        } catch (rowError) {
                                            skipped++;
                                            skippedRows.push({
                                                row,
                                                reason: rowError.message || 'Row failed'
                                            });

                                            console.error('Row failed:', row, rowError);
                                        }
                                    }

                                    await loadItems();

                                    console.log('Skipped rows:', skippedRows);

                                    alert(
                                        `Import complete.\nCreated: ${count}\nSkipped: ${skipped}`
                                    );
                                } catch (error) {
                                    console.error('Import failed:', error);
                                    alert(error.message || 'Import failed.');
                                } finally {
                                    setLoading(false);
                                }
                            }}
                        />
                    )}
                    <Button onClick={() => setIsCreateModalOpen(true)} disabled={!canManageProduction}>
                        <Plus size={16} className="mr-2" />
                        Create Item
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="flex items-center gap-4">
                    <div className="p-3 bg-brand-50 text-maison-primary rounded-lg border border-brand-100">
                        <Clock size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Total Backlog</p>
                        <h3 className="text-2xl font-serif text-maison-primary">{totalBacklog}</h3>
                    </div>
                </Card>
                <Card className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Total Out of Production</p>
                        <h3 className="text-2xl font-serif text-maison-primary">{totalCompleted}</h3>
                    </div>
                </Card>
            </div>

            <Card className="pb-4">
                <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Ticket ID</label>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="..."
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
                            placeholder="Search name..."
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
                            {uniqueProductTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
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
                            {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
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
                        onClick={() => setFilters({ ticketId: '', customerName: '', productType: '', status: '', startDate: '', endDate: '' })}
                        className="text-gray-500 hover:text-gray-700 bg-gray-50 px-3"
                        title="Clear Filters"
                    >
                        <FilterX size={16} />
                    </Button>
                </div>
            </Card>

            <div className="space-y-4">
                {Object.values(groupedItems).map((group) => {
                    const isExpanded = expandedGroups[group.ticket_id];
                    return (
                        <Card key={group.ticket_id} padding="p-0" className="overflow-hidden border border-gray-200">
                            {/* Accordion Header */}
                            <div
                                className={`flex items-center justify-between p-3 transition-colors ${isExpanded ? 'bg-gray-50 border-b border-gray-200' : 'hover:bg-gray-50'}`}
                            >
                                <div className="flex items-center gap-3 w-full">
                                    <div
                                        className="text-maison-primary min-w-5 cursor-pointer"
                                        onClick={() => toggleGroup(group.ticket_id)}
                                    >
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    </div>
                                    <div
                                        className="flex-1 flex items-center justify-between cursor-pointer"
                                        onClick={() => toggleGroup(group.ticket_id)}
                                    >
                                        <div className="flex items-center gap-4">
                                            {editingTicket === group.ticket_id ? (
                                                <input
                                                    type="text"
                                                    value={editCustomerName}
                                                    onChange={e => setEditCustomerName(e.target.value)}
                                                    onClick={e => e.stopPropagation()}
                                                    className="px-2 py-1 text-sm border border-maison-primary rounded-md focus:outline-none"
                                                    autoFocus
                                                />
                                            ) : (
                                                <h3 className="font-serif font-medium text-lg text-maison-primary">
                                                    {group.customer_name}
                                                </h3>
                                            )}
                                            <span className="text-gray-300">|</span>
                                            <span className="font-mono text-sm font-medium text-gray-500">
                                                {group.ticket_id}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm text-maison-secondary">
                                                {group.items.length} {group.items.length === 1 ? 'Product' : 'Products'} Total
                                            </span>
                                            <Badge variant={group.items.filter(i => i.status === 'OUT_OF_PRODUCTION').length === group.items.length ? 'success' : 'neutral'}>
                                                {group.items.filter(i => i.status === 'OUT_OF_PRODUCTION').length} / {group.items.length} Out of Production
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Ticket actions */}
                                    <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                                        {editingTicket === group.ticket_id ? (
                                            <>
                                                <button
                                                    onClick={() => handleSaveTicket(group.realTicketId)}
                                                    className="px-2 py-1 text-xs bg-maison-primary text-white rounded-md hover:opacity-90"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    onClick={() => setEditingTicket(null)}
                                                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md"
                                                >
                                                    Cancel
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                {canManageProduction && (
                                                    <button
                                                        onClick={() => handleEditTicket(group)}
                                                        className="p-1.5 text-gray-400 hover:text-maison-primary hover:bg-gray-100 rounded transition-colors"
                                                        title="Edit Customer Name"
                                                    >
                                                        <Edit2 size={15} />
                                                    </button>
                                                )}
                                                {permissions?.includes('admin') && (
                                                    <button
                                                        onClick={() => handleDeleteTicket(group)}
                                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                        title="Delete Ticket"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Accordion Body */}
                            {isExpanded && (
                                <div className="bg-white">
                                    <Table headers={['Item Key', 'Product', 'Categories', 'Status', 'Date', 'Actions']}>
                                        {group.items.map((item) => {
                                            const assignedCategories = item.work_assignments?.map(wa => wa.category_types?.name).filter(Boolean) || [];
                                            const uniqueCategories = [...new Set(assignedCategories)];
                                            const cuttingAssignment = getCuttingAssignment(item);
                                            const cuttingTaskOptions = getCuttingTaskOptions(item);
                                            const itemCanAssignCutting = Boolean(getCuttingCategoryId(item)) && cuttingTaskOptions.length > 0;
                                            const showCuttingControls = Boolean(cuttingAssignment) || itemCanAssignCutting;

                                            return (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium font-mono text-xs">{item.item_key}</TableCell>
                                                <TableCell>{item.product_type_name}</TableCell>
                                                <TableCell className="whitespace-normal">
                                                    {uniqueCategories.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {uniqueCategories.map(category => (
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
                                                    {canManageProduction ? (
                                                        <select
                                                            value={item.status}
                                                            onChange={(e) => handleStatusChange(item.id, e.target.value)}
                                                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                                        >
                                                            <option value="IN_PRODUCTION">In Production</option>
                                                            <option value="OUT_OF_PRODUCTION">Out of Production</option>
                                                        </select>
                                                    ) : (
                                                        <Badge variant={getStatusVariant(item.status)}>
                                                            {getStatusLabel(item.status)}
                                                        </Badge>
                                                    )}
                                                    {item.needs_qc_attention && (
                                                        <Badge variant="warning" className="ml-2">Needs QC</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-500 text-sm">
                                                    {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        {canManageProduction && showCuttingControls && (
                                                            <>
                                                                {!cuttingAssignment ? (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        onClick={() => openCutterForm(item, 'create')}
                                                                    >
                                                                        Assign Cutter
                                                                    </Button>
                                                                ) : (
                                                                    <>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="secondary"
                                                                            onClick={() => openCutterForm(item, 'edit')}
                                                                        >
                                                                            Edit Cutter
                                                                        </Button>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="danger"
                                                                            onClick={() => openDeleteCutterDialog(item)}
                                                                        >
                                                                            Delete Cutter
                                                                        </Button>
                                                                    </>
                                                                )}
                                                            </>
                                                        )}

                                                        <button
                                                            onClick={() => handleDeleteItem(item.id)}
                                                            disabled={!canManageProduction}
                                                            className={`p-1.5 rounded transition-colors ${!canManageProduction ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                                            title="Delete Item"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )})}
                                    </Table>
                                </div>
                            )}
                        </Card>
                    );
                })}

                {filteredItems.length === 0 && !loading && (
                    <Card>
                        <div className="py-12 text-center text-gray-500 text-sm">
                            No items found matching the selected filters.
                        </div>
                    </Card>
                )}
            </div>
            {isCreateModalOpen && (
                <CreateItemModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setIsCreateModalOpen(false)}
                    onSuccess={loadItems}
                />
            )}

            <Modal
                isOpen={Boolean(activeCutterDialog.itemId)}
                onClose={closeCutterDialog}
                title={
                    activeCutterDialog.mode === 'create'
                        ? 'Assign Cutter'
                        : activeCutterDialog.mode === 'edit'
                            ? 'Edit Cutter'
                            : 'Delete Cutter'
                }
                maxWidth="max-w-md"
            >
                {activeCutterItem && (
                    <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                        <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-maison-primary">{activeCutterItem.item_key}</span>
                            <Badge variant="neutral">{activeCutterItem.product_type_name}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-maison-secondary">
                            Ticket: {activeCutterItem.ticket_number} | Customer: {activeCutterItem.customer_name}
                        </p>
                    </div>
                )}

                {activeCutterDialog.mode === 'delete' ? (
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">Remove this cutting assignment from the item?</p>
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={closeCutterDialog}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleDeleteCutterAssignment(cutterForm.assignmentId)}
                            >
                                Delete Cutter
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={cutterSearch}
                                onChange={(e) => {
                                    setCutterSearch(e.target.value);
                                    setCutterForm(prev => ({ ...prev, tailor_id: '' }));
                                }}
                                placeholder="Type cutter name..."
                                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                {filteredCutterTailors.length > 0 ? filteredCutterTailors.map(tailor => (
                                    <button
                                        key={tailor.id}
                                        type="button"
                                        onClick={() => {
                                            setCutterForm(prev => ({ ...prev, tailor_id: tailor.id }));
                                            setCutterSearch(tailor.name);
                                        }}
                                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                    >
                                        <span>{tailor.name}</span>
                                        <span className="text-xs text-gray-500">Band {tailor.band || 'A'}</span>
                                    </button>
                                )) : (
                                    <div className="px-3 py-2 text-sm text-gray-500">No matching cutters found.</div>
                                )}
                            </div>
                        </div>
                        <select
                            value={cutterForm.task_type_id}
                            onChange={(e) => setCutterForm(prev => ({ ...prev, task_type_id: e.target.value }))}
                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        >
                            <option value="">Select Cutting Task...</option>
                            {activeCutterItem
                                ? getCuttingTaskOptions(activeCutterItem).map(task => (
                                    <option key={task.id} value={task.id}>
                                        {task.name}
                                    </option>
                                ))
                                : null}
                        </select>
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={closeCutterDialog}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => {
                                    const item = items.find(entry => entry.id === activeCutterDialog.itemId);
                                    if (!item) return;
                                    if (activeCutterDialog.mode === 'edit') {
                                        handleUpdateCutterAssignment();
                                    } else {
                                        handleCreateCutterAssignment(item);
                                    }
                                }}
                            >
                                {activeCutterDialog.mode === 'edit' ? 'Save' : 'Assign'}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
