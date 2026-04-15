// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Check, ChevronDown, ChevronRight, Search, X, XSquare } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table';

export default function PendingVerification() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('pending');
    const [reversingTaskId, setReversingTaskId] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState({});

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

    const taskOptions = useMemo(() => {
        return [...new Set(tasks.map(task => task.task_type_name).filter(Boolean))].sort();
    }, [tasks]);

    const categoryOptions = useMemo(() => {
        return [...new Set(tasks.map(task => task.category_name).filter(Boolean))].sort();
    }, [tasks]);

    const hasReversalRecord = (task) => Boolean(
        task.reversal_reason ||
        task.reversal_notes ||
        (typeof task.notes === 'string' && task.notes.includes('Reversal:'))
    );

    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            if (filter === 'pending' && task.status !== 'CREATED') return false;
            if (filter === 'approved' && task.status !== 'Approved' && task.status !== 'PAID') return false;
            if (filter === 'rejected' && task.status !== 'Rejected') return false;
            if (filter === 'reversed' && !hasReversalRecord(task)) return false;

            if (searchCustomer && !task.customer_name?.toLowerCase().includes(searchCustomer.toLowerCase())) return false;
            if (searchTicket && !task.item_key?.toLowerCase().includes(searchTicket.toLowerCase())) return false;
            if (searchTailor && !task.tailor_name?.toLowerCase().includes(searchTailor.toLowerCase())) return false;
            if (searchTask && task.task_type_name !== searchTask) return false;
            if (searchCategory && task.category_name !== searchCategory) return false;

            const amount = parseFloat(task.pay_amount || 0);
            if (minAmount !== '' && amount < parseFloat(minAmount)) return false;
            if (maxAmount !== '' && amount > parseFloat(maxAmount)) return false;

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

    const groupedTasks = useMemo(() => {
        const groups = filteredTasks.reduce((acc, task) => {
            const tailorName = task.tailor_name || 'Unassigned';

            if (!acc[tailorName]) {
                acc[tailorName] = {
                    tailorName,
                    tasks: [],
                };
            }

            acc[tailorName].tasks.push(task);
            return acc;
        }, {});

        return Object.values(groups).sort((a, b) => a.tailorName.localeCompare(b.tailorName));
    }, [filteredTasks]);

    const toggleGroup = (tailorName) => {
        setExpandedGroups(prev => ({
            ...prev,
            [tailorName]: !prev[tailorName],
        }));
    };

    const handleApprove = async (task) => {
        if (!window.confirm('Confirm payment approval for this task?')) return;
        if (task.status === 'REVERSED') {
            await db.reopenReversedTask(task.id);
        }
        await db.verifyTask(task.id, 'Approved');
        await loadTasks();
    };

    const handleReject = async (task) => {
        const reason = window.prompt('Enter rejection reason:');
        if (!reason) return;
        if (task.status === 'REVERSED') {
            await db.reopenReversedTask(task.id);
        }
        await db.verifyTask(task.id, 'Rejected', reason);
        await loadTasks();
    };

    const handleReverse = async (task) => {
        const statusLabel = task.status === 'Rejected' ? 'rejected' : 'approved';
        const reason = window.prompt(`Enter reversal reason for this ${statusLabel} task:`);
        if (!reason?.trim()) return;

        try {
            setReversingTaskId(task.id);
            await db.reverseTask(task.id, reason);
            await loadTasks();
        } finally {
            setReversingTaskId(null);
        }
    };

    const getStatusVariant = (status, isReversed) => {
        if (isReversed && status === 'CREATED') return 'warning';
        if (status === 'Approved' || status === 'PAID') return 'success';
        if (status === 'Rejected') return 'danger';
        if (status === 'REVERSED') return 'warning';
        return 'neutral';
    };

    const getReversalNote = (task) => {
        return task.reversal_reason || task.reversal_notes || (
            typeof task.notes === 'string' && task.notes.includes('Reversal:')
                ? task.notes
                : null
        );
    };

    const getStatusLabel = (task) => {
        if (task.status === 'CREATED' && hasReversalRecord(task)) {
            return 'REOPENED';
        }

        return task.status;
    };

    const renderStatusCell = (task) => {
        if (task.status === 'CREATED' || task.status === 'REVERSED') {
            return (
                <div className="space-y-2">
                    {hasReversalRecord(task) && (
                        <>
                            <Badge variant={getStatusVariant(task.status, true)}>
                                {getStatusLabel(task)}
                            </Badge>
                            <div className="max-w-xs whitespace-normal text-xs text-amber-700">
                                Payment reversed: {getReversalNote(task)}
                            </div>
                        </>
                    )}
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() => handleApprove(task)}
                        >
                            <Check size={16} className="mr-1" /> Approve
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleReject(task)}
                        >
                            <XSquare size={16} className="mr-1" /> Reject
                        </Button>
                    </div>
                </div>
            );
        }

        if (task.status === 'Approved' || task.status === 'Rejected') {
            return (
                <div className="space-y-2">
                    <Badge variant={getStatusVariant(task.status, hasReversalRecord(task))}>
                        {getStatusLabel(task)}
                    </Badge>
                    <div>
                        <Button
                            size="sm"
                            variant="secondary"
                            isLoading={reversingTaskId === task.id}
                            onClick={() => handleReverse(task)}
                        >
                            Reverse
                        </Button>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-2">
                <Badge variant={getStatusVariant(task.status, hasReversalRecord(task))}>
                    {getStatusLabel(task)}
                </Badge>
                {hasReversalRecord(task) && getReversalNote(task) && (
                    <div className="max-w-xs whitespace-normal text-xs text-amber-700">
                        Payment reversed: {getReversalNote(task)}
                    </div>
                )}
            </div>
        );
    };

    if (accessDenied) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
                <div className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 px-6 py-5 text-center shadow-sm">
                    <div className="mb-3 text-3xl text-red-500">!</div>
                    <h2 className="mb-1 text-lg font-semibold text-red-700">Access Denied</h2>
                    <p className="text-sm text-red-500">You do not have permission to view this page. Redirecting you now...</p>
                </div>
            </div>
        );
    }

    if (!authorized) return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Accounts Payable</h1>
                    <p className="text-sm text-maison-secondary">Approve completion and authorize payments</p>
                </div>

                <div className="flex rounded-lg bg-gray-100 p-1">
                    {['all', 'pending', 'approved', 'rejected', 'reversed'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setFilter(tab)}
                            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                                filter === tab
                                    ? 'bg-white text-maison-primary shadow'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            <Card padding="p-4">
                <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Customer name"
                                value={searchCustomer}
                                onChange={(e) => setSearchCustomer(e.target.value)}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Ticket / Item key"
                                value={searchTicket}
                                onChange={(e) => setSearchTicket(e.target.value)}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Tailor name"
                                value={searchTailor}
                                onChange={(e) => setSearchTailor(e.target.value)}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <select
                            value={searchTask}
                            onChange={(e) => setSearchTask(e.target.value)}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All tasks</option>
                            {taskOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>

                        <select
                            value={searchCategory}
                            onChange={(e) => setSearchCategory(e.target.value)}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All categories</option>
                            {categoryOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-gray-500">Amount (NGN)</span>
                            <input
                                type="number"
                                placeholder="Min"
                                value={minAmount}
                                onChange={(e) => setMinAmount(e.target.value)}
                                className="w-24 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">-</span>
                            <input
                                type="number"
                                placeholder="Max"
                                value={maxAmount}
                                onChange={(e) => setMaxAmount(e.target.value)}
                                className="w-24 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-gray-500">Date</span>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">-</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        {hasActiveSearch && (
                            <button
                                onClick={clearSearch}
                                className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-500 transition-all hover:bg-gray-50 hover:text-gray-700"
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

            <div className="space-y-4">
                {groupedTasks.map((group) => {
                    const isExpanded = expandedGroups[group.tailorName] ?? true;
                    const decidedCount = group.tasks.filter(task =>
                        task.status === 'Approved' || task.status === 'Rejected' || task.status === 'PAID'
                    ).length;
                    const amendmentCount = group.tasks.filter(task => task.category_name === 'Amendment').length;
                    const sewingCount = group.tasks.filter(task => task.category_name === 'Sewing').length;
                    const cuttingCount = group.tasks.filter(task => task.category_name === 'Cutting').length;
                    const totalPayable = group.tasks.reduce((sum, task) => sum + parseFloat(task.pay_amount || 0), 0);

                    return (
                        <Card key={group.tailorName} padding="p-0" className="overflow-hidden">
                            <button
                                onClick={() => toggleGroup(group.tailorName)}
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
                                            {group.tasks.length} payment{group.tasks.length !== 1 ? 's' : ''} assigned
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className="hidden flex-1 items-center justify-center gap-6 text-sm text-maison-secondary xl:flex">
                                        <span>Amendment: {amendmentCount}</span>
                                        <span>Sewing: {sewingCount}</span>
                                        <span>Cutting: {cuttingCount}</span>
                                    </div>
                                    <span className="hidden text-sm font-medium text-maison-primary lg:inline">
                                        NGN {totalPayable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <Badge variant={decidedCount === group.tasks.length && group.tasks.length > 0 ? 'success' : 'neutral'}>
                                        {decidedCount} / {group.tasks.length} Decided
                                    </Badge>
                                </div>
                            </button>

                            {isExpanded && (
                                <div className="bg-white">
                                    <Table headers={['Date', 'Item Key', 'Customer', 'Task', 'Tailor', 'Payable', 'Status / Action']}>
                                        {group.tasks.map((task) => (
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
                                                <TableCell>{task.tailor_name || 'Unassigned'}</TableCell>
                                                <TableCell className="font-medium">
                                                    NGN {parseFloat(task.pay_amount || 0).toFixed(2)}
                                                </TableCell>
                                                <TableCell>{renderStatusCell(task)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </Table>
                                </div>
                            )}
                        </Card>
                    );
                })}

                {filteredTasks.length === 0 && !loading && (
                    <Card>
                        <div className="px-6 py-8 text-center text-sm text-gray-500">
                            {hasActiveSearch ? 'No results match your search.' : 'No tasks found matching the selected filter.'}
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
