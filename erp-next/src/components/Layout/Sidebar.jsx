"use client";

import React from 'react';
import { LayoutDashboard, ShoppingBag, Box, Users, Scissors, PieChart, Shirt, CheckCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { db } from '@/services/db';
import clsx from 'clsx';

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },

    // Operational
    { name: 'Production', href: '/production', icon: Shirt },
    { name: 'QC Queue', href: '/qc', icon: CheckCircle2 },
    { name: 'Completion', href: '/completion', icon: Box }, // Reusing Inventory icon for Receiving
    { name: 'Accounts', href: '/accounts', icon: ShoppingBag }, // Reusing Orders icon/spot for Accounts

    // Admin / Master Data
    { name: 'Tailors', href: '/tailors', icon: Users },
    { name: 'Rates', href: '/rates', icon: PieChart },
];

export function Sidebar({ isOpen, onClose }) {
    const pathname = usePathname();
    const [pendingPaymentsCount, setPendingPaymentsCount] = React.useState(0);

    React.useEffect(() => {
        const fetchCount = async () => {
            try {
                const count = await db.getPendingPaymentsCount();
                setPendingPaymentsCount(count);
            } catch (err) {
                console.error(err);
            }
        };
        fetchCount();
    }, [pathname]);

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
                            <img src="/logo.png" alt="Deji and Kola" className="w-full h-full object-contain" />
                        </div>
                        <div>
                            <h1 className="font-serif text-lg font-medium leading-none">Deji&Kola</h1>
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
                    {navigation.map((item) => {
                        const isActive = pathname === item.href;
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
                                {item.name}
                                {item.name === 'Accounts' && pendingPaymentsCount > 0 && (
                                    <span className="ml-auto bg-maison-accent-dim/30 text-maison-accent py-0.5 px-2 rounded-full text-xs font-semibold flex items-center justify-center">
                                        {pendingPaymentsCount}
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
