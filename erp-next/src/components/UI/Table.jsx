import React from 'react';
import clsx from 'clsx';

export function Badge({ children, variant = 'neutral', className, ...props }) {
    const variants = {
        neutral: 'bg-gray-100 text-gray-700',
        success: 'bg-emerald-50 text-emerald-700',
        warning: 'bg-amber-50 text-amber-700',
        danger: 'bg-red-50 text-red-700',
        brand: 'bg-maison-accent-dim/30 text-maison-accent-dim',
    };

    return (
        <span
            className={clsx("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", variants[variant], className)}
            {...props}
        >
            {children}
        </span>
    );
}

export function Table({ headers, children, className, tableClassName }) {
    return (
        <div className={clsx("overflow-x-auto rounded-lg border border-gray-200", className)}>
            <table className={clsx("min-w-full divide-y divide-gray-200", tableClassName)}>
                <thead className="bg-gray-50/50">
                    <tr>
                        {headers.map((header, idx) => {
                            const headerConfig =
                                header && typeof header === 'object' && 'label' in header
                                    ? header
                                    : { label: header };

                            return (
                                <th
                                    key={idx}
                                    scope="col"
                                    className={clsx(
                                        "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider",
                                        headerConfig.className
                                    )}
                                >
                                    {headerConfig.label}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {children}
                </tbody>
            </table>
        </div>
    );
}

export function TableRow({ children, className, onClick }) {
    return (
        <tr
            onClick={onClick}
            className={clsx(
                "hover:bg-gray-50 transition-colors",
                onClick && "cursor-pointer",
                className
            )}
        >
            {children}
        </tr>
    );
}

export function TableCell({ children, className }) {
    return (
        <td className={clsx("px-6 py-4 whitespace-nowrap text-sm text-maison-primary", className)}>
            {children}
        </td>
    );
}
