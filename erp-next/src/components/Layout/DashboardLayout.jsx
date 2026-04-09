"use client";

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { OfflineBanner } from '@/components/UI/OfflineBanner';

export function DashboardLayout({ children }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <div className="flex min-h-screen bg-maison-bg font-sans text-maison-primary">
            <OfflineBanner />
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <Header
                    title="Production Overview"
                    onMenuClick={() => setIsSidebarOpen(true)}
                /> {/* Title should be dynamic based on route */}
                <div className="flex-1 overflow-auto p-4 md:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
