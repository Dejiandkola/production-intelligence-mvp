"use client";

import React, { createContext, useContext, useState } from 'react';

// Mock Roles
export const ROLES = {
    ADMIN: 'admin',
    PRODUCTION: 'production',
    QC: 'qc',
    ACCOUNTS: 'accounts',
    COMPLETION: 'completion',
};

// Mock Users
const MOCK_USERS = [
    { id: 'u1', name: 'Alice Prod', role: ROLES.PRODUCTION, email: 'prod@maison.com' },
    { id: 'u2', name: 'Quinn QC', role: ROLES.QC, email: 'qc@maison.com' },
    { id: 'u3', name: 'Alex Acc', role: ROLES.ACCOUNTS, email: 'accounts@maison.com' },
    { id: 'u4', name: 'Charlie Comp', role: ROLES.COMPLETION, email: 'comp@maison.com' },
    { id: 'u5', name: 'Diana Admin', role: ROLES.ADMIN, email: 'admin@maison.com' },
];

const AuthContext = createContext();

export function AuthProvider({ children }) {
    // Default to Production for MVP ease of use, or null to force login
    const [user, setUser] = useState(MOCK_USERS[0]);
    const [isLoading, setIsLoading] = useState(false);

    const login = (role) => {
        setIsLoading(true);
        // Simulate API delay
        setTimeout(() => {
            const mockUser = MOCK_USERS.find(u => u.role === role);
            setUser(mockUser);
            setIsLoading(false);
        }, 500);
    };

    const logout = () => {
        setUser(null);
    };

    const value = {
        user,
        role: user?.role,
        login,
        logout,
        isLoading,
        MOCK_USERS // Export for role switcher UI
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
