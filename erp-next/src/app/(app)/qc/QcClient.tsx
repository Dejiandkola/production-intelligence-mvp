// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { Modal } from '@/components/UI/Modal';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Search, FilterX } from 'lucide-react';
import ManageItemTasks from './item/[itemId]/QcItemClient';
import { hasPerm } from '@/lib/permissions';

export default function QCQueue({ permissions = [] }: { permissions?: string[] }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, in_production, in_qc, received_attention

    const [filters, setFilters] = useState({
        ticketId: '',
        customerName: '',
        productType: '',
        status: '',
        startDate: '',
        endDate: ''
    });

    const [rateCard, setRateCard] = useState([]);
    const [tailors, setTailors] = useState([]);

    const [selectedItemId, setSelectedItemId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = async () => {
        setLoading(true);
        const [data, rc, t] = await Promise.all([
            db.getItems(),
            db.getRates(),
            db.getTailors()
        ]);
        
        setItems(data.filter(i => i.status !== 'CANCELLED'));
        setRateCard(rc);
        setTailors(t);
        setLoading(false);
    };

    const tabFilteredItems = items.filter(item => {
        if (filter === 'in_production') return item.status === 'IN_PRODUCTION';
        if (filter === 'in_qc') return item.status === 'IN_QC';
        if (filter === 'received_attention') return item.needs_qc_attention;
        return true;
    });

    const uniqueProductTypes = [...new Set(tabFilteredItems.map(i => i.product_type_name))].filter(Boolean);
    const uniqueStatuses = [...new Set(tabFilteredItems.map(i => i.status))].filter(Boolean);

    const filteredItems = tabFilteredItems.filter(item => {
        let match = true;

        if (filters.ticketId && !item.ticket_number?.toLowerCase().includes(filters.ticketId.toLowerCase())) {
            match = false;
        }

        if (filters.customerName && !item.customer_name?.toLowerCase().includes(filters.customerName.toLowerCase())) {
            match = false;
        }

        if (filters.productType && item.product_type_name !== filters.productType) {
            match = false;
        }

        if (filters.status && item.status !== filters.status) {
            match = false;
        }

        if (filters.startDate || filters.endDate) {
            const itemDate = item.created_at ? new Date(item.created_at) : null;

            if (itemDate) {
                if (filters.startDate && itemDate < startOfDay(new Date(filters.startDate))) {
                    match = false;
                }
                if (filters.endDate && itemDate > endOfDay(new Date(filters.endDate))) {
                    match = false;
                }
            }
        }

        return match;
    });

    const canManageQc =
        permissions.includes('manage_qc') ||
        (permissions.length > 0 && hasPerm(permissions, 'manage_qc'));

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Quality Control</h1>
                    <p className="text-sm text-maison-secondary">Assign tasks and verify quality</p>
                </div>

                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'all' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        All Items
                    </button>
                    <button
                        onClick={() => setFilter('in_production')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'in_production' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        New Items
                    </button>
                    <button
                        onClick={() => setFilter('in_qc')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'in_qc' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Assigned
                    </button>
                    <button
                        onClick={() => setFilter('received_attention')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'received_attention' ? 'bg-white shadow text-maison-primary' : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Needs Attention
                    </button>
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
                <Table headers={['Item Key', 'Customer Name', 'Product Type', 'Status', 'Assigned Date']}>
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
                                <TableCell>
                                    <div className="flex flex-col gap-1 items-start">
                                        <div className="flex gap-2">
                                            <Badge
                                                variant={
                                                    item.status === 'IN_PRODUCTION'
                                                        ? 'brand'
                                                        : item.status === 'IN_QC'
                                                            ? 'warning'
                                                            : 'neutral'
                                                }
                                            >
                                                {item.status}
                                            </Badge>
                                            {item.needs_qc_attention && <Badge variant="warning">Check</Badge>}
                                        </div>
                                        {uniqueCategories.length > 0 && (
                                            <div className="flex gap-1 mt-1">
                                                <Badge variant="neutral">{uniqueCategories[0] as string}</Badge>
                                                {uniqueCategories.length > 1 && <Badge variant="neutral">+{uniqueCategories.length - 1}</Badge>}
                                            </div>
                                        )}
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
                            <td colSpan="5" className="px-6 py-8 text-center text-gray-500 text-sm">
                                No items match the selected filters.
                            </td>
                        </tr>
                    )}
                </Table>
            </Card>

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
