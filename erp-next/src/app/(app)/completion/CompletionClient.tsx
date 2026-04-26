// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { PackageCheck, ChevronDown, ChevronRight, Search, FilterX } from 'lucide-react';
import { format } from 'date-fns';

const TICKET_PAGE_SIZE = 50;
const RECEIVING_STATUS_OPTIONS = ['Received', 'Not Received'];

export default function Receiving({ canManageCompletion }: { canManageCompletion: boolean }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [totalTickets, setTotalTickets] = useState(0);
    const [productTypes, setProductTypes] = useState([]);
    // Maintain the default 'Available' filter state by pre-setting status to 'Assigned by QC'
    const [filters, setFilters] = useState({
        ticketId: '',
        customerName: '',
        productType: '',
        status: '', // Default to All Statuses
        startDate: '',
        endDate: ''
    });
    const [expandedGroups, setExpandedGroups] = useState({});

    useEffect(() => {
        loadItems({ reset: true });
    }, [filters]);

    const loadItems = async ({ reset = true } = {}) => {
        const nextPage = reset ? 1 : page + 1;
        if (reset) setLoading(true);
        else setLoadingMore(true);

        try {
            const [result, productTypesData] = await Promise.all([
                db.getTicketPaginatedItems({
                    ...filters,
                    receivingStatus: filters.status,
                    status: ''
                }, nextPage, TICKET_PAGE_SIZE, { excludeCancelled: true, excludeArchived: true }),
                reset ? db.getProductTypes() : Promise.resolve(productTypes)
            ]);
            setItems(prev => reset ? result.items : [...prev, ...result.items]);
            setTotalTickets(result.totalTickets);
            setPage(nextPage);
            if (reset) setProductTypes(productTypesData);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const uniqueProductTypes = productTypes.map(productType => productType.name).filter(Boolean);
    const uniqueStatuses = RECEIVING_STATUS_OPTIONS;

    const filteredItems = items;

    // Group items by ticket_number
    const groupedItems = filteredItems.reduce((acc, item) => {
        if (!acc[item.ticket_number]) {
            acc[item.ticket_number] = {
                ticket_number: item.ticket_number,
                customer_name: item.customer_name,
                items: []
            };
        }
        acc[item.ticket_number].items.push(item);
        return acc;
    }, {});

    const toggleGroup = (ticketNumber) => {
        setExpandedGroups(prev => ({
            ...prev,
            [ticketNumber]: !prev[ticketNumber]
        }));
    };

    const handleReceive = async (itemId) => {
        if (!canManageCompletion) {
            alert("Master Data writes are read-only for your role.");
            return;
        }
        if (!window.confirm("Mark item as received?")) return;
        await db.updateItemReceivingStatus(itemId, true);
        loadItems();
    };

    const handleUnreceive = async (itemId) => {
        if (!canManageCompletion) {
            alert("Master Data writes are read-only for your role.");
            return;
        }
        if (!window.confirm("Unmark item as received?")) return;
        await db.updateItemReceivingStatus(itemId, false);
        loadItems();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Completion & Receiving</h1>
                    <p className="text-sm text-maison-secondary">Mark items as finished and received into stock</p>
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
                    const isExpanded = expandedGroups[group.ticket_number];
                    return (
                        <Card key={group.ticket_number} padding="p-0" className="overflow-hidden border border-gray-200">
                            {/* Accordion Header */}
                            <div
                                onClick={() => toggleGroup(group.ticket_number)}
                                className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50 border-b border-gray-200' : ''}`}
                            >
                                <div className="flex items-center gap-3 w-full">
                                    <div className="text-maison-primary min-w-5">
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    </div>
                                    <div className="flex-1 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <h3 className="font-serif font-medium text-lg text-maison-primary">
                                                {group.customer_name}
                                            </h3>
                                            <span className="text-gray-300">|</span>
                                            <span className="font-mono text-sm font-medium text-gray-500">
                                                {group.ticket_number}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm text-maison-secondary">
                                                {group.items.length} {group.items.length === 1 ? 'Product' : 'Products'} Total
                                            </span>
                                            <Badge variant={group.items.filter(i => i.is_received).length === group.items.length ? 'success' : 'neutral'}>
                                                {group.items.filter(i => i.is_received).length} / {group.items.length} Received
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Accordion Body */}
                            {isExpanded && (
                                <div className="bg-white">
                                    <Table headers={['Item Key', 'Product', 'Current Status', 'Action']}>
                                        {group.items.map((item) => (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium font-mono text-xs">{item.item_key}</TableCell>
                                                <TableCell>{item.product_type_name}</TableCell>
                                                <TableCell>
                                                    <Badge variant={item.is_received ? 'success' : 'brand'}>
                                                        {item.receiving_status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {!item.is_received ? (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleReceive(item.id)}
                                                            disabled={!canManageCompletion}
                                                        >
                                                            <PackageCheck size={16} className="mr-2" />
                                                            Mark Received
                                                        </Button>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-green-600 font-medium flex items-center gap-1 bg-green-50 px-2 py-1 rounded">
                                                                <PackageCheck size={14} /> Received
                                                            </span>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => handleUnreceive(item.id)}
                                                                disabled={!canManageCompletion}
                                                                title="Undo Receive"
                                                            >
                                                                Unmark
                                                            </Button>
                                                        </div>
                                                    )}
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
                            No items match the current filter.
                        </div>
                    </Card>
                )}

                {page * TICKET_PAGE_SIZE < totalTickets && (
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
            </div>
        </div>
    );
}
