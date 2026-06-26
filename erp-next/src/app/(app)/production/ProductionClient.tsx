// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { Modal } from '@/components/UI/Modal';
import { Search, FilterX, Clock, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { formatMoney } from '@/lib/formatters';

const PRODUCTION_ASSIGNMENT_CATEGORIES = ['Cutting', 'Airstay Cutting', 'Embroidery'];
const TICKET_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;
const STATUS_TABS = [
    { key: 'ALL', label: 'All', value: '' },
    { key: 'NEW', label: 'New', value: 'NEW' },
    { key: 'IN_PRODUCTION', label: 'In Production', value: 'IN_PRODUCTION' },
    { key: 'OUT_OF_PRODUCTION', label: 'Out of Production', value: 'OUT_OF_PRODUCTION' },
    { key: 'ARCHIVED', label: 'Archived', value: 'ARCHIVED' },
];

function refreshNewItemsBadge() {
    window.dispatchEvent(new Event('new-items-count:refresh'));
}

export default function ItemList({ canManageProduction }: { canManageProduction: boolean }) {
    const [items, setItems] = useState([]);
    const [rateCards, setRateCards] = useState([]);
    const [tailors, setTailors] = useState([]);
    const [productTypes, setProductTypes] = useState([]);
    const [specialPayRules, setSpecialPayRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [totalTickets, setTotalTickets] = useState(0);
    const [summary, setSummary] = useState({ totalBacklog: 0, totalCompleted: 0 });
    const [updatingStatusIds, setUpdatingStatusIds] = useState({});
    const [activeTab, setActiveTab] = useState('ALL');
    const loadMoreRef = useRef(null);
    const activeRequestIdRef = useRef(0);
    const isResettingRef = useRef(false);
    const [filters, setFilters] = useState({
        ticketId: '',
        customerName: '',
        productType: '',
        startDate: '',
        endDate: ''
    });
    const [debouncedSearch, setDebouncedSearch] = useState({
        ticketId: '',
        customerName: ''
    });
    const isSearchDebouncing =
        filters.ticketId !== debouncedSearch.ticketId ||
        filters.customerName !== debouncedSearch.customerName;
    const [expandedGroups, setExpandedGroups] = useState({});
    const [activeAssignmentDialog, setActiveAssignmentDialog] = useState({ itemId: '', mode: '', categoryName: '' });
    const [assignmentForm, setAssignmentForm] = useState({
        itemId: '',
        assignmentId: '',
        category_type_id: '',
        task_type_id: '',
        tailor_id: '',
    });
    const [assignmentCategorySearch, setAssignmentCategorySearch] = useState('');
    const [assignmentSearch, setAssignmentSearch] = useState('');

    useEffect(() => {
        loadPageData();
    }, []);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            const nextSearch = {
                ticketId: filters.ticketId,
                customerName: filters.customerName
            };

            setDebouncedSearch(prev => {
                return prev.ticketId === nextSearch.ticketId && prev.customerName === nextSearch.customerName
                    ? prev
                    : nextSearch;
            });
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(debounceTimer);
    }, [filters.ticketId, filters.customerName]);

    useEffect(() => {
        loadItems({ reset: true });
    }, [activeTab, filters.productType, filters.startDate, filters.endDate, debouncedSearch]);

    useEffect(() => {
        const marker = loadMoreRef.current;
        if (!marker) return;

        const observer = new IntersectionObserver((entries) => {
            if (
                entries[0]?.isIntersecting &&
                !loading &&
                !loadingMore &&
                !isResettingRef.current &&
                !isSearchDebouncing &&
                items.length > 0 &&
                page * TICKET_PAGE_SIZE < totalTickets
            ) {
                loadItems({ reset: false });
            }
        }, { rootMargin: '300px' });

        observer.observe(marker);
        return () => observer.disconnect();
    }, [loading, loadingMore, isSearchDebouncing, items.length, page, totalTickets, activeTab, filters.productType, filters.startDate, filters.endDate, debouncedSearch]);

    const loadPageData = async () => {
        const [summaryData, ratesData, tailorsData, productTypesData, specialPayData] = await Promise.all([
            db.getProductionItemSummary(),
            db.getRates(),
            db.getTailors(),
            db.getProductTypes(),
            db.getTailorSpecialPay()
        ]);
        setSummary(summaryData);
        setRateCards(ratesData);
        setTailors(tailorsData);
        setProductTypes(productTypesData);
        setSpecialPayRules(specialPayData || []);
    };

    const getTabStatus = () => {
        const tab = STATUS_TABS.find(entry => entry.key === activeTab);
        return tab?.value || '';
    };

    const loadItems = async ({ reset = true } = {}) => {
        if (!reset && (loading || loadingMore || isResettingRef.current || isSearchDebouncing || items.length === 0 || page * TICKET_PAGE_SIZE >= totalTickets)) return;

        const requestId = activeRequestIdRef.current + 1;
        activeRequestIdRef.current = requestId;
        const nextPage = reset ? 1 : page + 1;
        if (reset) {
            isResettingRef.current = true;
            setLoading(true);
            setLoadingMore(false);
            setItems([]);
            setTotalTickets(0);
            setPage(1);
        } else {
            setLoadingMore(true);
        }

        try {
            const currentFilters = {
                ...filters,
                ticketId: debouncedSearch.ticketId,
                customerName: debouncedSearch.customerName,
                status: getTabStatus()
            };
            const [result, summaryData] = await Promise.all([
                db.getTicketPaginatedItems(currentFilters, nextPage, TICKET_PAGE_SIZE, { excludeCancelled: false, excludeArchived: false }),
                reset ? db.getProductionItemSummary() : Promise.resolve(summary)
            ]);
            if (requestId !== activeRequestIdRef.current) return;

            setItems(prev => reset ? result.items : [...prev, ...result.items]);
            setTotalTickets(result.totalTickets);
            if (reset) setSummary(summaryData);
            setPage(nextPage);
        } finally {
            if (requestId === activeRequestIdRef.current) {
                setLoading(false);
                setLoadingMore(false);
                if (reset) isResettingRef.current = false;
            }
        }
    };

    const refreshProductionSummary = async () => {
        try {
            const summaryData = await db.getProductionItemSummary();
            setSummary(summaryData);
        } catch (err) {
            console.error('Failed to refresh production summary:', err);
        }
    };

    const getStatusVariant = (status) => {
        switch (status) {
            case 'NEW': return 'warning';
            case 'IN_PRODUCTION': return 'brand';
            case 'ARCHIVED': return 'warning';
            case 'OUT_OF_PRODUCTION': return 'success';
            case 'CANCELLED': return 'danger';
            default: return 'neutral';
        }
    };

    const getStatusLabel = (status) => {
        if (status === 'NEW') return 'New';
        if (status === 'IN_PRODUCTION') return 'In Production';
        if (status === 'ARCHIVED') return 'Archived';
        if (status === 'OUT_OF_PRODUCTION') return 'Out of Production';
        return status;
    };

    const getStatusSelectClass = (status) => {
        switch (status) {
            case 'NEW':
                return 'border-amber-200 bg-amber-50 text-amber-800';
            case 'IN_PRODUCTION':
                return 'border-sky-200 bg-sky-50 text-sky-800';
            case 'ARCHIVED':
                return 'border-amber-200 bg-amber-50 text-amber-800';
            case 'OUT_OF_PRODUCTION':
                return 'border-emerald-200 bg-emerald-50 text-emerald-800';
            default:
                return 'border-gray-200 bg-white text-gray-700';
        }
    };

    const getProductionStatusOptions = (status) => {
        if (status === 'NEW') return ['NEW'];
        if (status === 'IN_PRODUCTION') return ['IN_PRODUCTION', 'OUT_OF_PRODUCTION', 'NEW', 'ARCHIVED'];
        if (status === 'OUT_OF_PRODUCTION') return ['OUT_OF_PRODUCTION', 'IN_PRODUCTION', 'ARCHIVED'];
        if (status === 'ARCHIVED') return ['ARCHIVED', 'IN_PRODUCTION', 'OUT_OF_PRODUCTION'];
        return [status];
    };

    const getCategoryBadgeClass = (categoryName) => {
        const normalized = (categoryName || '').trim().toLowerCase();

        if (normalized === 'sewing') return 'bg-sky-50 text-sky-700';
        if (normalized === 'amendment') return 'bg-rose-50 text-rose-700';
        if (normalized === 'laundry') return 'bg-emerald-50 text-emerald-700';

        const palette = [
            'bg-amber-50 text-amber-700',
            'bg-sky-50 text-sky-700',
            'bg-emerald-50 text-emerald-700',
            'bg-rose-50 text-rose-700',
            'bg-violet-50 text-violet-700',
            'bg-orange-50 text-orange-700',
        ];

        const value = (categoryName || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return palette[value % palette.length];
    };

    const getCategoryId = (item, categoryName) => {
        const matchingRate = rateCards.find(rate =>
            rate.product_type_id === item.product_type_id &&
            rate.category_name?.toLowerCase() === categoryName.toLowerCase()
        );

        return matchingRate?.category_type_id || '';
    };

    const getCategoryAssignment = (item, categoryName) => {
        return item.work_assignments?.find(assignment =>
            assignment.category_types?.name?.toLowerCase() === categoryName.toLowerCase()
        ) || null;
    };

    const getCategoryTaskOptions = (item, categoryName) => {
        const categoryId = getCategoryId(item, categoryName);

        return rateCards
            .filter(rate =>
                rate.product_type_id === item.product_type_id &&
                rate.category_type_id === categoryId
            )
            .map(rate => ({
                id: rate.task_type_id,
                name: rate.name
            }))
            .filter((option, index, all) => all.findIndex(task => task.id === option.id) === index);
    };

    const getAvailableProductionCategories = (item) => {
        return PRODUCTION_ASSIGNMENT_CATEGORIES
            .map((categoryName) => ({
                name: categoryName,
                categoryId: getCategoryId(item, categoryName),
                taskOptions: getCategoryTaskOptions(item, categoryName),
                assignment: getCategoryAssignment(item, categoryName)
            }))
            .filter(category => Boolean(category.categoryId) && category.taskOptions.length > 0);
    };

    const activeTailors = tailors.filter(tailor => tailor.active);
    const activeAssignmentItem = items.find(item => item.id === activeAssignmentDialog.itemId) || null;
    const activeAssignmentCategoryName = activeAssignmentDialog.categoryName || '';
    const activeAssignmentCategories = activeAssignmentItem ? getAvailableProductionCategories(activeAssignmentItem) : [];
    const selectableAssignmentCategories = activeAssignmentCategories.filter(category =>
        activeAssignmentDialog.mode === 'create' ? !category.assignment : Boolean(category.assignment)
    );
    const filteredAssignmentCategories = selectableAssignmentCategories.filter(category =>
        category.name.toLowerCase().includes(assignmentCategorySearch.trim().toLowerCase())
    );
    const activeAssignmentTaskOptions = activeAssignmentItem && activeAssignmentCategoryName
        ? getCategoryTaskOptions(activeAssignmentItem, activeAssignmentCategoryName)
        : [];
    const filteredAssignmentTailors = activeTailors.filter(tailor =>
        tailor.name?.toLowerCase().includes(assignmentSearch.trim().toLowerCase())
    );
    const isArchivedAssignmentItem = activeAssignmentItem?.status === 'ARCHIVED';
    const selectedAssignmentTailor = tailors.find(tailor => tailor.id === assignmentForm.tailor_id);
    const assignmentTailorBand = selectedAssignmentTailor?.band || 'A';
    const selectedAssignmentRate = rateCards.find(rate =>
        rate.product_type_id === activeAssignmentItem?.product_type_id &&
        rate.category_type_id === assignmentForm.category_type_id &&
        rate.task_type_id === assignmentForm.task_type_id
    );
    const selectedAssignmentSpecialPay = specialPayRules.find(rule =>
        rule.tailor_id === assignmentForm.tailor_id &&
        rule.task_type_id === assignmentForm.task_type_id &&
        rule.special_fee !== null &&
        rule.special_fee !== undefined
    );
    const baseAssignmentPay = selectedAssignmentRate
        ? Number(assignmentTailorBand === 'B' ? selectedAssignmentRate.band_b_fee || 0 : selectedAssignmentRate.band_a_fee || 0)
        : 0;
    const finalAssignmentPay = selectedAssignmentSpecialPay
        ? Number(selectedAssignmentSpecialPay.special_fee || 0)
        : baseAssignmentPay;
    const assignmentPay = formatMoney(finalAssignmentPay);
    const openAssignmentForm = (item, categoryName = '', mode = 'create') => {
        const categoryAssignment = getCategoryAssignment(item, categoryName);
        const categoryId = getCategoryId(item, categoryName) || categoryAssignment?.category_type_id || '';

        setActiveAssignmentDialog({ itemId: item.id, mode, categoryName });
        setAssignmentForm({
            itemId: item.id,
            assignmentId: mode === 'edit' ? (categoryAssignment?.id || '') : '',
            category_type_id: categoryId,
            task_type_id: mode === 'edit' ? (categoryAssignment?.task_type_id || '') : '',
            tailor_id: mode === 'edit' ? (categoryAssignment?.tailor_id || '') : '',
        });
        setAssignmentCategorySearch(categoryName);
        setAssignmentSearch(mode === 'edit' ? (categoryAssignment?.tailors?.name || '') : '');
    };

    const openDeleteAssignmentDialog = (item, categoryName = '') => {
        const categoryAssignment = getCategoryAssignment(item, categoryName);

        setActiveAssignmentDialog({ itemId: item.id, mode: 'delete', categoryName });
        setAssignmentForm({
            itemId: item.id,
            assignmentId: categoryAssignment?.id || '',
            category_type_id: categoryAssignment?.category_type_id || getCategoryId(item, categoryName) || '',
            task_type_id: categoryAssignment?.task_type_id || '',
            tailor_id: categoryAssignment?.tailor_id || '',
        });
        setAssignmentCategorySearch(categoryName);
    };

    const closeAssignmentDialog = () => {
        setActiveAssignmentDialog({ itemId: '', mode: '', categoryName: '' });
        setAssignmentForm({
            itemId: '',
            assignmentId: '',
            category_type_id: '',
            task_type_id: '',
            tailor_id: '',
        });
        setAssignmentCategorySearch('');
        setAssignmentSearch('');
    };

    const handleCreateAssignment = async (item) => {
        if (!canManageProduction) return;
        if (item?.status === 'ARCHIVED') {
            alert("Archived items cannot be assigned tasks.");
            return;
        }

        if (!assignmentForm.category_type_id || !assignmentForm.task_type_id || !assignmentForm.tailor_id) {
            alert('Please select category, assignee, and task type.');
            return;
        }

        await db.createWorkAssignment({
            item_id: item.id,
            category_type_id: assignmentForm.category_type_id,
            task_type_id: assignmentForm.task_type_id,
            tailor_id: assignmentForm.tailor_id
        });

        closeAssignmentDialog();
        refreshNewItemsBadge();
        await loadItems();
    };

    const handleUpdateAssignment = async () => {
        if (!canManageProduction) return;
        if (activeAssignmentItem?.status === 'ARCHIVED') {
            alert("Archived items cannot be edited in Production.");
            return;
        }

        if (!assignmentForm.assignmentId || !assignmentForm.category_type_id || !assignmentForm.task_type_id || !assignmentForm.tailor_id) {
            alert('Please select category, assignee, and task type.');
            return;
        }

        await db.updateWorkAssignment(assignmentForm.assignmentId, {
            category_type_id: assignmentForm.category_type_id,
            task_type_id: assignmentForm.task_type_id,
            tailor_id: assignmentForm.tailor_id
        });

        closeAssignmentDialog();
        await loadItems();
    };

    const handleDeleteAssignment = async (assignmentId) => {
        if (!canManageProduction) return;
        if (activeAssignmentItem?.status === 'ARCHIVED') {
            alert("Archived items cannot be edited in Production.");
            return;
        }
        await db.deleteWorkAssignment(assignmentId);
        closeAssignmentDialog();
        await loadItems();
    };

    const handleSelectAssignmentCategory = (item, categoryName) => {
        const categoryAssignment = getCategoryAssignment(item, categoryName);
        const categoryId = getCategoryId(item, categoryName) || categoryAssignment?.category_type_id || '';

        setActiveAssignmentDialog(prev => ({ ...prev, categoryName }));
        setAssignmentCategorySearch(categoryName);
        setAssignmentForm(prev => ({
            ...prev,
            assignmentId: activeAssignmentDialog.mode !== 'create' ? (categoryAssignment?.id || '') : '',
            category_type_id: categoryId,
            task_type_id: activeAssignmentDialog.mode !== 'create' ? (categoryAssignment?.task_type_id || '') : '',
            tailor_id: activeAssignmentDialog.mode !== 'create' ? (categoryAssignment?.tailor_id || '') : '',
        }));
        setAssignmentSearch(activeAssignmentDialog.mode !== 'create' ? (categoryAssignment?.tailors?.name || '') : '');
    };

    const handleStatusChange = async (item, newStatus) => {
        if (!canManageProduction) return;
        if (!item || item.status === newStatus || updatingStatusIds[item.id]) return;
        if (item.status === 'NEW') return;

        const allowedStatuses = getProductionStatusOptions(item.status);
        if (!allowedStatuses.includes(newStatus)) {
            alert('That status change is not allowed from the current item state.');
            return;
        }

        const returningToNew = item.status === 'IN_PRODUCTION' && newStatus === 'NEW';
        if (returningToNew) {
            const confirmed = window.confirm('Returning this item to New will delete any assigned production tasks that have not progressed through QC. Continue?');
            if (!confirmed) return;
        }

        const previousStatus = item.status;
        setUpdatingStatusIds(prev => ({ ...prev, [item.id]: true }));
        setItems(prev => prev.map(current =>
            current.id === item.id
                ? { ...current, status: newStatus, raw_status: newStatus }
                : current
        ));

        try {
            if (returningToNew) {
                await db.returnItemToNew(item.id);
            } else {
                await db.updateItemStatus(item.id, newStatus);
            }
            refreshProductionSummary();
            refreshNewItemsBadge();
            await loadItems({ reset: true });
        } catch (err) {
            setItems(prev => prev.map(current =>
                current.id === item.id
                    ? { ...current, status: previousStatus, raw_status: previousStatus }
                    : current
            ));
            alert(err.message || 'Failed to update item status.');
        } finally {
            setUpdatingStatusIds(prev => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
        }
    };

    const totalBacklog = summary.totalBacklog;
    const totalCompleted = summary.totalCompleted;

    const uniqueProductTypes = productTypes.map(productType => productType.name).filter(Boolean);
    const filteredItems = items;

    const groupedItems = filteredItems.reduce((acc, item) => {
        const tId = item.ticket_number || 'Unassigned';
        if (!acc[tId]) {
            acc[tId] = {
                ticket_id: tId,
                realTicketId: item.ticket_id,
                customer_name: item.customer_name || 'Unknown Client',
                items: []
            };
        }
        acc[tId].items.push(item);
        return acc;
    }, {});

    const toggleGroup = (ticketId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [ticketId]: !prev[ticketId]
        }));
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Production Items</h1>
                    <p className="text-sm text-maison-secondary">Track all physical items in the pipeline</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {STATUS_TABS.map(tab => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === tab.key
                            ? 'bg-maison-primary text-white shadow-sm'
                            : 'bg-white text-maison-secondary border border-gray-200 hover:bg-gray-50'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="flex items-center gap-4">
                    <div className="p-3 bg-brand-50 text-maison-primary rounded-lg border border-brand-100">
                        <Clock size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Total Backlog</p>
                        <h3 className="text-2xl font-serif text-maison-primary">{totalBacklog}</h3>
                    </div>
                </Card>
                <Card className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-500">Total Out of Production</p>
                        <h3 className="text-2xl font-serif text-maison-primary">{totalCompleted}</h3>
                    </div>
                </Card>
            </div>

            <Card className="pb-4">
                <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Ticket ID</label>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="..."
                                value={filters.ticketId}
                                onChange={(e) => setFilters(prev => ({ ...prev, ticketId: e.target.value }))}
                                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                        </div>
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Customer</label>
                        <input
                            type="text"
                            placeholder="Search name..."
                            value={filters.customerName}
                            onChange={(e) => setFilters(prev => ({ ...prev, customerName: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                        />
                    </div>
                    <div className="w-full sm:w-auto min-w-[140px]">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Product Type</label>
                        <select
                            value={filters.productType}
                            onChange={(e) => setFilters(prev => ({ ...prev, productType: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                        >
                            <option value="">All Products</option>
                            {uniqueProductTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                        </select>
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Date Range</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                                className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                            />
                            <span className="text-gray-400">-</span>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                                className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20 bg-white"
                            />
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setFilters({ ticketId: '', customerName: '', productType: '', startDate: '', endDate: '' });
                            setDebouncedSearch({ ticketId: '', customerName: '' });
                        }}
                        className="text-gray-500 hover:text-gray-700 bg-gray-50 px-3"
                        title="Clear Filters"
                    >
                        <FilterX size={16} />
                    </Button>
                </div>
            </Card>

            <div className="space-y-4">
                {Object.values(groupedItems).map((group) => {
                    const isExpanded = expandedGroups[group.ticket_id];
                    return (
                        <Card key={group.ticket_id} padding="p-0" className="overflow-hidden border border-gray-200">
                            {/* Accordion Header */}
                            <div
                                className={`flex items-center justify-between p-3 transition-colors ${isExpanded ? 'bg-gray-50 border-b border-gray-200' : 'hover:bg-gray-50'}`}
                            >
                                <div className="flex items-center gap-3 w-full">
                                    <div
                                        className="text-maison-primary min-w-5 cursor-pointer"
                                        onClick={() => toggleGroup(group.ticket_id)}
                                    >
                                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                    </div>
                                    <div
                                        className="flex-1 flex items-center justify-between cursor-pointer"
                                        onClick={() => toggleGroup(group.ticket_id)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <h3 className="font-serif font-medium text-lg text-maison-primary">
                                                {group.customer_name}
                                            </h3>
                                            <span className="text-gray-300">|</span>
                                            <span className="font-mono text-sm font-medium text-gray-500">
                                                {group.ticket_id}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm text-maison-secondary">
                                                {group.items.length} {group.items.length === 1 ? 'Product' : 'Products'} Total
                                            </span>
                                            <Badge variant={group.items.filter(i => i.status === 'OUT_OF_PRODUCTION').length === group.items.length ? 'success' : 'neutral'}>
                                                {group.items.filter(i => i.status === 'OUT_OF_PRODUCTION').length} / {group.items.length} Out of Production
                                            </Badge>
                                        </div>
                                    </div>

                                </div>
                            </div>

                            {/* Accordion Body */}
                            {isExpanded && (
                                <div className="bg-white">
                                    <Table headers={['Item Key', 'Product', 'Categories', 'Status', 'Date', 'Actions']}>
                                        {group.items.map((item) => {
                                            const assignedCategories = item.work_assignments?.map(wa => wa.category_types?.name).filter(Boolean) || [];
                                            const uniqueCategories = [...new Set(assignedCategories)];
                                            const productionAssignmentCategories = getAvailableProductionCategories(item);
                                            const hasAssignableProductionCategory = productionAssignmentCategories.some(category => !category.assignment);
                                            const hasEditableProductionAssignment = productionAssignmentCategories.some(category => category.assignment);
                                            const canManageItemAssignments = canManageProduction && ['NEW', 'IN_PRODUCTION'].includes(item.status);
                                            const isStatusUpdating = Boolean(updatingStatusIds[item.id]);

                                            return (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium font-mono text-xs">{item.item_key}</TableCell>
                                                <TableCell>{item.product_type_name}</TableCell>
                                                <TableCell className="whitespace-normal">
                                                    {uniqueCategories.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {uniqueCategories.map(category => (
                                                                <Badge
                                                                    key={category}
                                                                    variant="neutral"
                                                                    className={getCategoryBadgeClass(category)}
                                                                >
                                                                    {category}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {canManageProduction && item.status !== 'NEW' ? (
                                                        <div className="relative min-w-[210px]">
                                                            <select
                                                                value={item.status}
                                                                onChange={(e) => handleStatusChange(item, e.target.value)}
                                                                disabled={isStatusUpdating}
                                                                className={`w-full appearance-none rounded-xl border px-4 py-2.5 pr-10 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-maison-primary/20 disabled:cursor-wait disabled:opacity-70 ${getStatusSelectClass(item.status)}`}
                                                            >
                                                                {getProductionStatusOptions(item.status).map(status => (
                                                                    <option key={status} value={status}>
                                                                        {getStatusLabel(status)}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <ChevronDown
                                                                size={16}
                                                                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-current opacity-70"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <Badge variant={getStatusVariant(item.status)}>
                                                            {getStatusLabel(item.status)}
                                                        </Badge>
                                                    )}
                                                    {item.needs_qc_attention && (
                                                        <Badge variant="warning" className="ml-2">Needs QC</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-500 text-sm">
                                                    {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {canManageProduction && hasAssignableProductionCategory && (
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                disabled={!canManageItemAssignments}
                                                                onClick={() => openAssignmentForm(item, '', 'create')}
                                                            >
                                                                Assign Task
                                                            </Button>
                                                        )}
                                                        {canManageProduction && hasEditableProductionAssignment && (
                                                            <>
                                                                <Button
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    disabled={!canManageItemAssignments}
                                                                    onClick={() => openAssignmentForm(item, '', 'edit')}
                                                                >
                                                                    Edit Task
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="danger"
                                                                    disabled={!canManageItemAssignments}
                                                                    onClick={() => openDeleteAssignmentDialog(item, '')}
                                                                >
                                                                    Delete Task
                                                                </Button>
                                                            </>
                                                        )}

                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )})}
                                    </Table>
                                </div>
                            )}
                        </Card>
                    );
                })}

                {filteredItems.length === 0 && !loading && (
                    <Card>
                        <div className="py-12 text-center text-gray-500 text-sm">
                            No items found matching the selected filters.
                        </div>
                    </Card>
                )}

                <div ref={loadMoreRef} className="py-4 text-center text-sm text-gray-500">
                    {loadingMore
                        ? 'Loading more tickets...'
                        : page * TICKET_PAGE_SIZE < totalTickets
                            ? 'Scroll to load more tickets'
                            : filteredItems.length > 0
                                ? 'All matching tickets loaded'
                                : ''}
                </div>
            </div>
            <Modal
                isOpen={Boolean(activeAssignmentDialog.itemId)}
                onClose={closeAssignmentDialog}
                title={
                    activeAssignmentDialog.mode === 'create'
                        ? 'Assign Task'
                        : activeAssignmentDialog.mode === 'edit'
                            ? 'Edit Task'
                            : 'Delete Task'
                }
                maxWidth="max-w-4xl"
            >
                {activeAssignmentItem && (
                    <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                        <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-maison-primary">{activeAssignmentItem.item_key}</span>
                            <Badge variant="neutral">{activeAssignmentItem.product_type_name}</Badge>
                            {isArchivedAssignmentItem && <Badge variant="warning">Archived</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-maison-secondary">
                            Ticket: {activeAssignmentItem.ticket_number} | Customer: {activeAssignmentItem.customer_name}
                        </p>
                    </div>
                )}

                {isArchivedAssignmentItem && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        This item is archived. Production can review assignment history, but task assignment and edits are disabled.
                    </div>
                )}

                {activeAssignmentDialog.mode === 'delete' ? (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={assignmentCategorySearch}
                                onChange={(e) => {
                                    setAssignmentCategorySearch(e.target.value);
                                    setActiveAssignmentDialog(prev => ({ ...prev, categoryName: '' }));
                                    setAssignmentForm(prev => ({
                                        ...prev,
                                        assignmentId: '',
                                        category_type_id: '',
                                        task_type_id: '',
                                        tailor_id: ''
                                    }));
                                    setAssignmentSearch('');
                                }}
                                placeholder="Type category name..."
                                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            />
                            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                {filteredAssignmentCategories.length > 0 ? filteredAssignmentCategories.map(category => (
                                    <button
                                        key={category.name}
                                        type="button"
                                        onClick={() => handleSelectAssignmentCategory(activeAssignmentItem, category.name)}
                                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                    >
                                        <span>{category.name}</span>
                                    </button>
                                )) : (
                                    <div className="px-3 py-2 text-sm text-gray-500">No matching assigned categories found.</div>
                                )}
                            </div>
                        </div>
                        <p className="text-sm text-gray-600">
                            {activeAssignmentCategoryName
                                ? `Remove this ${activeAssignmentCategoryName.toLowerCase()} assignment from the item?`
                                : 'Select a category to remove its assignment from the item.'}
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={closeAssignmentDialog}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                disabled={!assignmentForm.assignmentId || isArchivedAssignmentItem}
                                onClick={() => handleDeleteAssignment(assignmentForm.assignmentId)}
                            >
                                Delete Task
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Category</label>
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={assignmentCategorySearch}
                                        onChange={(e) => {
                                            setAssignmentCategorySearch(e.target.value);
                                            setActiveAssignmentDialog(prev => ({ ...prev, categoryName: '' }));
                                            setAssignmentForm(prev => ({
                                                ...prev,
                                                assignmentId: '',
                                                category_type_id: '',
                                                task_type_id: '',
                                                tailor_id: ''
                                            }));
                                            setAssignmentSearch('');
                                        }}
                                        placeholder="Type category name..."
                                        disabled={isArchivedAssignmentItem}
                                        className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                    />
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                        {filteredAssignmentCategories.length > 0 ? filteredAssignmentCategories.map(category => (
                                            <button
                                                key={category.name}
                                                type="button"
                                                onClick={() => handleSelectAssignmentCategory(activeAssignmentItem, category.name)}
                                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                            >
                                                <span>{category.name}</span>
                                                {category.assignment && <span className="text-xs text-gray-500">Assigned</span>}
                                            </button>
                                        )) : (
                                            <div className="px-3 py-2 text-sm text-gray-500">
                                                {activeAssignmentDialog.mode === 'create'
                                                    ? 'No categories available to assign.'
                                                    : 'No matching assigned categories found.'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Assignee</label>
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={assignmentSearch}
                                        onChange={(e) => {
                                            setAssignmentSearch(e.target.value);
                                            setAssignmentForm(prev => ({ ...prev, tailor_id: '' }));
                                        }}
                                        placeholder={activeAssignmentCategoryName ? `Type ${activeAssignmentCategoryName.toLowerCase()} assignee name...` : 'Select category first...'}
                                        disabled={!activeAssignmentCategoryName || isArchivedAssignmentItem}
                                        className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                    />
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                        {!activeAssignmentCategoryName ? (
                                            <div className="px-3 py-2 text-sm text-gray-500">Select a category first.</div>
                                        ) : filteredAssignmentTailors.length > 0 ? filteredAssignmentTailors.map(tailor => (
                                            <button
                                                key={tailor.id}
                                                type="button"
                                                onClick={() => {
                                                    setAssignmentForm(prev => ({ ...prev, tailor_id: tailor.id }));
                                                    setAssignmentSearch(tailor.name);
                                                }}
                                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                            >
                                                <span>{tailor.name}</span>
                                                <span className="text-xs text-gray-500">Band {tailor.band || 'A'}</span>
                                            </button>
                                        )) : (
                                            <div className="px-3 py-2 text-sm text-gray-500">No matching assignees found.</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Task Type</label>
                                <select
                                    value={assignmentForm.task_type_id}
                                    onChange={(e) => setAssignmentForm(prev => ({ ...prev, task_type_id: e.target.value }))}
                                    disabled={!activeAssignmentCategoryName || isArchivedAssignmentItem}
                                    className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                >
                                    <option value="">{activeAssignmentCategoryName ? `Select ${activeAssignmentCategoryName} Task...` : 'Select Category First'}</option>
                                    {activeAssignmentTaskOptions.map(task => (
                                        <option key={task.id} value={task.id}>
                                            {task.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                            <div className="mb-1 flex justify-between text-sm">
                                <span className="text-gray-500">Category:</span>
                                <span className="font-medium">{activeAssignmentCategoryName || '-'}</span>
                            </div>
                            <div className="mb-1 flex justify-between text-sm">
                                <span className="text-gray-500">Pay Band:</span>
                                <span className="font-medium">Band {assignmentTailorBand}</span>
                            </div>
                            <div className="mb-1 flex justify-between text-sm">
                                <span className="text-gray-500">Base Rate:</span>
                                <span className="font-medium">{formatMoney(baseAssignmentPay)}</span>
                            </div>
                            {selectedAssignmentSpecialPay && (
                                <div className="mb-1 flex justify-between text-sm text-emerald-700">
                                    <span>Special Fee:</span>
                                    <span className="font-medium">{formatMoney(selectedAssignmentSpecialPay.special_fee)}</span>
                                </div>
                            )}
                            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-bold text-maison-primary">
                                <span>Final Pay:</span>
                                <span>{assignmentPay}</span>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={closeAssignmentDialog}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                disabled={!activeAssignmentCategoryName || isArchivedAssignmentItem}
                                onClick={() => {
                                    const item = items.find(entry => entry.id === activeAssignmentDialog.itemId);
                                    if (!item) return;
                                    if (activeAssignmentDialog.mode === 'edit') {
                                        handleUpdateAssignment();
                                    } else {
                                        handleCreateAssignment(item);
                                    }
                                }}
                            >
                                {activeAssignmentDialog.mode === 'edit' ? 'Save' : 'Assign'}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
