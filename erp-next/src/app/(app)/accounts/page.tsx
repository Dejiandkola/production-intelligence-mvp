// @ts-nocheck
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { Check, XSquare, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

export default function PendingVerification() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('pending'); // all, pending, approved, rejected

    // Search & filter state
    const [searchCustomer, setSearchCustomer] = useState('');
    const [searchTicket, setSearchTicket] = useState('');
    const [searchTailor, setSearchTailor] = useState('');
    const [searchTask, setSearchTask] = useState('');
    const [searchCategory, setSearchCategory] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    useEffect(() => {
    checkAccess();
}, []);

const checkAccess = async () => {
    try {
        const permissions = await db.getMyPermissions();
        if (!permissions.includes('admin')) {
            setAccessDenied(true);
            setTimeout(() => {
                if (permissions.includes('manage_qc')) router.replace('/qc');
                else if (permissions.includes('manage_production')) router.replace('/production');
                else if (permissions.includes('manage_completion')) router.replace('/completion');
                else if (permissions.includes('manage_payments')) router.replace('/accounts');
                else router.replace('/unauthorized?reason=no_access');
            }, 2500);
        } else {
            setAuthorized(true);
        }
    } catch {
        router.replace('/unauthorized?reason=no_access');
    }
};

useEffect(() => {
    if (authorized) loadTasks();
}, [authorized]);

    const loadTasks = async () => {
        setLoading(true);
        const data = await db.getTasks();
        setTasks(data);
        setLoading(false);
    };

    const clearSearch = () => {
        setSearchCustomer('');
        setSearchTicket('');
        setSearchTailor('');
        setSearchTask('');
        setSearchCategory('');
        setMinAmount('');
        setMaxAmount('');
        setDateFrom('');
        setDateTo('');
    };

    const hasActiveSearch =
        searchCustomer || searchTicket || searchTailor || searchTask || searchCategory ||
        minAmount || maxAmount || dateFrom || dateTo;

    // Derive unique task type names for the task dropdown
    const taskOptions = useMemo(() => {
        const names = [...new Set(tasks.map(t => t.task_type_name).filter(Boolean))].sort();
        return names;
    }, [tasks]);

    // Derive unique category names for the category dropdown
    const categoryOptions = useMemo(() => {
        const names = [...new Set(tasks.map(t => t.category_name).filter(Boolean))].sort();
        return names;
    }, [tasks]);

    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            // Status tab filter
            if (filter === 'pending' && task.status !== 'CREATED') return false;
            if (filter === 'approved' && task.status !== 'QC_PASSED' && task.status !== 'PAID') return false;
            if (filter === 'rejected' && task.status !== 'QC_FAILED') return false;

            // Customer name
            if (searchCustomer && !task.customer_name?.toLowerCase().includes(searchCustomer.toLowerCase())) return false;

            // Ticket number / item key
            if (searchTicket && !task.item_key?.toLowerCase().includes(searchTicket.toLowerCase())) return false;

            // Tailor name
            if (searchTailor && !task.tailor_name?.toLowerCase().includes(searchTailor.toLowerCase())) return false;

            // Task type (exact match from dropdown)
            if (searchTask && task.task_type_name !== searchTask) return false;

            // Category (exact match from dropdown)
            if (searchCategory && task.category_name !== searchCategory) return false;

            // Amount range
            const amount = parseFloat(task.pay_amount || 0);
            if (minAmount !== '' && amount < parseFloat(minAmount)) return false;
            if (maxAmount !== '' && amount > parseFloat(maxAmount)) return false;

            // Date range
            if (dateFrom || dateTo) {
                const taskDate = new Date(task.created_at);
                if (dateFrom && taskDate < new Date(dateFrom)) return false;
                if (dateTo) {
                    const end = new Date(dateTo);
                    end.setHours(23, 59, 59, 999);
                    if (taskDate > end) return false;
                }
            }

            return true;
        });
    }, [tasks, filter, searchCustomer, searchTicket, searchTailor, searchTask, searchCategory, minAmount, maxAmount, dateFrom, dateTo]);

    const handleApprove = async (taskId) => {
        if (!window.confirm("Confirm payment approval for this task?")) return;
        await db.verifyTask(taskId, 'Approved');
        loadTasks();
    };

    const handleReject = async (taskId) => {
        const reason = window.prompt("Enter rejection reason:");
        if (!reason) return;
        await db.verifyTask(taskId, 'Rejected', reason);
        loadTasks();
    };

    if (accessDenied) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-5 max-w-sm w-full text-center shadow-sm">
            <div className="text-red-500 text-3xl mb-3">⚠</div>
            <h2 className="text-red-700 font-semibold text-lg mb-1">Access Denied</h2>
            <p className="text-red-500 text-sm">You do not have permission to view this page. Redirecting you now...</p>
        </div>
    </div>
);

