// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Check, ChevronDown, ChevronRight, Search, X, XSquare } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table';
import { Modal } from '@/components/UI/Modal';
import { formatMoney } from '@/lib/formatters';

const TAILOR_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;
const ACCOUNT_FILTER_TABS = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'price-review', label: 'Price Review' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'reversed', label: 'Reversed' },
];

export default function PendingVerification() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [tasks, setTasks] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [filter, setFilter] = useState('pending');
    const [reversingTaskId, setReversingTaskId] = useState(null);
    const [activeNegotiatedTask, setActiveNegotiatedTask] = useState(null);
    const [negotiatedForm, setNegotiatedForm] = useState({ amount: '', note: '' });
    const [savingNegotiatedTaskId, setSavingNegotiatedTaskId] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState({});
    const [taskOptions, setTaskOptions] = useState([]);
    const [categoryOptions, setCategoryOptions] = useState([]);
    const activeRequestIdRef = useRef(0);

    const [searchCustomer, setSearchCustomer] = useState('');
    const [searchTicket, setSearchTicket] = useState('');
    const [searchTailor, setSearchTailor] = useState('');
    const [searchTask, setSearchTask] = useState('');
    const [searchCategory, setSearchCategory] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState({
        searchCustomer: '',
        searchTicket: '',
        searchTailor: '',
        minAmount: '',
        maxAmount: '',
    });

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
                    else if (permissions.includes('manage_customer_service')) router.replace('/customer-service');
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
        if (authorized) {
            loadFilterOptions();
        }
    }, [authorized]);

    useEffect(() => {
        if (authorized) {
            loadTasks();
        }
    }, [authorized, filter, searchTask, searchCategory, dateFrom, dateTo, page, debouncedSearch]);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            const nextSearch = {
                searchCustomer,
                searchTicket,
                searchTailor,
                minAmount,
                maxAmount,
            };

            setPage(1);
            setDebouncedSearch(prev => {
                const unchanged = Object.keys(nextSearch).every(key => prev[key] === nextSearch[key]);
                return unchanged ? prev : nextSearch;
            });
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(debounceTimer);
    }, [searchCustomer, searchTicket, searchTailor, minAmount, maxAmount]);

    const loadFilterOptions = async () => {
        try {
            const [taskTypes, categories] = await Promise.all([
                db.getTaskTypes(),
                db.getCategories(),
            ]);
            setTaskOptions(taskTypes.map(task => task.name).filter(Boolean).sort());
            setCategoryOptions(categories.map(category => category.name).filter(Boolean).sort());
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
            const result = await db.getAccountTasks({
                filter,
                ...debouncedSearch,
                searchTask,
                searchCategory,
                dateFrom,
                dateTo,
            }, page, TAILOR_PAGE_SIZE);
            if (requestId !== activeRequestIdRef.current) return;

            setTasks(result.data);
            setTotalCount(result.count);
        } catch (error) {
            if (requestId !== activeRequestIdRef.current) return;

            console.error(error);
            setTasks([]);
            setTotalCount(0);
            setLoadError(error?.message || 'Unable to load account tasks.');
        } finally {
            if (requestId === activeRequestIdRef.current) {
                setLoading(false);
            }
        }
    };

    const clearSearch = () => {
        setPage(1);
        setSearchCustomer('');
        setSearchTicket('');
        setSearchTailor('');
        setSearchTask('');
        setSearchCategory('');
        setMinAmount('');
        setMaxAmount('');
        setDateFrom('');
        setDateTo('');
        setDebouncedSearch({
            searchCustomer: '',
            searchTicket: '',
            searchTailor: '',
            minAmount: '',
            maxAmount: '',
        });
    };

    const hasActiveSearch =
        searchCustomer || searchTicket || searchTailor || searchTask || searchCategory ||
        minAmount || maxAmount || dateFrom || dateTo;

    const hasReversalRecord = (task) => Boolean(
        task.reversal_reason ||
        task.reversal_notes ||
        (typeof task.notes === 'string' && task.notes.includes('Reversal:'))
    );

    const filteredTasks = tasks;

    const groupedTasks = useMemo(() => {
        const groups = filteredTasks.reduce((acc, task) => {
            const tailorName = task.tailor_name || 'Unassigned';
            const tailorKey = task.tailor_group_key || task.tailor_id || tailorName;

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
    }, [filteredTasks]);

    const totalPages = Math.max(1, Math.ceil(totalCount / TAILOR_PAGE_SIZE));
    const pageStart = totalCount === 0 ? 0 : ((page - 1) * TAILOR_PAGE_SIZE) + 1;
    const pageEnd = Math.min(page * TAILOR_PAGE_SIZE, totalCount);

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

    const openNegotiatedPriceDialog = (task) => {
        setActiveNegotiatedTask(task);
        setNegotiatedForm({
            amount: String(task.negotiated_pay_amount ?? task.pay_amount ?? ''),
            note: task.negotiated_price_note || task.price_review_reason || '',
        });
    };

    const closeNegotiatedPriceDialog = () => {
        setActiveNegotiatedTask(null);
        setNegotiatedForm({ amount: '', note: '' });
    };

    const handleSaveNegotiatedPrice = async () => {
        if (!activeNegotiatedTask) return;

        const amount = Number(negotiatedForm.amount);

        if (!Number.isFinite(amount) || amount < 0) {
            alert('Enter a valid negotiated price.');
            return;
        }

        try {
            setSavingNegotiatedTaskId(activeNegotiatedTask.id);
            await db.setAssignmentNegotiatedPrice(activeNegotiatedTask.id, amount, negotiatedForm.note);
            closeNegotiatedPriceDialog();
            await loadTasks();
        } catch (error) {
            alert(error?.message || 'Failed to save negotiated price.');
        } finally {
            setSavingNegotiatedTaskId(null);
        }
    };

    const handleClearNegotiatedPrice = async () => {
        if (!activeNegotiatedTask) return;
        if (!window.confirm('Clear this negotiated price and return the task to normal pricing?')) return;

        try {
            setSavingNegotiatedTaskId(activeNegotiatedTask.id);
            await db.clearAssignmentNegotiatedPrice(activeNegotiatedTask.id);
            closeNegotiatedPriceDialog();
            await loadTasks();
        } catch (error) {
            alert(error?.message || 'Failed to clear negotiated price.');
        } finally {
            setSavingNegotiatedTaskId(null);
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

    const getTaskPaySourceLabel = (task) => {
        if (
            task.pay_source === 'NEGOTIATED_PRICE' ||
            (task.negotiated_pay_amount !== null && task.negotiated_pay_amount !== undefined)
        ) {
            return 'Negotiated Price';
        }

        if (task.pay_source === 'SPECIAL_PAY') return 'Special Pay';
        if (task.pay_source === 'RATE_CARD') return 'Rate Card';
        if (task.rate_snapshot !== null && task.rate_snapshot !== undefined && Number(task.pay_amount || 0) !== Number(task.rate_snapshot || 0)) {
            return 'Special Pay';
        }

        return 'Rate Card';
    };

    const getTaskPaySourceVariant = (source) => {
        if (source === 'Negotiated Price') return 'warning';
        if (source === 'Special Pay') return 'success';
        return 'neutral';
    };

    const renderPayableCell = (task) => {
        const paySource = getTaskPaySourceLabel(task);
        const canReviewPrice = task.status === 'CREATED' || task.status === 'REVERSED';

        return (
            <div className="space-y-2">
                <div className="font-medium">{formatMoney(task.pay_amount)}</div>
                <div className="flex flex-wrap gap-1">
                    <Badge variant={getTaskPaySourceVariant(paySource)}>
                        {paySource}
                    </Badge>
                    {task.price_review_requested && (
                        <Badge variant="warning" title={task.price_review_reason || 'Price review requested'}>
                            Needs Review
                        </Badge>
                    )}
                </div>
                {task.price_review_reason && (
                    <div
                        className="max-w-[220px] truncate text-xs text-amber-700"
                        title={task.price_review_reason}
                    >
                        {task.price_review_reason}
                    </div>
                )}
                {canReviewPrice && (
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openNegotiatedPriceDialog(task)}
                    >
                        {task.price_review_requested ? 'Review Price' : task.negotiated_pay_amount ? 'Edit Price' : 'Set Price'}
                    </Button>
                )}
            </div>
        );
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
                    {ACCOUNT_FILTER_TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => {
                                setPage(1);
                                setFilter(tab.key);
                            }}
                            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                                filter === tab.key
                                    ? 'bg-white text-maison-primary shadow'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tab.label}
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
                                onChange={(e) => {
                                    setSearchCustomer(e.target.value);
                                }}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Ticket / Item key"
                                value={searchTicket}
                                onChange={(e) => {
                                    setSearchTicket(e.target.value);
                                }}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Tailor name"
                                value={searchTailor}
                                onChange={(e) => {
                                    setSearchTailor(e.target.value);
                                }}
                                className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <select
                            value={searchTask}
                            onChange={(e) => {
                                setPage(1);
                                setSearchTask(e.target.value);
                            }}
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-maison-primary"
                        >
                            <option value="">All tasks</option>
                            {taskOptions.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>

                        <select
                            value={searchCategory}
                            onChange={(e) => {
                                setPage(1);
                                setSearchCategory(e.target.value);
                            }}
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
                                onChange={(e) => {
                                    setMinAmount(e.target.value);
                                }}
                                className="w-24 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">-</span>
                            <input
                                type="number"
                                placeholder="Max"
                                value={maxAmount}
                                onChange={(e) => {
                                    setMaxAmount(e.target.value);
                                }}
                                className="w-24 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-gray-500">Date</span>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => {
                                    setPage(1);
                                    setDateFrom(e.target.value);
                                }}
                                className="rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-maison-primary"
                            />
                            <span className="text-xs text-gray-400">-</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => {
                                    setPage(1);
                                    setDateTo(e.target.value);
                                }}
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
                            {loading ? 'Loading...' : `${pageStart}-${pageEnd} of ${totalCount} tailor group${totalCount !== 1 ? 's' : ''}`}
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
                {groupedTasks.map((group) => {
                    const isExpanded = expandedGroups[group.tailorKey] ?? true;
                    const decidedCount = group.tasks.filter(task =>
                        task.status === 'Approved' || task.status === 'Rejected' || task.status === 'PAID'
                    ).length;
                    const amendmentCount = group.tasks.filter(task => task.category_name === 'Amendment').length;
                    const sewingCount = group.tasks.filter(task => task.category_name === 'Sewing').length;
                    const cuttingCount = group.tasks.filter(task => task.category_name === 'Cutting').length;
                    const totalPayable = group.tasks.reduce((sum, task) => sum + parseFloat(task.pay_amount || 0), 0);

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
                                        {formatMoney(totalPayable)}
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
                                                <TableCell>{renderPayableCell(task)}</TableCell>
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

            <Modal
                isOpen={Boolean(activeNegotiatedTask)}
                onClose={closeNegotiatedPriceDialog}
                title="Negotiated Price"
                maxWidth="max-w-2xl"
            >
                {activeNegotiatedTask && (
                    <div className="space-y-5">
                        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-maison-primary">{activeNegotiatedTask.item_key}</span>
                                <Badge variant="neutral">{activeNegotiatedTask.category_name || 'Uncategorised'}</Badge>
                                <Badge variant={getTaskPaySourceVariant(getTaskPaySourceLabel(activeNegotiatedTask))}>
                                    {getTaskPaySourceLabel(activeNegotiatedTask)}
                                </Badge>
                            </div>
                            <p className="mt-2 text-sm text-maison-secondary">
                                {activeNegotiatedTask.task_type_name} | {activeNegotiatedTask.tailor_name || 'Unassigned'} | {activeNegotiatedTask.customer_name}
                            </p>
                        </div>

                        {activeNegotiatedTask.price_review_reason && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                <span className="font-medium">Production note: </span>
                                {activeNegotiatedTask.price_review_reason}
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Current Payable</p>
                                <p className="mt-2 text-lg font-medium text-maison-primary">{formatMoney(activeNegotiatedTask.pay_amount)}</p>
                            </div>
                            <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Rate Card Snapshot</p>
                                <p className="mt-2 text-lg font-medium text-maison-primary">{formatMoney(activeNegotiatedTask.rate_snapshot)}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">
                                    Negotiated Price
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={negotiatedForm.amount}
                                    onChange={(e) => setNegotiatedForm(prev => ({ ...prev, amount: e.target.value }))}
                                    className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                />
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">
                                    Note
                                </label>
                                <textarea
                                    rows={3}
                                    value={negotiatedForm.note}
                                    onChange={(e) => setNegotiatedForm(prev => ({ ...prev, note: e.target.value }))}
                                    placeholder="Reason for negotiated price"
                                    className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                            {activeNegotiatedTask.negotiated_pay_amount !== null && activeNegotiatedTask.negotiated_pay_amount !== undefined && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    isLoading={savingNegotiatedTaskId === activeNegotiatedTask.id}
                                    onClick={handleClearNegotiatedPrice}
                                >
                                    Use Normal Price
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={closeNegotiatedPriceDialog}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                isLoading={savingNegotiatedTaskId === activeNegotiatedTask.id}
                                onClick={handleSaveNegotiatedPrice}
                            >
                                Save Negotiated Price
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
