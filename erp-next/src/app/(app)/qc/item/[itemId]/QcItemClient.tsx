// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { ArrowLeft, Plus, CheckCircle2, Trash2, Edit2 } from 'lucide-react';

export default function ManageItemTasks({ itemId: propItemId, onClose, canManageQc, rateCard = [], tailors = [] }: { itemId?: string, onClose?: () => void, canManageQc?: boolean, rateCard?: any[], tailors?: any[] }) {
    const params = useParams();
    const itemId = propItemId || params.itemId;
    const router = useRouter();

    const [item, setItem] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    // Form State
    const [showAssignForm, setShowAssignForm] = useState(false);
    const [newTask, setNewTask] = useState({
        category_type_id: '',
        task_type_id: '',
        task_type_ids: [],
        tailor_id: '',
    });
    const [newCategorySearch, setNewCategorySearch] = useState('');
    const [newTaskTypeSearch, setNewTaskTypeSearch] = useState('');
    const [newTailorSearch, setNewTailorSearch] = useState('');

    const [editingTask, setEditingTask] = useState(null);
    const [editTaskData, setEditTaskData] = useState({
        id: '',
        category_type_id: '',
        task_type_id: '',
        tailor_id: '',
    });
    const [editCategorySearch, setEditCategorySearch] = useState('');
    const [editTaskTypeSearch, setEditTaskTypeSearch] = useState('');
    const [editTailorSearch, setEditTailorSearch] = useState('');

    useEffect(() => {
        if (itemId) {
            loadData();
        }
    }, [itemId]);

    const loadData = async () => {
        setLoading(true);
        const [i, t] = await Promise.all([
            db.getItemById(itemId),
            db.getTasksByItemId(itemId)
        ]);

        // Safety check if item not found
        if (!i) {
            alert("Item not found");
            if (onClose) onClose();
            else router.push('/qc');
            return;
        }

        setItem(i);
        setTasks(t);
        setLoading(false);
    };

    // --- Derived Dropdown Options ---

    // 1. Available Categories: Only those present in RateCard for this Product Type
    const availableCategories = rateCard
        .filter(r => r.product_type_id === item?.product_type_id)
        .map(r => ({ id: r.category_type_id, name: r.category_name }))
        .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);

    // 2. Available Task Types: Filter by Product Type AND Selected Category directly from rateCard
    const activeCategoryId = editingTask ? editTaskData.category_type_id : newTask.category_type_id;
    const activeCategory = availableCategories.find(c => c.id === activeCategoryId);
    const isAmendmentCategory = activeCategory?.name?.toLowerCase() === 'amendment';

    const usedTaskTypeIdsForSelectedCategory = tasks
        .filter(t => t.category_type_id === activeCategoryId)
        .map(t => t.task_type_id);

    const availableTaskTypes = rateCard
        .filter(r =>
            r.product_type_id === item?.product_type_id &&
            r.category_type_id === activeCategoryId &&
            (
                editingTask ||
                !usedTaskTypeIdsForSelectedCategory.includes(r.task_type_id)
            )
        )
        .map(r => ({ id: r.task_type_id, name: r.name }));

    const activeCategorySearch = editingTask ? editCategorySearch : newCategorySearch;
    const filteredCategories = availableCategories.filter(c =>
        c.name?.toLowerCase().includes(activeCategorySearch.trim().toLowerCase())
    );

    const activeTaskTypeSearch = editingTask ? editTaskTypeSearch : newTaskTypeSearch;
    const filteredTaskTypes = availableTaskTypes.filter(t =>
        t.name?.toLowerCase().includes(activeTaskTypeSearch.trim().toLowerCase())
    );

    // --- Rate Calculation for Display ---
    const selectedTaskTypeIds = editingTask
        ? [editTaskData.task_type_id].filter(Boolean)
        : (isAmendmentCategory ? newTask.task_type_ids : [newTask.task_type_id].filter(Boolean));

    const selectedRates = rateCard.filter(r =>
        r.product_type_id === item?.product_type_id &&
        r.category_type_id === (editingTask ? editTaskData.category_type_id : newTask.category_type_id) &&
        selectedTaskTypeIds.includes(r.task_type_id)
    );

    const selectedRate = selectedRates[0];

    const activeTailorId = editingTask ? editTaskData.tailor_id : newTask.tailor_id;
    const selectedTailor = tailors.find(t => t.id === activeTailorId);
    const activeTailorSearch = editingTask ? editTailorSearch : newTailorSearch;
    const selectableTailors = tailors.filter(t => t.active || t.id === activeTailorId);
    const filteredTailors = selectableTailors.filter(t =>
        t.name?.toLowerCase().includes(activeTailorSearch.trim().toLowerCase())
    );

    const tailorBand = selectedTailor ? (selectedTailor.band || 'A') : 'A';

    let calculatedPay = '0.00';
    if (selectedRates.length > 0 && selectedTailor) {
        const totalPay = selectedRates.reduce((sum, rate) => {
            return sum + (tailorBand === 'B' ? Number(rate.band_b_fee || 0) : Number(rate.band_a_fee || 0));
        }, 0);
        calculatedPay = totalPay.toFixed(2);
    }


    const handleCreateTask = async (e) => {
        e.preventDefault();

        if (!canManageQc) {
            alert("Not allowed");
            return;
        }

        if (!item?.id) {
            alert("Invalid item.");
            return;
        }

        if (selectedRates.length === 0) {
            alert("Invalid Rate Configuration");
            return;
        }

        const selectedTaskIds = isAmendmentCategory ? newTask.task_type_ids : [newTask.task_type_id].filter(Boolean);

        if (!newTask?.category_type_id || selectedTaskIds.length === 0 || !newTask?.tailor_id) {
            alert("Please select category, task, and tailor.");
            return;
        }

        try {
            await Promise.all(selectedTaskIds.map(taskTypeId => (
                db.createWorkAssignment({
                    item_id: item.id,
                    category_type_id: newTask.category_type_id,
                    task_type_id: taskTypeId,
                    tailor_id: newTask.tailor_id
                })
            )));

            setNewTask({
                category_type_id: '',
                task_type_id: '',
                task_type_ids: [],
                tailor_id: '',
            });
            setNewCategorySearch('');
            setNewTaskTypeSearch('');
            setNewTailorSearch('');
            setShowAssignForm(false);
            await loadData();
        } catch (err) {
            console.error('Create task failed:', err);
            alert(err.message || 'Failed to assign task.');
        }
    };

    const handleUpdateTask = async (e) => {
        if (!canManageQc) {
            e.preventDefault();
            alert("Not allowed");
            return;
        }
        e.preventDefault();
        if (selectedRates.length === 0) {
            alert("Invalid Rate Configuration");
            return;
        }

        try {
            await db.updateWorkAssignment(editTaskData.id, {
                category_type_id: editTaskData.category_type_id,
                task_type_id: editTaskData.task_type_id,
                tailor_id: editTaskData.tailor_id
            });
            setEditingTask(null);
            setEditCategorySearch('');
            setEditTaskTypeSearch('');
            setEditTailorSearch('');
            loadData(); // Refresh
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDeleteTask = async (taskId) => {
        if (!canManageQc) return;

        if (!window.confirm("Are you sure you want to remove this assigned task?")) return;

        try {
            await db.deleteWorkAssignment(taskId);
            await loadData(); // refresh QC queue
        } catch (err) {
            alert(err.message);
        }
    };

    if (loading || !item) {
        return (
            <div className="space-y-6 animate-pulse p-2">
                {!onClose && <div className="h-8 w-32 bg-gray-200 rounded"></div>}
                <div className="flex justify-between items-start">
                    <div>
                        <div className="h-8 w-48 bg-gray-200 rounded mb-2"></div>
                        <div className="h-4 w-64 bg-gray-200 rounded"></div>
                    </div>
                </div>
                <Card padding="p-4">
                    <div className="space-y-4">
                        <div className="h-10 bg-gray-100 rounded"></div>
                        <div className="h-10 bg-gray-100 rounded"></div>
                    </div>
                </Card>
            </div>
        );
    }

    const handleClose = () => {
        if (onClose) {
            onClose();
        } else {
            router.push('/qc');
        }
    };

    const handleSelectTailor = (tailor, mode) => {
        if (mode === 'edit') {
            setEditTaskData(prev => ({ ...prev, tailor_id: tailor.id }));
            setEditTailorSearch(tailor.name);
            return;
        }

        setNewTask(prev => ({ ...prev, tailor_id: tailor.id }));
        setNewTailorSearch(tailor.name);
    };

    const handleSelectCategory = (category, mode) => {
        if (mode === 'edit') {
            setEditTaskData(prev => ({
                ...prev,
                category_type_id: category.id,
                task_type_id: '',
            }));
            setEditCategorySearch(category.name);
            setEditTaskTypeSearch('');
            return;
        }

        setNewTask(prev => ({
            ...prev,
            category_type_id: category.id,
            task_type_id: '',
            task_type_ids: [],
        }));
        setNewCategorySearch(category.name);
        setNewTaskTypeSearch('');
    };

    const handleSelectTaskType = (taskType, mode) => {
        if (mode === 'edit') {
            setEditTaskData(prev => ({ ...prev, task_type_id: taskType.id }));
            setEditTaskTypeSearch(taskType.name);
            return;
        }

        setNewTask(prev => ({ ...prev, task_type_id: taskType.id }));
        setNewTaskTypeSearch(taskType.name);
    };

    return (
        <div className="space-y-6">
            {!onClose && (
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={handleClose}>
                        <ArrowLeft size={16} className="mr-2" /> Back to Queue
                    </Button>
                </div>
            )}

            {/* Item Header */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                    <h1 className="text-xl font-serif text-maison-primary flex items-center gap-3">
                        {item.item_key}
                        <Badge variant="neutral">{item.product_type_name}</Badge>
                    </h1>
                    <p className="text-sm text-maison-secondary mt-1">
                        Ticket: {item.ticket_number} | Customer: {item.customer_name}
                    </p>
                </div>
                <Button onClick={() => {
                    setShowAssignForm(!showAssignForm);
                    if (!showAssignForm) {
                        setNewCategorySearch('');
                        setNewTaskTypeSearch('');
                        setNewTailorSearch('');
                        setNewTask({
                            category_type_id: '',
                            task_type_id: '',
                            task_type_ids: [],
                            tailor_id: '',
                        });
                    }
                }} disabled={!canManageQc}>
                    <Plus size={16} className="mr-2" /> Assign Task
                </Button>
            </div>

            {showAssignForm && (
                <Card className="border-maison-accent/20 bg-maison-accent/5">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium text-maison-primary">Assign New Task</h3>
                    </div>

                    {availableCategories.length === 0 ? (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm mb-4">
                            <strong>No tasks available.</strong> There are currently no Rate Cards configured for this Product Type ({item.product_type_name}). Please go to <strong>Settings &gt; Task Types & Rates</strong> to configure them first.
                        </div>
                    ) : (
                        <form onSubmit={handleCreateTask} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-maison-secondary mb-1.5">Category</label>
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                            value={newCategorySearch}
                                            onChange={e => {
                                                setNewCategorySearch(e.target.value);
                                                setNewTask(prev => ({ ...prev, category_type_id: '', task_type_id: '', task_type_ids: [] }));
                                                setNewTaskTypeSearch('');
                                            }}
                                            placeholder="Type category name..."
                                            required
                                        />
                                        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                            {filteredCategories.length > 0 ? filteredCategories.map(c => (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => handleSelectCategory(c, 'new')}
                                                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                                >
                                                    <span>{c.name}</span>
                                                </button>
                                            )) : (
                                                <div className="px-3 py-2 text-sm text-gray-500">No matching categories found.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-maison-secondary mb-1.5">Task Type</label>
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                            value={newTaskTypeSearch}
                                            onChange={e => {
                                                setNewTaskTypeSearch(e.target.value);
                                                if (!isAmendmentCategory) {
                                                    setNewTask(prev => ({ ...prev, task_type_id: '' }));
                                                }
                                            }}
                                            placeholder="Type task name..."
                                            disabled={!newTask.category_type_id}
                                        />
                                        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                            {!newTask.category_type_id ? (
                                                <div className="px-3 py-2 text-sm text-gray-500">Select a category first.</div>
                                            ) : filteredTaskTypes.length > 0 ? (
                                                isAmendmentCategory ? filteredTaskTypes.map(t => {
                                                    const checked = newTask.task_type_ids.includes(t.id);
                                                    return (
                                                        <label
                                                            key={t.id}
                                                            className="flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => {
                                                                    setNewTask(prev => ({
                                                                        ...prev,
                                                                        task_type_ids: checked
                                                                            ? prev.task_type_ids.filter(id => id !== t.id)
                                                                            : [...prev.task_type_ids, t.id],
                                                                        task_type_id: ''
                                                                    }));
                                                                }}
                                                            />
                                                            <span>{t.name}</span>
                                                        </label>
                                                    );
                                                }) : filteredTaskTypes.map(t => (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => handleSelectTaskType(t, 'new')}
                                                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                                    >
                                                        <span>{t.name}</span>
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="px-3 py-2 text-sm text-gray-500">No matching task types found.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-maison-secondary mb-1.5">Tailor</label>
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                            value={newTailorSearch}
                                            onChange={e => {
                                                setNewTailorSearch(e.target.value);
                                                setNewTask(prev => ({ ...prev, tailor_id: '' }));
                                            }}
                                            placeholder="Type tailor name..."
                                            required
                                        />
                                        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                            {filteredTailors.length > 0 ? filteredTailors.map(t => {
                                                const band = t.band || 'A';
                                                return (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => handleSelectTailor(t, 'new')}
                                                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                                    >
                                                        <span>{t.name}</span>
                                                        <span className="text-xs text-gray-500">Band {band}</span>
                                                    </button>
                                                );
                                            }) : (
                                                <div className="px-3 py-2 text-sm text-gray-500">No matching tailors found.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Box */}
                            <div className="bg-white p-4 rounded-lg border border-gray-100 mt-4 shadow-sm">
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-500">Pay Band:</span>
                                    <span className="font-medium">
                                        Band {tailorBand}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm font-bold text-maison-primary pt-2 border-t border-gray-100 mt-2">
                                    <span>Total Pay:</span>
                                    <span>₦{calculatedPay}</span>
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end gap-3">
                                <Button type="button" variant="ghost" onClick={() => {
                                    setShowAssignForm(false);
                                    setNewCategorySearch('');
                                    setNewTaskTypeSearch('');
                                    setNewTailorSearch('');
                                    setNewTask({
                                        category_type_id: '',
                                        task_type_id: '',
                                        task_type_ids: [],
                                        tailor_id: '',
                                    });
                                }}>Cancel</Button>
                                <Button type="submit">Assign Task</Button>
                            </div>
                        </form>
                    )}
                </Card>
            )}

            {editingTask && (
                <Card className="border-maison-accent/20 bg-maison-accent/5">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium text-maison-primary">Edit Task</h3>
                    </div>

                    <form onSubmit={handleUpdateTask} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-maison-secondary mb-1.5">Category</label>
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                        value={editCategorySearch}
                                        onChange={e => {
                                            setEditCategorySearch(e.target.value);
                                            setEditTaskData(prev => ({ ...prev, category_type_id: '', task_type_id: '' }));
                                            setEditTaskTypeSearch('');
                                        }}
                                        placeholder="Type category name..."
                                        required
                                    />
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                        {filteredCategories.length > 0 ? filteredCategories.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                onClick={() => handleSelectCategory(c, 'edit')}
                                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                            >
                                                <span>{c.name}</span>
                                            </button>
                                        )) : (
                                            <div className="px-3 py-2 text-sm text-gray-500">No matching categories found.</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-maison-secondary mb-1.5">Task Type</label>
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                        value={editTaskTypeSearch}
                                        onChange={e => {
                                            setEditTaskTypeSearch(e.target.value);
                                            setEditTaskData(prev => ({ ...prev, task_type_id: '' }));
                                        }}
                                        placeholder="Type task name..."
                                        disabled={!editTaskData.category_type_id}
                                    />
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                        {!editTaskData.category_type_id ? (
                                            <div className="px-3 py-2 text-sm text-gray-500">Select a category first.</div>
                                        ) : filteredTaskTypes.length > 0 ? filteredTaskTypes.map(t => (
                                            <button
                                                key={t.id}
                                                type="button"
                                                onClick={() => handleSelectTaskType(t, 'edit')}
                                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                            >
                                                <span>{t.name}</span>
                                            </button>
                                        )) : (
                                            <div className="px-3 py-2 text-sm text-gray-500">No matching task types found.</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-maison-secondary mb-1.5">Tailor</label>
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                                        value={editTailorSearch}
                                        onChange={e => {
                                            setEditTailorSearch(e.target.value);
                                            setEditTaskData(prev => ({ ...prev, tailor_id: '' }));
                                        }}
                                        placeholder="Type tailor name..."
                                        required
                                    />
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                                        {filteredTailors.length > 0 ? filteredTailors.map(t => {
                                            const band = t.band || 'A';
                                            return (
                                                <button
                                                    key={t.id}
                                                    type="button"
                                                    onClick={() => handleSelectTailor(t, 'edit')}
                                                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                                                >
                                                    <span>{t.name}</span>
                                                    <span className="text-xs text-gray-500">Band {band}</span>
                                                </button>
                                            );
                                        }) : (
                                            <div className="px-3 py-2 text-sm text-gray-500">No matching tailors found.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Summary Box */}
                        <div className="bg-white p-4 rounded-lg border border-gray-100 mt-4 shadow-sm">
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-500">Pay Band:</span>
                                <span className="font-medium">
                                    Band {tailorBand}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm font-bold text-maison-primary pt-2 border-t border-gray-100 mt-2">
                                <span>Total Pay:</span>
                                <span>₦{calculatedPay}</span>
                            </div>
                        </div>

                        <div className="pt-2 flex justify-end gap-3">
                            <Button type="button" variant="ghost" onClick={() => {
                                setEditingTask(null);
                                setEditCategorySearch('');
                                setEditTaskTypeSearch('');
                                setEditTailorSearch('');
                            }}>Cancel</Button>
                            <Button type="submit">Update Task</Button>
                        </div>
                    </form>
                </Card>
            )}

            <Card padding="p-0">
                <Table headers={['Category', 'Task', 'Tailor', 'Est. Pay', 'Status', 'Verified By', 'Actions']}>
                    {tasks.map(task => (
                        <TableRow key={task.id}>
                            <TableCell>{task.category_name}</TableCell>
                            <TableCell className="font-medium">{task.task_type_name}</TableCell>
                            <TableCell>{task.tailor_name}</TableCell>
                            <TableCell>₦{parseFloat(task.pay_amount).toFixed(2)}</TableCell>
                            <TableCell>
                                <Badge variant={task.status === 'Approved' || task.status === 'PAID' ? 'success' : task.status === 'Rejected' ? 'danger' : 'warning'}>
                                    {task.status}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-gray-400 text-xs">
                                -
                            </TableCell>
                            <TableCell>
                                {task.status === 'CREATED' && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingTask(task.id);
                                                setEditTaskData({
                                                    id: task.id,
                                                    category_type_id: task.category_type_id,
                                                    task_type_id: task.task_type_id,
                                                    tailor_id: task.tailor_id
                                                });
                                                setEditCategorySearch(task.category_name || '');
                                                setEditTaskTypeSearch(task.task_type_name || '');
                                                setEditTailorSearch(task.tailor_name || '');
                                                setShowAssignForm(false);
                                            }}
                                            disabled={!canManageQc}
                                            className={`p-1 transition-colors ${!canManageQc ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-maison-primary'}`}
                                            title="Edit Task"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteTask(task.id);
                                            }}
                                            disabled={!canManageQc}
                                            className={`p-1 transition-colors ${!canManageQc ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                                            title="Remove Task"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                    {tasks.length === 0 && (
                        <tr>
                            <td colSpan="6" className="px-6 py-8 text-center text-gray-500 text-sm">
                                No tasks assigned yet.
                            </td>
                        </tr>
                    )}
                </Table>
            </Card>
        </div >
    );
}
