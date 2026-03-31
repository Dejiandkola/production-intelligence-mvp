"use client";

import React, { useEffect, useState } from 'react';
import { Menu, LogOut } from 'lucide-react';
import { db } from '@/services/db';
import { useRouter } from 'next/navigation';
import Image from "next/image";

export function Header({ title, onMenuClick }) {
    const [user, setUser] = useState({ email: '', roleName: 'Loading...' });
    const router = useRouter();

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const currentUser = await db.getCurrentUser();
                if (currentUser) setUser(currentUser);
            } catch (err) {
                console.error("Failed to fetch user:", err);
            }
        };
        fetchUser();
    }, []);

    const handleLogout = async () => {
        try {
            await db.signOut();
            router.push('/login');
            router.refresh(); // Force a refresh to clear context
        } catch (error) {
            console.error("Logout failed", error);
        }
    };

    return (
        <header className="px-4 md:px-8 h-16 md:h-20 bg-maison-surface/50 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 md:border-none">
            <div className="flex items-center gap-4">
                <button
                    className="md:hidden text-maison-secondary hover:text-maison-primary p-1"
                    onClick={onMenuClick}
                >
                    <Menu size={24} />
                </button>
                <h2 className="text-lg md:text-xl font-serif font-medium text-maison-primary truncate">{title}</h2>
            </div>

            <div className="flex items-center gap-3 md:gap-6">
                {/* Actions */}
                <div className="flex items-center gap-2 md:gap-4 md:border-l md:border-gray-200 md:pl-6">
                    {/* User Profile */}
                    <div className="flex items-center gap-3 pl-2">
                        <div className="h-8 w-8 md:h-9 md:w-9 rounded-full bg-maison-accent-dim flex items-center justify-center text-maison-accent font-serif italic text-lg border border-white shadow-sm uppercase">
                            {user.email ? user.email.charAt(0) : '?'}
                        </div>
                        <div className="text-sm hidden md:block">
                            <p className="font-medium text-maison-primary">{user.email || 'Not logged in'}</p>
                            <p className="text-xs text-gray-500">{user.roleName}</p>
                        </div>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="text-gray-400 hover:text-red-500 transition-colors ml-4 p-2 pl-3 md:border-l border-gray-200 flex items-center gap-2"
                        title="Log out"
                    >
                        <LogOut size={18} />
                        <span className="hidden md:inline text-sm font-medium">Log out</span>
                    </button>
                </div>
            </div>
        </header>
    );
}
