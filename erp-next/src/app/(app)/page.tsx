// @ts-nocheck
"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { endOfWeek, isWithinInterval, startOfWeek } from 'date-fns';
import { ArrowUpDown, CheckCircle2, Shirt, ShoppingBag } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge } from '@/components/UI/Table';

function toInputDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDelta(change) {
    if (change === null || change === undefined) return 'NEW';
    if (change === 0) return '0%';
    return `${change > 0 ? '+' : ''}${change}%`;
}

function getDeltaClass(change) {
    if (change === null || change === undefined) return 'text-sky-600';
    if (change > 0) return 'text-emerald-600';
    if (change < 0) return 'text-red-600';
    return 'text-gray-500';
}

function formatValueDelta(value) {
    if (value === null || value === undefined) return 'NEW';
    const formatted = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (value === 0) return `NGN 0.00`;
    return `${value > 0 ? '+' : '-'}NGN ${formatted}`;
}

export default function Dashboard() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [productSort, setProductSort] = useState({ column: 'total', direction: 'desc' });
    const [payrollSort, setPayrollSort] = useState({ column: 'weekly_total_pay', direction: 'desc' });
    const [stats, setStats] = useState({
        totalRevenue: 0,
        totalRevenueChange: 0,
        productionCount: 0,
        archivedCount: 0,
        completedCount: 0,
    });
    const [weeklyPayroll, setWeeklyPayroll] = useState([]);
    const [topProducts, setTopProducts] = useState([]);
    const [categoryBreakdown, setCategoryBreakdown] = useState([]);

    const [dateRange, setDateRange] = useState({
        start: toInputDate(startOfWeek(new Date(), { weekStartsOn: 1 })),
        end: toInputDate(endOfWeek(new Date(), { weekStartsOn: 1 })),
    });

    useEffect(() => {
        checkAccess();
    }, []);

    useEffect(() => {
        if (authorized) loadStats();
    }, [authorized, dateRange]);

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

    const loadStats = async () => {
        const startDate = new Date(dateRange.start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);
        const periodLengthMs = endDate.getTime() - startDate.getTime() + 1;
        const previousEndDate = new Date(startDate.getTime() - 1);
        const previousStartDate = new Date(previousEndDate.getTime() - periodLengthMs + 1);

        const [allItems, allTasks, payroll] = await Promise.all([
            db.getItems(),
            db.getTasks(),
            db.getWeeklyPayroll(dateRange.start, dateRange.end),
        ]);

        const items = allItems.filter(item => {
            const date = new Date(item.created_at);
            return isWithinInterval(date, { start: startDate, end: endDate });
        });

        const tasks = allTasks.filter(task => {
            const date = new Date(task.updated_at || task.created_at);
            return isWithinInterval(date, { start: startDate, end: endDate });
        });

        const previousTasks = allTasks.filter(task => {
            const date = new Date(task.updated_at || task.created_at);
            return isWithinInterval(date, { start: previousStartDate, end: previousEndDate });
        });

        const verifiedTasks = tasks.filter(task => task.status === 'Approved' || task.status === 'PAID');
        const totalRevenue = verifiedTasks.reduce((sum, task) => sum + (Number(task.pay_amount) || 0), 0);
        const previousVerifiedTasks = previousTasks.filter(task => task.status === 'Approved' || task.status === 'PAID');
        const previousTotalRevenue = previousVerifiedTasks.reduce((sum, task) => sum + (Number(task.pay_amount) || 0), 0);
        const totalRevenueChange = previousTotalRevenue === 0 ? (totalRevenue > 0 ? null : 0) : totalRevenue - previousTotalRevenue;

        const previousItems = allItems.filter(item => {
            const date = new Date(item.created_at);
            return isWithinInterval(date, { start: previousStartDate, end: previousEndDate });
        });

        const buildProductStats = (sourceItems) => {
            const productStats = {};

            sourceItems.forEach(item => {
                if (item.status === 'CANCELLED' || item.status === 'ARCHIVED') return;
                if (!productStats[item.product_type_name]) {
                    productStats[item.product_type_name] = { produced: 0, backlog: 0 };
                }
                if (item.status === 'OUT_OF_PRODUCTION') {
                    productStats[item.product_type_name].produced++;
                } else {
                    productStats[item.product_type_name].backlog++;
                }
            });

            return productStats;
        };

        const currentProductStats = buildProductStats(items);
        const previousProductStats = buildProductStats(previousItems);
        const productNames = [...new Set([
            ...Object.keys(currentProductStats),
            ...Object.keys(previousProductStats),
        ])];

        const rankedTopProducts = productNames
            .map((name) => {
                const currentCounts = currentProductStats[name] || { produced: 0, backlog: 0 };
                const previousCounts = previousProductStats[name] || { produced: 0, backlog: 0 };
                const total = currentCounts.produced + currentCounts.backlog;
                const previousTotal = previousCounts.produced + previousCounts.backlog;
                const delta = previousTotal === 0
                    ? (total > 0 ? null : 0)
                    : Math.round(((total - previousTotal) / previousTotal) * 100);

                return {
                    name,
                    produced: currentCounts.produced,
                    backlog: currentCounts.backlog,
                    total,
                    delta,
                    previousTotal,
                };
            })
            .filter(product => product.total > 0 || product.previousTotal > 0)
            .sort((a, b) => b.total - a.total || b.produced - a.produced || a.name.localeCompare(b.name));

        const preferredCategoryOrder = ['Amendment', 'Cutting', 'Sewing', 'Laundry', 'Embroidery'];
        const categoryCounts = tasks.reduce((acc, task) => {
            const categoryName = task.category_name;
            if (!categoryName) return acc;
            acc[categoryName] = (acc[categoryName] || 0) + 1;
            return acc;
        }, {});

        const orderedCategoryBreakdown = [
            ...preferredCategoryOrder
                .filter(name => Object.prototype.hasOwnProperty.call(categoryCounts, name))
                .map(name => ({ name, count: categoryCounts[name] })),
            ...Object.entries(categoryCounts)
                .filter(([name]) => !preferredCategoryOrder.includes(name))
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, count]) => ({ name, count })),
        ];

        setStats({
            totalRevenue,
            totalRevenueChange,
            productionCount: items.filter(item => item.status === 'IN_PRODUCTION').length,
            archivedCount: items.filter(item => item.status === 'ARCHIVED').length,
            completedCount: items.filter(item => item.status === 'OUT_OF_PRODUCTION').length,
        });
        setTopProducts(rankedTopProducts);
        setCategoryBreakdown(orderedCategoryBreakdown);
        setWeeklyPayroll(payroll);
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

    const sortedTopProducts = [...topProducts].sort((a, b) => {
        const { column, direction } = productSort;
        const modifier = direction === 'asc' ? 1 : -1;

        if (column === 'name') {
            return a.name.localeCompare(b.name) * modifier;
        }

        const valueA = Number(a[column] || 0);
        const valueB = Number(b[column] || 0);
        return (valueA - valueB) * modifier;
    });

    const toggleProductSort = (column) => {
        setProductSort((prev) => ({
            column,
            direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    const sortedWeeklyPayroll = [...weeklyPayroll].sort((a, b) => {
        const { column, direction } = payrollSort;
        const modifier = direction === 'asc' ? 1 : -1;

        if (column === 'tailor_name' || column === 'department') {
            const valueA = String(a[column] || '');
            const valueB = String(b[column] || '');
            return valueA.localeCompare(valueB) * modifier;
        }

        const valueA = Number(a[column] || 0);
        const valueB = Number(b[column] || 0);
        return (valueA - valueB) * modifier;
    });

    const togglePayrollSort = (column) => {
        setPayrollSort((prev) => ({
            column,
            direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    const getPayrollHeaderClass = (column, align = 'left') => {
        const base = align === 'right'
            ? 'ml-auto justify-end'
            : align === 'center'
                ? 'mx-auto justify-center'
                : 'justify-start';
        return `flex w-full items-center gap-1 text-inherit ${base}`;
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Production Analytics</h1>
                    <p className="text-sm text-gray-500">Monitor performance and pipeline metrics.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                        <label className="mb-1 text-xs text-gray-500">Start Date</label>
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>
                    <span className="mt-5 text-gray-400">-</span>
                    <div className="flex flex-col">
                        <label className="mb-1 text-xs text-gray-500">End Date</label>
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Card className="relative cursor-pointer overflow-hidden transition-shadow hover:shadow-md" onClick={() => router.push('/production')}>
                    <div className="mb-4 flex items-start justify-between">
                        <div className="rounded-md bg-gray-50 p-2 text-maison-secondary">
                            <Shirt size={20} />
                        </div>
                        <span className="text-gray-300">...</span>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Backlog</p>
                    <div className="mt-1 flex items-end gap-3">
                        <h3 className="text-3xl font-serif text-maison-primary">{stats.productionCount}</h3>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">Currently active</p>
                </Card>

                <Card className="relative cursor-pointer overflow-hidden transition-shadow hover:shadow-md" onClick={() => router.push('/production')}>
                    <div className="mb-4 flex items-start justify-between">
                        <div className="rounded-md bg-gray-50 p-2 text-maison-secondary">
                            <ShoppingBag size={20} />
                        </div>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Archived</p>
                    <div className="mt-1 flex items-end gap-3">
                        <h3 className="text-3xl font-serif text-maison-primary">{stats.archivedCount}</h3>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">No longer in backlog</p>
                </Card>

                <Card className="relative cursor-pointer overflow-hidden transition-shadow hover:shadow-md" onClick={() => router.push('/production')}>
                    <div className="mb-4 flex items-start justify-between">
                        <div className="rounded-md bg-gray-50 p-2 text-maison-secondary">
                            <CheckCircle2 size={20} />
                        </div>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Produced</p>
                    <div className="mt-1 flex items-end gap-3">
                        <h3 className="text-3xl font-serif text-maison-primary">{stats.completedCount}</h3>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">Out of production</p>
                </Card>

                <Card className="relative overflow-hidden">
                    <div className="mb-4 flex items-start justify-between">
                        <div className="rounded-md bg-gray-50 p-2 text-maison-secondary">
                            <span className="font-serif text-lg font-bold leading-none">N</span>
                        </div>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Tailor Pay</p>
                    <div className="mt-1 flex items-end gap-3">
                        <h3 className="text-3xl font-serif text-maison-primary">NGN {stats.totalRevenue.toLocaleString()}</h3>
                    </div>
                    <p className={`mt-2 text-xs ${getDeltaClass(stats.totalRevenueChange)}`}>
                        {formatValueDelta(stats.totalRevenueChange)} vs previous period
                    </p>
                </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <div className="mb-6 flex items-center justify-between">
                        <h3 className="font-serif text-lg">Top Product Types</h3>
                        <Badge variant="neutral">Current vs Previous Period</Badge>
                    </div>
                    <div className="max-h-[420px] overflow-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="border-b border-gray-100 bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 font-medium text-gray-500">
                                        <button type="button" onClick={() => toggleProductSort('name')} className={getPayrollHeaderClass('name')}>
                                            Product Type
                                            <ArrowUpDown size={14} className={productSort.column === 'name' ? 'text-maison-primary' : 'text-gray-400'} />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                                        <button type="button" onClick={() => toggleProductSort('total')} className={getPayrollHeaderClass('total', 'right')}>
                                            Total
                                            <ArrowUpDown size={14} className={productSort.column === 'total' ? 'text-maison-primary' : 'text-gray-400'} />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                                        <button type="button" onClick={() => toggleProductSort('produced')} className={getPayrollHeaderClass('produced', 'right')}>
                                            Produced
                                            <ArrowUpDown size={14} className={productSort.column === 'produced' ? 'text-maison-primary' : 'text-gray-400'} />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                                        <button type="button" onClick={() => toggleProductSort('backlog')} className={getPayrollHeaderClass('backlog', 'right')}>
                                            Backlog
                                            <ArrowUpDown size={14} className={productSort.column === 'backlog' ? 'text-maison-primary' : 'text-gray-400'} />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right font-medium text-gray-500">
                                        <button type="button" onClick={() => toggleProductSort('delta')} className={getPayrollHeaderClass('delta', 'right')}>
                                            % Change
                                            <ArrowUpDown size={14} className={productSort.column === 'delta' ? 'text-maison-primary' : 'text-gray-400'} />
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {sortedTopProducts.map((product) => (
                                    <tr key={product.name} className="hover:bg-gray-50/60">
                                        <td className="px-4 py-3 font-medium text-gray-800">{product.name}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-maison-primary">{product.total}</td>
                                        <td className="px-4 py-3 text-right text-emerald-600">{product.produced}</td>
                                        <td className="px-4 py-3 text-right text-gray-600">{product.backlog}</td>
                                        <td className={`px-4 py-3 text-right font-medium ${getDeltaClass(product.delta)}`}>
                                            {formatDelta(product.delta)}
                                        </td>
                                    </tr>
                                ))}
                                {topProducts.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="px-4 py-8 text-center text-sm italic text-gray-400">
                                            No product item records found in this date range.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-4">
                        <p className="text-xs text-gray-500">
                            % Change compares with the previous matching period.
                        </p>
                        <div className="mt-4">
                            <Button onClick={() => router.push('/monthly-breakdown')}>
                                Open Monthly Breakdown
                            </Button>
                        </div>
                    </div>
                </Card>

                <Card>
                    <h3 className="mb-4 font-serif text-lg">Pipeline Status</h3>
                    <div className="space-y-4">
                        {categoryBreakdown.map((category) => (
                            <div key={category.name} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                                <span className="text-sm text-gray-600">{category.name}</span>
                                <span className="font-medium">{category.count}</span>
                            </div>
                        ))}
                        {categoryBreakdown.length === 0 && (
                            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
                                No category activity in this date range.
                            </div>
                        )}
                    </div>
                </Card>
            </div>

            <Card>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-serif text-lg">Weekly Payroll Summary</h3>
                    <Badge variant="neutral">Approved Tasks Only</Badge>
                </div>
                <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-full whitespace-nowrap text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">
                                    <button type="button" onClick={() => togglePayrollSort('tailor_name')} className={getPayrollHeaderClass('tailor_name')}>
                                        Name
                                        <ArrowUpDown size={14} className={payrollSort.column === 'tailor_name' ? 'text-maison-primary' : 'text-gray-400'} />
                                    </button>
                                </th>
                                <th className="px-4 py-3 font-medium text-gray-500">
                                    <button type="button" onClick={() => togglePayrollSort('department')} className={getPayrollHeaderClass('department')}>
                                        Department
                                        <ArrowUpDown size={14} className={payrollSort.column === 'department' ? 'text-maison-primary' : 'text-gray-400'} />
                                    </button>
                                </th>
                                <th className="px-4 py-3 text-center font-medium text-gray-500">
                                    <button type="button" onClick={() => togglePayrollSort('task_count')} className={getPayrollHeaderClass('task_count', 'center')}>
                                        Approved Tasks
                                        <ArrowUpDown size={14} className={payrollSort.column === 'task_count' ? 'text-maison-primary' : 'text-gray-400'} />
                                    </button>
                                </th>
                                <th className="px-4 py-3 text-right font-bold text-maison-primary">
                                    <button type="button" onClick={() => togglePayrollSort('weekly_total_pay')} className={getPayrollHeaderClass('weekly_total_pay', 'right')}>
                                        Total Payout
                                        <ArrowUpDown size={14} className={payrollSort.column === 'weekly_total_pay' ? 'text-maison-primary' : 'text-gray-400'} />
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedWeeklyPayroll.map((payrollRow, index) => (
                                <tr key={`${payrollRow.tailor_id}-${index}`} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{payrollRow.tailor_name}</td>
                                    <td className="px-4 py-3 text-gray-500">{payrollRow.department}</td>
                                    <td className="px-4 py-3 text-center">{payrollRow.task_count}</td>
                                    <td className="px-4 py-3 text-right font-bold text-maison-primary">
                                        NGN {Number(payrollRow.weekly_total_pay || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                            {weeklyPayroll.length === 0 && (
                                <tr>
                                    <td colSpan="4" className="px-4 py-8 text-center text-gray-500">No payroll data available.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
