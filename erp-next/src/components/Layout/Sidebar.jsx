"use client";

import React, { useEffect, useState } from 'react';
import { LayoutDashboard, ShoppingBag, Box, Users, PieChart, Shirt, CheckCircle2, X, Headset } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { db } from '@/services/db';

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },

    // Operational
    { name: 'Customer Service', href: '/customer-service', icon: Headset },
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
    const [newItemsCount, setNewItemsCount] = useState(0);

    useEffect(() => {
        let mounted = true;

        const loadNewItemsCount = async () => {
            try {
                const count = await db.getNewItemsCount();
                if (mounted) setNewItemsCount(count);
            } catch (err) {
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
