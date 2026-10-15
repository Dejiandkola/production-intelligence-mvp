"use client";

import React, { useEffect, useState } from 'react';
import { LayoutDashboard, ShoppingBag, Box, Users, UserRoundCog, ClipboardList, PieChart, Shirt, CheckCircle2, X, Headset, History, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { db } from '@/services/db';
import { createClient } from '@/lib/supabase/client';

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },

    // Operational
    { name: 'Customer Service', href: '/customer-service', icon: Headset },
    { name: 'Consultants', href: '/requests', icon: ClipboardList, requestOnly: true },
    { name: 'Production', href: '/production', icon: Shirt },
    { name: 'QC Queue', href: '/qc', icon: CheckCircle2 },
    { name: 'Completion', href: '/completion', icon: Box }, // Reusing Inventory icon for Receiving
    { name: 'Accounts', href: '/accounts', icon: ShoppingBag }, // Reusing Orders icon/spot for Accounts
    { name: 'Activity Log', href: '/activity-log', icon: History },

    // Admin / Master Data
    { name: 'Tailors', href: '/tailors', icon: Users },
    { name: 'Rates', href: '/rates', icon: PieChart },
    { name: 'Settings', href: '/settings', icon: Settings },
    { name: 'Users', href: '/users', icon: UserRoundCog, adminOnly: true },
];