if (!authorized) return null;
    return (
        <div className="space-y-6">
            {/* Header + status tabs */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Accounts Payable</h1>
                    <p className="text-sm text-maison-secondary">Approve completion and authorize payments</p>
                </div>

                <div className="flex bg-gray-100 p-1 rounded-lg">
                    {['all', 'pending', 'approved', 'rejected'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setFilter(tab)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                                filter === tab
                                    ? 'bg-white shadow text-maison-primary'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Search & Filter Bar */}
            <Card padding="p-4">
                <div className="space-y-3">
                    {/* Row 1: text searches */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Customer name"
                                value={searchCustomer}
                                onChange={e => setSearchCustomer(e.target.value)}
                                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Ticket / Item key"
                                value={searchTicket}
                                onChange={e => setSearchTicket(e.target.value)}
                                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Tailor name"
                                value={searchTailor}
                                onChange={e => setSearchTailor(e.target.value)}
                                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <select
                            value={searchTask}
                            onChange={e => setSearchTask(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary text-gray-700"
                        >
                            <option value="">All tasks</option>
                            {taskOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>

                        <select
                            value={searchCategory}
                            onChange={e => setSearchCategory(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary text-gray-700"
                        >
                            <option value="">All categories</option>
                            {categoryOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Row 2: amount + date + clear */}
                    <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 whitespace-nowrap">Amount (₦)</span>
                            <input
                                type="number"
                                placeholder="Min"
                                value={minAmount}
                                onChange={e => setMinAmount(e.target.value)}
                                className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">—</span>
                            <input
                                type="number"
                                placeholder="Max"
                                value={maxAmount}
                                onChange={e => setMaxAmount(e.target.value)}
                                className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 whitespace-nowrap">Date</span>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={e => setDateFrom(e.target.value)}
                                className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">—</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={e => setDateTo(e.target.value)}
                                className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        {hasActiveSearch && (
                            <button
                                onClick={clearSearch}
                                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-all"
                            >
                                <X size={14} />
                                Clear
                            </button>
                        )}

                        <span className="ml-auto text-xs text-gray-400">
                            {filteredTasks.length} result{filteredTasks.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>
            </Card>

            {/* Table */}
            <Card padding="p-0">
                <Table headers={['Date', 'Item Key', 'Customer', 'Task', 'Tailor', 'Payable', 'Status / Action']}>
                    {filteredTasks.map((task) => (
                        <TableRow key={task.id}>
                            <TableCell className="text-gray-500">
                                {format(new Date(task.created_at), 'MMM d, HH:mm')}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{task.item_key}</TableCell>
                            <TableCell>{task.customer_name}</TableCell>
                            <TableCell>
                                <div className="font-medium">{task.task_type_name}</div>
                                <div className="text-xs text-gray-500">{task.category_name}</div>
                            </TableCell>
                            <TableCell>{task.tailor_name}</TableCell>
                            <TableCell className="font-medium">
                                ₦{parseFloat(task.pay_amount || 0).toFixed(2)}
                            </TableCell>
                            <TableCell>
                                {task.status === 'CREATED' ? (
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                            onClick={() => handleApprove(task.id)}
                                        >
                                            <Check size={16} className="mr-1" /> Approve
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="danger"
                                            onClick={() => handleReject(task.id)}
                                        >
                                            <XSquare size={16} className="mr-1" /> Reject
                                        </Button>
                                    </div>
                                ) : (
                                    <Badge variant={task.status === 'QC_PASSED' || task.status === 'PAID' ? 'success' : 'danger'}>
                                        {task.status}
                                    </Badge>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                    {filteredTasks.length === 0 && !loading && (
                        <tr>
                            <td colSpan="7" className="px-6 py-8 text-center text-gray-500 text-sm">
                                {hasActiveSearch ? 'No results match your search.' : 'No tasks found matching the selected filter.'}
                            </td>
                        </tr>
                    )}
                </Table>
            </Card>
        </div>
    );
}
