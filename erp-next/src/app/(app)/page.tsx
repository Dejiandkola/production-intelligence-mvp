// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge } from '@/components/UI/Table';
import { Shirt, Scissors, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startOfWeek, endOfWeek, parseISO, isWithinInterval } from 'date-fns';

function toInputDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export default function Dashboard() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [stats, setStats] = useState({
        activeItems: 0,
        totalRevenue: 0,
        productionCount: 0,
        completedCount: 0,
        pendingVerification: 0
    });
    const [weeklyPayroll, setWeeklyPayroll] = useState([]);
    const [topProducts, setTopProducts] = useState([]);

    // Default to current week
    const [dateRange, setDateRange] = useState({
        start: toInputDate(startOfWeek(new Date(), { weekStartsOn: 1 })),
        end: toInputDate(endOfWeek(new Date(), { weekStartsOn: 1 }))
    });

    useEffect(() => {
        checkAccess();
    }, []);

    useEffect(() => {
        if (authorized) loadStats();
    }, [dateRange, authorized]);

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
        setLoading(true);
        const startDate = new Date(dateRange.start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);

        const [allItems, allTasks, payroll] = await Promise.all([
            db.getItems(),
            db.getTasks(),
            db.getWeeklyPayroll(dateRange.start, dateRange.end)
        ]);

        const items = allItems.filter(item => {
            const date = new Date(item.created_at);
            return isWithinInterval(date, { start: startDate, end: endDate });
        });

        const tasks = allTasks.filter(task => {
            const date = new Date(task.updated_at || task.created_at);
            return isWithinInterval(date, { start: startDate, end: endDate });
        });

        // 1. Active Items (Still in production, not cancelled)
        const activeItems = items.filter(i => i.status !== 'OUT_OF_PRODUCTION' && i.status !== 'CANCELLED').length;

        // 2. Approved Pay (Revenue/Cost context) - Sum of approved tailor pay
        const verifiedTasks = tasks.filter(t => t.status === 'Approved' || t.status === 'PAID');
        const totalRevenue = verifiedTasks.reduce((sum, t) => sum + (Number(t.pay_amount) || 0), 0);

        // 3. Status Breakdown
        const productionCount = items.filter(i => i.status === 'IN_PRODUCTION').length;
        const completedCount = items.filter(i => i.status === 'OUT_OF_PRODUCTION').length;

        // 4. Pending Tasks
        const pendingVerification = tasks.filter(t => t.status === 'CREATED').length;

        // 5. Top Product Types Logic
        const productStats = {};
        items.forEach(item => {
            if (item.status === 'CANCELLED') return;
            if (!productStats[item.product_type_name]) {
                productStats[item.product_type_name] = { produced: 0, backlog: 0 };
            }
            if (item.status === 'OUT_OF_PRODUCTION') {
                productStats[item.product_type_name].produced++;
            } else {
                productStats[item.product_type_name].backlog++;
            }
        });

        const sortedTopProducts = Object.entries(productStats)
            .map(([name, counts]) => ({ name, ...counts, total: counts.produced + counts.backlog }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 5); // top 5

        setStats({
            activeItems,
            totalRevenue,
            productionCount,
            completedCount,
            pendingVerification
        });
        setTopProducts(sortedTopProducts);
        setWeeklyPayroll(payroll);
        setLoading(false);
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Production Analytics</h1>
                    <p className="text-sm text-gray-500">Monitor performance and pipeline metrics.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                        <label className="text-xs text-gray-500 mb-1">Start Date</label>
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>
                    <span className="text-gray-400 mt-5">-</span>
                    <div className="flex flex-col">
                        <label className="text-xs text-gray-500 mb-1">End Date</label>
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Active Items */}
                <Card className="relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/production')}>
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-gray-50 rounded-md text-maison-secondary">
                            <Shirt size={20} />
                        </div>
                        <span className="text-gray-300">•••</span>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Active Items</p>
                    <div className="flex items-end gap-3 mt-1">
                        <h3 className="text-3xl font-serif text-maison-primary">{stats.activeItems}</h3>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">In pipeline</p>
                </Card>

                {/* Pending Verification */}
                <Card className="relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/accounts')}>
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-gray-50 rounded-md text-maison-secondary">
                            <ShoppingBag size={20} />
                        </div>
                        {stats.pendingVerification > 0 && <span className="absolute top-6 right-6 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span></span>}
                    </div>
                    <p className="text-sm font-medium text-gray-500">Pending Pay</p>
                    <div className="flex items-end gap-3 mt-1">
                        <h3 className="text-3xl font-serif text-maison-primary">{stats.pendingVerification}</h3>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Tasks waiting approval</p>
                </Card>

                {/* Completed */}
                <Card className="relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={() => router.push('/completion')}>
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-gray-50 rounded-md text-maison-secondary">
                            <CheckCircle2 size={20} />
                        </div>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Out of Production</p>
                    <div className="flex items-end gap-3 mt-1">
                        <h3 className="text-3xl font-serif text-maison-primary">{stats.completedCount}</h3>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Items no longer in production</p>
                </Card>

                {/* Total Cost/Revenue involved */}
                <Card className="relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-2 bg-gray-50 rounded-md text-maison-secondary">
                            <span className="font-serif font-bold text-lg leading-none">₦</span>
                        </div>
                    </div>
                    <p className="text-sm font-medium text-gray-500">Tailor Pay</p>
                    <div className="flex items-end gap-3 mt-1">
                        <h3 className="text-3xl font-serif text-maison-primary">₦{stats.totalRevenue.toLocaleString()}</h3>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Approved to date</p>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Top Product Types Metric */}
                <Card className="lg:col-span-2">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-serif text-lg">Top Product Types</h3>
                        <Badge variant="neutral">Produced vs Backlog</Badge>
                    </div>
                    <div className="space-y-4">
                        {topProducts.map((prod, index) => (
                            <div key={index} className="flex items-center gap-4">
                                <div className="w-1/3 truncate text-sm font-medium text-gray-700">
                                    {prod.name}
                                </div>
                                <div className="flex-1 flex h-6 rounded-md overflow-hidden bg-gray-100">
                                    {/* Produced - Green */}
                                    {prod.produced > 0 && (
                                        <div
                                            style={{ width: `${(prod.produced / prod.total) * 100}%` }}
                                            className="bg-emerald-500 h-full flex items-center justify-center text-[10px] text-white font-bold px-1 overflow-hidden transition-all"
                                        >
                                            {prod.produced}
                                        </div>
                                    )}
                                    {/* Backlog - Gray */}
                                    {prod.backlog > 0 && (
                                        <div
                                            style={{ width: `${(prod.backlog / prod.total) * 100}%` }}
                                            className="bg-gray-300 h-full flex items-center justify-center text-[10px] text-gray-700 font-bold px-1 overflow-hidden transition-all"
                                        >
                                            {prod.backlog}
                                        </div>
                                    )}
                                </div>
                                <div className="w-16 text-right text-xs font-mono text-gray-500">
                                    Total: {prod.total}
                                </div>
                            </div>
                        ))}
                        {topProducts.length === 0 && (
                            <div className="text-center py-8 text-gray-400 text-sm italic border-2 border-dashed border-gray-100 rounded-lg">
                                No product item records found in this date range.
                            </div>
                        )}
                    </div>
                    <div className="flex gap-4 mt-6 text-xs text-gray-500 justify-end">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500"></div>Produced (Received)</div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-gray-300"></div>Backlog (Not Received)</div>
                    </div>
                </Card>

                {/* Quick Actions / Status */}
                <Card>
                    <h3 className="font-serif text-lg mb-4">Pipeline Status</h3>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                            <span className="text-sm text-gray-600">New / Cutting</span>
                            <span className="font-medium">{stats.productionCount}</span>
                        </div>
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg">
                            <span className="text-sm text-gray-600">QC Check</span>
                            <span className="font-medium">{stats.activeItems - stats.productionCount}</span>
                        </div>
                    </div>
                    <Button className="w-full mt-6" onClick={() => router.push('/production/create')}>
                        Start New Production
                    </Button>
                </Card>
            </div>
            {/* Weekly Payroll Summary (MVP) */}
            <Card>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-serif text-lg">Weekly Payroll Summary</h3>
                    <Badge variant="neutral">Approved Tasks Only</Badge>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">Name</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Department</th>
                                <th className="px-4 py-3 font-medium text-gray-500 text-center">Approved Tasks</th>
                                <th className="px-4 py-3 font-bold text-maison-primary text-right">Total Payout</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {weeklyPayroll.map((p, index) => (
                                <tr key={`${p.tailor_id}-${index}`} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{p.tailor_name}</td>
                                    <td className="px-4 py-3 text-gray-500">{p.department}</td>
                                    <td className="px-4 py-3 text-center">{p.task_count}</td>
                                    <td className="px-4 py-3 text-right font-bold text-maison-primary">
                                        ₦{Number(p.weekly_total_pay || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                            {weeklyPayroll.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="px-4 py-8 text-center text-gray-500">No payroll data available.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
