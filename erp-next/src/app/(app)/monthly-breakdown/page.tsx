// @ts-nocheck
"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isWithinInterval } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge } from '@/components/UI/Table';

function getMonthKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getMonthLabel(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

function getMonthKeysInRange(startDate, endDate) {
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    const monthKeys = [];

    while (cursor <= endCursor) {
        monthKeys.push(getMonthKey(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return monthKeys;
}

export default function MonthlyBreakdownPage() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [monthlyProductOutput, setMonthlyProductOutput] = useState({ months: [], rows: [] });
    const [monthlyTailorPay, setMonthlyTailorPay] = useState({ months: [], rows: [] });
    const [monthlyCategoryBreakdown, setMonthlyCategoryBreakdown] = useState({ months: [], rows: [] });
    const [monthlyProductTypePayout, setMonthlyProductTypePayout] = useState({ months: [], rows: [] });
    const [showAllProducts, setShowAllProducts] = useState(false);
    const [showAllTailors, setShowAllTailors] = useState(false);
    const [showAllCategories, setShowAllCategories] = useState(false);
    const [showAllProductTypes, setShowAllProductTypes] = useState(false);

    useEffect(() => {
        checkAccess();
    }, []);

    useEffect(() => {
        if (authorized) loadBreakdown();
    }, [authorized]);

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

    const loadBreakdown = async () => {
        const [allItems, monthlyPayroll, payrollEntries] = await Promise.all([
            db.getItems(),
            db.getMonthlyPayrollSummary(),
            db.getPayrollEntries(),
        ]);

        const producedDates = allItems
            .filter(item => item.status === 'OUT_OF_PRODUCTION')
            .map(item => new Date(item.updated_at || item.created_at))
            .filter(date => !Number.isNaN(date.getTime()));

        const payoutDates = monthlyPayroll
            .map(entry => {
                const [year, month] = String(entry.month_key || '').split('-').map(Number);
                return year && month ? new Date(year, month - 1, 1) : null;
            })
            .filter(Boolean)
            .filter(date => !Number.isNaN(date.getTime()));

        const allRelevantDates = [...producedDates, ...payoutDates];
        const now = new Date();
        const startDate = allRelevantDates.length > 0
            ? new Date(Math.min(...allRelevantDates.map(date => date.getTime())))
            : new Date(now.getFullYear(), 0, 1);
        startDate.setHours(0, 0, 0, 0);
        const endDate = allRelevantDates.length > 0
            ? new Date(Math.max(...allRelevantDates.map(date => date.getTime())))
            : now;
        endDate.setHours(23, 59, 59, 999);
        const monthKeys = getMonthKeysInRange(startDate, endDate);

        const producedItems = allItems.filter(item => {
            if (item.status !== 'OUT_OF_PRODUCTION') return false;
            const producedDate = new Date(item.updated_at || item.created_at);
            return isWithinInterval(producedDate, { start: startDate, end: endDate });
        });

        const productMap = {};
        producedItems.forEach(item => {
            const productName = item.product_type_name || 'Unknown Product';
            const producedDate = new Date(item.updated_at || item.created_at);
            const monthKey = getMonthKey(producedDate);

            if (!productMap[productName]) {
                productMap[productName] = { name: productName, total: 0 };
                monthKeys.forEach(key => {
                    productMap[productName][key] = 0;
                });
            }

            productMap[productName][monthKey] += 1;
            productMap[productName].total += 1;
        });

        const productRows = Object.values(productMap)
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

        const tailorMap = {};
        monthlyPayroll.forEach(entry => {
            const tailorId = entry.tailor_id || entry.tailor_name || 'unassigned';
            const tailorName = entry.tailor_name || 'Unassigned Tailor';
            const monthKey = entry.month_key;
            const amount = Number(entry.monthly_total_pay || 0);

            if (!monthKeys.includes(monthKey)) return;

            if (!tailorMap[tailorId]) {
                tailorMap[tailorId] = { id: tailorId, name: tailorName, total: 0 };
                monthKeys.forEach(key => {
                    tailorMap[tailorId][key] = 0;
                });
            }

            tailorMap[tailorId][monthKey] += amount;
            tailorMap[tailorId].total += amount;
        });

        const tailorRows = Object.values(tailorMap)
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

        const approvedTasks = payrollEntries.filter(entry => {
            const payoutDate = new Date(entry.updated_at || entry.created_at);
            return isWithinInterval(payoutDate, { start: startDate, end: endDate });
        });

        const categoryMap = {};
        approvedTasks.forEach(task => {
            const categoryName = task.category_name || 'Uncategorized';
            const payoutDate = new Date(task.updated_at || task.created_at);
            const monthKey = getMonthKey(payoutDate);
            const amount = Number(task.pay_amount || 0);

            if (!categoryMap[categoryName]) {
                categoryMap[categoryName] = { name: categoryName, total: 0 };
                monthKeys.forEach(key => {
                    categoryMap[categoryName][key] = 0;
                });
            }

            categoryMap[categoryName][monthKey] += amount;
            categoryMap[categoryName].total += amount;
        });

        const categoryRows = Object.values(categoryMap)
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

        const productTypePayoutMap = {};
        approvedTasks.forEach(task => {
            const productTypeName = task.product_type_name || 'Unknown Product';
            const payoutDate = new Date(task.updated_at || task.created_at);
            const monthKey = getMonthKey(payoutDate);
            const amount = Number(task.pay_amount || 0);

            if (!productTypePayoutMap[productTypeName]) {
                productTypePayoutMap[productTypeName] = { name: productTypeName, total: 0 };
                monthKeys.forEach(key => {
                    productTypePayoutMap[productTypeName][key] = 0;
                });
            }

            productTypePayoutMap[productTypeName][monthKey] += amount;
            productTypePayoutMap[productTypeName].total += amount;
        });

        const productTypePayoutRows = Object.values(productTypePayoutMap)
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

        setMonthlyProductOutput({ months: monthKeys, rows: productRows });
        setMonthlyTailorPay({ months: monthKeys, rows: tailorRows });
        setMonthlyCategoryBreakdown({ months: monthKeys, rows: categoryRows });
        setMonthlyProductTypePayout({ months: monthKeys, rows: productTypePayoutRows });
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

    const visibleProductRows = showAllProducts ? monthlyProductOutput.rows : monthlyProductOutput.rows.slice(0, 5);
    const visibleTailorRows = showAllTailors ? monthlyTailorPay.rows : monthlyTailorPay.rows.slice(0, 5);
    const visibleCategoryRows = showAllCategories ? monthlyCategoryBreakdown.rows : monthlyCategoryBreakdown.rows.slice(0, 5);
    const visibleProductTypeRows = showAllProductTypes ? monthlyProductTypePayout.rows : monthlyProductTypePayout.rows.slice(0, 5);

    return (
        <div className="space-y-6">
            <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Monthly Breakdown</h1>
                    <p className="text-sm text-gray-500">Review month-over-month product output and tailor payouts. Top 5 rows are shown first.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={() => router.push('/')}>
                        <ArrowLeft size={16} className="mr-2" />
                        Back to Dashboard
                    </Button>
                </div>
            </div>

            <Card>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-serif text-lg">Monthly Product Output</h3>
                    <div className="flex items-center gap-3">
                        {monthlyProductOutput.rows.length > 5 && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setShowAllProducts(prev => !prev)}
                            >
                                {showAllProducts ? 'Show Top 5' : 'View All'}
                            </Button>
                        )}
                        <Badge variant="neutral">Produced Items by Month</Badge>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full whitespace-nowrap text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">Product Type</th>
                                {monthlyProductOutput.months.map((monthKey) => (
                                    <th key={monthKey} className="px-4 py-3 text-right font-medium text-gray-500">
                                        {getMonthLabel(monthKey)}
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleProductRows.map((row) => (
                                <tr key={row.name} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                                    {monthlyProductOutput.months.map((monthKey) => (
                                        <td key={`${row.name}-${monthKey}`} className="px-4 py-3 text-right text-gray-600">
                                            {row[monthKey] || 0}
                                        </td>
                                    ))}
                                    <td className="px-4 py-3 text-right font-semibold text-maison-primary">{row.total}</td>
                                </tr>
                            ))}
                            {monthlyProductOutput.rows.length === 0 && (
                                <tr>
                                    <td colSpan={monthlyProductOutput.months.length + 2} className="px-4 py-8 text-center text-gray-500">
                                        No produced items available for monthly comparison.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-serif text-lg">Monthly Tailor Payout</h3>
                    <div className="flex items-center gap-3">
                        {monthlyTailorPay.rows.length > 5 && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setShowAllTailors(prev => !prev)}
                            >
                                {showAllTailors ? 'Show Top 5' : 'View All'}
                            </Button>
                        )}
                        <Badge variant="neutral">Weekly Payroll Logic by Month</Badge>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full whitespace-nowrap text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">Tailor</th>
                                {monthlyTailorPay.months.map((monthKey) => (
                                    <th key={monthKey} className="px-4 py-3 text-right font-medium text-gray-500">
                                        {getMonthLabel(monthKey)}
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleTailorRows.map((row) => (
                                <tr key={row.id || row.name} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                                    {monthlyTailorPay.months.map((monthKey) => (
                                        <td key={`${row.name}-${monthKey}`} className="px-4 py-3 text-right text-gray-600">
                                            NGN {Number(row[monthKey] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                    ))}
                                    <td className="px-4 py-3 text-right font-semibold text-maison-primary">
                                        NGN {Number(row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                            {monthlyTailorPay.rows.length === 0 && (
                                <tr>
                                    <td colSpan={monthlyTailorPay.months.length + 2} className="px-4 py-8 text-center text-gray-500">
                                        No monthly tailor payouts available for this payroll logic.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-serif text-lg">Category Breakdown</h3>
                    <div className="flex items-center gap-3">
                        {monthlyCategoryBreakdown.rows.length > 5 && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setShowAllCategories(prev => !prev)}
                            >
                                {showAllCategories ? 'Show Top 5' : 'View All'}
                            </Button>
                        )}
                        <Badge variant="neutral">Monthly Payout by Category</Badge>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full whitespace-nowrap text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">Category</th>
                                {monthlyCategoryBreakdown.months.map((monthKey) => (
                                    <th key={monthKey} className="px-4 py-3 text-right font-medium text-gray-500">
                                        {getMonthLabel(monthKey)}
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleCategoryRows.map((row) => (
                                <tr key={row.name} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                                    {monthlyCategoryBreakdown.months.map((monthKey) => (
                                        <td key={`${row.name}-${monthKey}`} className="px-4 py-3 text-right text-gray-600">
                                            NGN {Number(row[monthKey] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                    ))}
                                    <td className="px-4 py-3 text-right font-semibold text-maison-primary">
                                        NGN {Number(row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                            {monthlyCategoryBreakdown.rows.length === 0 && (
                                <tr>
                                    <td colSpan={monthlyCategoryBreakdown.months.length + 2} className="px-4 py-8 text-center text-gray-500">
                                        No monthly category payout data available for this payroll logic.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-serif text-lg">Product Type Payout</h3>
                    <div className="flex items-center gap-3">
                        {monthlyProductTypePayout.rows.length > 5 && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setShowAllProductTypes(prev => !prev)}
                            >
                                {showAllProductTypes ? 'Show Top 5' : 'View All'}
                            </Button>
                        )}
                        <Badge variant="neutral">Approved Payout by Product Type</Badge>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full whitespace-nowrap text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 font-medium text-gray-500">Product Type</th>
                                {monthlyProductTypePayout.months.map((monthKey) => (
                                    <th key={monthKey} className="px-4 py-3 text-right font-medium text-gray-500">
                                        {getMonthLabel(monthKey)}
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {visibleProductTypeRows.map((row) => (
                                <tr key={row.name} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                                    {monthlyProductTypePayout.months.map((monthKey) => (
                                        <td key={`${row.name}-${monthKey}`} className="px-4 py-3 text-right text-gray-600">
                                            NGN {Number(row[monthKey] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                    ))}
                                    <td className="px-4 py-3 text-right font-semibold text-maison-primary">
                                        NGN {Number(row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                            {monthlyProductTypePayout.rows.length === 0 && (
                                <tr>
                                    <td colSpan={monthlyProductTypePayout.months.length + 2} className="px-4 py-8 text-center text-gray-500">
                                        No monthly product type payouts available for this payroll logic.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