export function Sidebar({ isOpen, onClose, permissions = [] }) {
    const pathname = usePathname();
    const [newItemsCount, setNewItemsCount] = useState(0);
    const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
    const isAdmin = permissions.includes('admin');
    const [customerServiceExpanded, setCustomerServiceExpanded] = useState(false);
    const canReviewRequests = permissions.includes('manage_customer_service');
    const canViewRequests = canReviewRequests || permissions.includes('submit_work_requests') || isAdmin;
    const customerServiceOpen = customerServiceExpanded || pathname.startsWith('/customer-service');

    useEffect(() => {
        let mounted = true;

        const loadNewItemsCount = async () => {
            try {
                const count = await db.getNewItemsCount();
                if (mounted) setNewItemsCount(count);
            } catch {
                if (mounted) setNewItemsCount(0);
            }
        };

        loadNewItemsCount();
        window.addEventListener('new-items-count:refresh', loadNewItemsCount);

        return () => {
            mounted = false;
            window.removeEventListener('new-items-count:refresh', loadNewItemsCount);
        };
    }, [pathname]);

    useEffect(() => {
        if (!canViewRequests) return;
        let mounted = true;
        const supabase = createClient();

        const loadPendingRequestsCount = async () => {
            const [requests, corrections] = await Promise.all([
                supabase.from('work_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
                supabase.from('work_assignment_corrections').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
            ]);
            if (!mounted) return;
            if (!requests.error && !corrections.error) {
                setPendingRequestsCount((requests.count || 0) + (corrections.count || 0));
            }
        };

        void loadPendingRequestsCount();
        const interval = window.setInterval(() => { void loadPendingRequestsCount(); }, 60000);
        window.addEventListener('pending-requests-count:refresh', loadPendingRequestsCount);
        return () => {
            mounted = false;
            window.clearInterval(interval);
            window.removeEventListener('pending-requests-count:refresh', loadPendingRequestsCount);
        };
    }, [canViewRequests, pathname]);

    return (
        <>
            {/* Mobile Overlay */}
            <div
                className={clsx(
                    "fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Sidebar Container */}
            <div
                className={clsx(
                    "fixed inset-y-0 left-0 z-50 w-64 bg-maison-surface border-r border-gray-100 flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:h-screen md:sticky md:top-0",
                    isOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                {/* Brand */}
                <div className="flex items-center justify-between px-6 h-20">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center shrink-0">
                            <Image src="/logo.png" alt="Deji and Kola" width={40} height={40} className="w-full h-full object-contain" />
                        </div>
                        <div>
                            <h1 className="font-serif text-lg font-medium leading-none">Deji & Kola</h1>
                        </div>
                    </div>
                    {/* Close Button (Mobile Only) */}
                    <button
                        onClick={onClose}
                        className="md:hidden text-maison-secondary hover:text-maison-primary"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 space-y-1 mt-6 overflow-y-auto">
                    <div className="px-2 mb-2 text-xs font-medium text-maison-secondary uppercase tracking-wider">
                        Atelier
                    </div>
                    {navigation.filter(item => {
                        if (item.adminOnly) return isAdmin;
                        if (item.requestOnly) return permissions.includes('submit_work_requests') || isAdmin;
                        if (item.href === '/customer-service') return canViewRequests;
                        if (permissions.includes('submit_work_requests') && !isAdmin && !permissions.includes('manage_customer_service')) return false;
                        return true;
                    }).map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/' && item.href !== '/customer-service' && pathname.startsWith(`${item.href}/`));
                        if (item.href === '/customer-service') {
                            return <React.Fragment key={item.name}>
                                <div className={clsx('flex items-center rounded-lg text-sm font-medium transition-colors', isActive ? 'bg-maison-bg text-maison-primary' : 'text-maison-secondary hover:bg-gray-50 hover:text-maison-primary')}>
                                    {canReviewRequests ? <Link href={item.href} onClick={() => onClose && window.innerWidth < 768 && onClose()} className="flex min-w-0 flex-1 items-center px-3 py-2.5"><item.icon className="mr-3 h-5 w-5 shrink-0" aria-hidden="true" strokeWidth={1.5} /><span className="flex-1">{item.name}</span></Link> : <button type="button" aria-expanded={customerServiceOpen} onClick={() => setCustomerServiceExpanded(value => !value)} className="flex min-w-0 flex-1 items-center px-3 py-2.5 text-left"><item.icon className="mr-3 h-5 w-5 shrink-0" aria-hidden="true" strokeWidth={1.5} /><span className="flex-1">{item.name}</span></button>}
                                    {canReviewRequests && <button type="button" aria-label={customerServiceOpen ? 'Collapse Customer Service' : 'Expand Customer Service'} aria-expanded={customerServiceOpen} onClick={() => setCustomerServiceExpanded(value => !value)} className="rounded-md p-2 hover:bg-gray-100">{customerServiceOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>}
                                    {!canReviewRequests && (customerServiceOpen ? <ChevronDown className="mr-3 h-4 w-4" /> : <ChevronRight className="mr-3 h-4 w-4" />)}
                                </div>
                                {canViewRequests && customerServiceOpen && <Link href="/customer-service/requests" onClick={() => onClose && window.innerWidth < 768 && onClose()} className={clsx('ml-4 flex min-w-0 items-center rounded-lg px-2 py-2 text-sm transition-colors', pathname === '/customer-service/requests' ? 'bg-maison-bg font-medium text-maison-primary' : 'text-maison-secondary hover:bg-gray-50 hover:text-maison-primary')}><ClipboardList className="mr-2 h-4 w-4 shrink-0" strokeWidth={1.5} /><span className="min-w-0 flex-1 whitespace-nowrap">Pending Requests</span>{pendingRequestsCount > 0 && <span className="ml-2 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{pendingRequestsCount > 99 ? '99+' : pendingRequestsCount}</span>}</Link>}
                            </React.Fragment>;
                        }
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                onClick={() => onClose && window.innerWidth < 768 && onClose()} // Close on navigation on mobile
                                className={clsx(
                                    'group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors',
                                    isActive
                                        ? 'bg-maison-bg text-maison-primary'
                                        : 'text-maison-secondary hover:bg-gray-50 hover:text-maison-primary'
                                )}
                            >
                                <item.icon
                                    className={clsx(
                                        'mr-3 h-5 w-5 lex-shrink-0 transition-colors',
                                    )}
                                    aria-hidden="true"
                                    strokeWidth={1.5}
                                />
                                <span className="flex-1">{item.name}</span>
                                {item.href === '/production' && newItemsCount > 0 && (
                                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                                        {newItemsCount > 99 ? '99+' : newItemsCount}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Bottom Actions */}
                <div className="p-4 border-t border-gray-100 space-y-2">
                    <div className="flex items-center text-xs font-medium text-maison-secondary px-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>
                        System Operational
                    </div>
                </div>
            </div>
        </>
    );
}
