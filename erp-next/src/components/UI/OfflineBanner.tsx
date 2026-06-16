"use client";

import { useEffect, useState, useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';

function subscribeOnlineStatus(callback: () => void) {
    if (typeof window === 'undefined') return () => {};

    window.addEventListener('online', callback);
    window.addEventListener('offline', callback);

    return () => {
        window.removeEventListener('online', callback);
        window.removeEventListener('offline', callback);
    };
}

function getOnlineSnapshot() {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function getServerOnlineSnapshot() {
    return true;
}

export function OfflineBanner() {
    const isOnline = useSyncExternalStore(
        subscribeOnlineStatus,
        getOnlineSnapshot,
        getServerOnlineSnapshot
    );
    const isOffline = !isOnline;
    const [showReconnected, setShowReconnected] = useState(false);

    useEffect(() => {
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

        const handleOffline = () => {
            setShowReconnected(false);
        };

        const handleOnline = () => {
            setShowReconnected(true);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => setShowReconnected(false), 3000);
        };

        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);

        return () => {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
        };
    }, []);

    if (!isOffline && !showReconnected) return null;

    return (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium transition-all ${
            isOffline
                ? 'bg-red-600 text-white'
                : 'bg-emerald-600 text-white'
        }`}>
            {isOffline ? (
                <>
                    <WifiOff size={16} />
                    You are offline. Please check your connection.
                </>
            ) : (
                <>Back online</>
            )}
        </div>
    );
}
