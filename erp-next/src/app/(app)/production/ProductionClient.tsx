// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { CSVImporter } from '@/components/Shared/CSVImporter';
import { Plus, Trash2, Edit2, Search, FilterX, Clock, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { format, startOfDay, endOfDay } from 'date-fns';
import { CreateItemModal } from '@/components/Production/CreateItemModal';

export default function ItemList({ canManageProduction, permissions = [] }: { canManageProduction: boolean, permissions?: string[] }) {
    const router = useRouter();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [items, setItems] = useState([]);
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

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = async () => {
        setLoading(true);
        const data = await db.getItems();
        setItems(data);
        setLoading(false);
    };

    const getStatusVariant = (status) => {
        switch (status) {
            case 'IN_PRODUCTION': return 'brand';
            case 'IN_QC': return 'warning';
            case 'COMPLETED': return 'success';
            case 'CANCELLED': return 'danger';
            case 'Hold': return 'warning';
            default: return 'neutral';
        }
    };

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

    const totalBacklog = items.filter(i => i.status !== 'COMPLETED' && i.status !== 'CANCELLED').length;
    const totalCompleted = items.filter(i => i.status === 'COMPLETED').length;

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
                        <p className="text-sm font-medium text-gray-500">Total Items Completed</p>
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
                                            <Badge variant={group.items.filter(i => i.status === 'COMPLETED').length === group.items.length ? 'success' : 'neutral'}>
                                                {group.items.filter(i => i.status === 'COMPLETED').length} / {group.items.length} Completed
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
                                    <Table headers={['Item Key', 'Product', 'Status', 'Date', 'Actions']}>
                                        {group.items.map((item) => (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium font-mono text-xs">{item.item_key}</TableCell>
                                                <TableCell>{item.product_type_name}</TableCell>
                                                <TableCell>
                                                    <Badge variant={getStatusVariant(item.status)}>
                                                        {item.status === 'COMPLETED' ? 'Received' : item.status}
                                                    </Badge>
                                                    {item.needs_qc_attention && (
                                                        <Badge variant="warning" className="ml-2">Needs QC</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-500 text-sm">
                                                    {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <button
                                                        onClick={() => handleDeleteItem(item.id)}
                                                        disabled={!canManageProduction}
                                                        className={`p-1.5 rounded transition-colors ${!canManageProduction ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                                        title="Delete Item"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
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
        </div>
    );
}
