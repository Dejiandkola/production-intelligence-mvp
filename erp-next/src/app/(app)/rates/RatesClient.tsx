// @ts-nocheck
"use client";

import React, { useState, useEffect } from 'react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Table, TableRow, TableCell, Badge } from '@/components/UI/Table';
import { Modal } from '@/components/UI/Modal';
import { Input } from '@/components/UI/Input';
import { CSVImporter } from '@/components/Shared/CSVImporter';
import { Plus, Edit2, Trash2, Power, PowerOff } from 'lucide-react';
import { hasPerm } from '@/lib/permissions';

export default function ManageTaskTypes({ permissions }: { permissions: string[] }) {
    const canManageRates = hasPerm(permissions, 'manage_rates');
    const [tasks, setTasks] = useState([]);
    const [productTypes, setProductTypes] = useState([]);
    const [categories, setCategories] = useState([]);
    const [taskTypes, setTaskTypes] = useState([]);
    const [rates, setRates] = useState([]);

    const [showNewProductType, setShowNewProductType] = useState(false);
    const [newProductTypeName, setNewProductTypeName] = useState('');
    const [showNewCategory, setShowNewCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [showNewTaskType, setShowNewTaskType] = useState(false);
    const [newTaskTypeName, setNewTaskTypeName] = useState('');

    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);

    const [formData, setFormData] = useState({
        product_type_id: '',
        category_type_id: '',
        task_type_id: '',
        name: '',
        band_a_fee: '',
        band_b_fee: '',
        active: true
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        const [pt, cat, r, tt] = await Promise.all([
            db.getProductTypes(),
            db.getCategories(),
            db.getRates(),
            db.getTaskTypes()
        ]);

        setTasks(r);
        setProductTypes(pt);
        setCategories(cat);
        setRates(r);
        setTaskTypes(tt);
        setLoading(false);
    };

    const handleOpenModal = (item = null) => {
        setShowNewProductType(false);
        setNewProductTypeName('');
        setShowNewCategory(false);
        setNewCategoryName('');
        setShowNewTaskType(false);
        setNewTaskTypeName('');

        if (item) {
            setEditingItem(item);
            setFormData({
                product_type_id: item.product_type_id,
                category_type_id: item.category_type_id,
                task_type_id: item.task_type_id,
                name: item.name,
                band_a_fee: item.band_a_fee,
                band_b_fee: item.band_b_fee,
                active: item.active
            });
        } else {
            setEditingItem(null);
            setFormData({
                product_type_id: productTypes[0]?.id || '',
                category_type_id: categories[0]?.id || '',
                task_type_id: taskTypes[0]?.id || '',
                name: '',
                band_a_fee: '',
                band_b_fee: '',
                active: true
            });
        }
        setIsModalOpen(true);
    };

    const handleCreateProductType = async () => {
        if (!newProductTypeName.trim()) return;
        try {
            setLoading(true);
            const newPt = await db.createProductType(newProductTypeName.trim());
            setProductTypes(prev => [...prev, newPt]);
            setFormData(prev => ({ ...prev, product_type_id: newPt.id }));
            setShowNewProductType(false);
            setNewProductTypeName('');
        } catch (err) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateCategory = async () => {
        if (!newCategoryName.trim()) return;
        try {
            setLoading(true);
            const newCat = await db.createCategory(newCategoryName.trim());
            setCategories(prev => [...prev, newCat]);
            setFormData(prev => ({ ...prev, category_type_id: newCat.id }));
            setShowNewCategory(false);
            setNewCategoryName('');
        } catch (err) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateTaskType = async () => {
        if (!newTaskTypeName.trim()) return;
        try {
            setLoading(true);
            const newTt = await db.createTaskType(newTaskTypeName.trim());
            setTaskTypes(prev => [...prev, newTt]);
            setFormData(prev => ({ ...prev, task_type_id: newTt.id }));
            setShowNewTaskType(false);
            setNewTaskTypeName('');
        } catch (err) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();

        if (!canManageRates) {
            alert("Master Data writes are read-only for your role.");
            return;
        }

        try {
            setLoading(true);

            const payload = {
                product_type_id: formData.product_type_id,
                category_type_id: formData.category_type_id,
                task_type_id: formData.task_type_id,
                band_a_fee: Number(formData.band_a_fee),
                band_b_fee: Number(formData.band_b_fee),
                active: formData.active
            };

            if (editingItem) {
                await db.updateRateCard(editingItem.id, payload);
            } else {
                await db.upsertRateCard(payload);
            }

            await loadData();
            setIsModalOpen(false);
        } catch (err) {
            console.error("Save failed:", err);
            alert(`Save failed: ${err?.message ?? String(err)}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (rateCard) => {
        if (!canManageRates) return;
        if (!window.confirm(`Are you sure you want to delete the rate card for ${rateCard.name}?`)) return;

        try {
            setLoading(true);
            await db.deleteRateCard(rateCard.id);
            await loadData();
        } catch (err) {
            console.error("Delete failed:", err);
            alert(`Cannot delete this rate card. It may be in use by existing work assignments.\n\nDetails: ${err?.message ?? String(err)}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteProductType = async (pt) => {
        if (!canManageRates) return;
        if (!window.confirm(`Are you sure you want to delete product type "${pt.name}"?`)) return;

        try {
            setLoading(true);
            await db.deleteProductType(pt.id);
            await loadData();
        } catch (err) {
            console.error("Delete failed:", err);
            alert(`Delete failed: ${err?.message ?? String(err)}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteCategory = async (cat) => {
        if (!canManageRates) return;
        if (!window.confirm(`Are you sure you want to delete category "${cat.name}"?`)) return;

        try {
            setLoading(true);
            await db.deleteCategory(cat.id);
            await loadData();
        } catch (err) {
            console.error("Delete failed:", err);
            alert(`Delete failed: ${err?.message ?? String(err)}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteTaskType = async (tt) => {
        if (!canManageRates) return;
        if (!window.confirm(`Are you sure you want to delete task type "${tt.name}"?`)) return;

        try {
            setLoading(true);
            await db.deleteTaskType(tt.id);
            await loadData();
        } catch (err) {
            console.error("Delete failed:", err);
            alert(`Delete failed: ${err?.message ?? String(err)}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Task Rates</h1>
                    <p className="text-sm text-maison-secondary">Configure tasks and base fees per product/category</p>
                </div>
                <div className="flex gap-3">
                    <CSVImporter
                        onImport={async (data) => {
                            if (!canManageRates) {
                                alert("Master Data writes are read-only for your role.");
                                return;
                            }

                            let count = 0;
                            let skipped = 0;
                            setLoading(true);

                            try {
                                for (const row of data) {
                                    const productName = row['Product Type']?.trim();
                                    const categoryName = row['Category Type']?.trim();
                                    const taskName = row['Task Type']?.trim();

                                    const bandAFee = Number(
                                        String(row['Band A Fee'] ?? row['Base Fee'] ?? '')
                                            .replace(/,/g, '')
                                            .trim()
                                    );

                                    const bandBFee = Number(
                                        String(row['Band B Fee'] ?? row['Band A Fee'] ?? row['Base Fee'] ?? '')
                                            .replace(/,/g, '')
                                            .trim()
                                    );

                                    if (!productName || !categoryName || !taskName || Number.isNaN(bandAFee)) {
                                        console.log('Skipped row:', row);
                                        skipped++;
                                        continue;
                                    }

                                    await db.createTaskAndRate(
                                        productName,
                                        categoryName,
                                        taskName,
                                        bandAFee,
                                        Number.isNaN(bandBFee) ? bandAFee : bandBFee
                                    );

                                    count++;
                                }

                                await loadData();
                                alert(`Imported ${count} task rates. Skipped ${skipped}.`);
                            } catch (error) {
                                console.error('Rates import failed:', error);
                                alert(error.message || 'Rates import failed.');
                            } finally {
                                setLoading(false);
                            }
                        }}
                    />
                    <Button onClick={() => handleOpenModal()} disabled={!canManageRates}>
                        <Plus size={16} className="mr-2" />
                        Add Task Type
                    </Button>
                </div>
            </div>

            <Card padding="p-0">
                <Table headers={['Product', 'Category', 'Task Name', 'Band A Fee', 'Band B Fee', 'Status', 'Actions']}>
                    {tasks.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell>{item.product_name}</TableCell>
                            <TableCell>{item.category_name}</TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>₦{parseFloat(item.band_a_fee).toFixed(2)}</TableCell>
                            <TableCell>₦{parseFloat(item.band_b_fee).toFixed(2)}</TableCell>
                            <TableCell>
                                <Badge variant={item.active ? 'success' : 'neutral'}>
                                    {item.active ? 'Active' : 'Inactive'}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                <div className="flex gap-2 items-center">
                                    <button
                                        onClick={async () => {
                                            if (!canManageRates) return;
                                            try {
                                                setLoading(true);
                                                await db.toggleRateCardStatus(item.id);
                                                await loadData();
                                            } catch (err) {
                                                alert(`Failed to toggle status: ${err?.message ?? String(err)}`);
                                                setLoading(false);
                                            }
                                        }}
                                        disabled={!canManageRates}
                                        className={`p-1 transition-colors ${!canManageRates ? 'text-gray-300 cursor-not-allowed' : item.active ? 'text-gray-400 hover:text-red-500' : 'text-red-400 hover:text-green-500'}`}
                                        title={item.active ? 'Deactivate Rate' : 'Activate Rate'}
                                    >
                                        {item.active ? <PowerOff size={16} /> : <Power size={16} />}
                                    </button>
                                    <button
                                        onClick={() => handleOpenModal(item)}
                                        disabled={!canManageRates}
                                        className={`p-1 transition-colors ${!canManageRates ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-maison-primary'}`}
                                        title="Edit Rate"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item)}
                                        disabled={!canManageRates}
                                        className={`p-1 transition-colors ${!canManageRates ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                                        title="Delete Rate"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </Table>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card padding="p-4">
                    <h3 className="text-lg font-medium text-maison-primary mb-4">Product Types</h3>
                    <div className="flex flex-col gap-2">
                        {productTypes.map(pt => (
                            <div key={pt.id} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-md border border-gray-100">
                                <span className="text-sm">{pt.name}</span>
                                <button
                                    onClick={() => handleDeleteProductType(pt)}
                                    disabled={!canManageRates}
                                    className={`p-1 transition-colors ${!canManageRates ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                                    title="Delete Product Type"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
                <Card padding="p-4">
                    <h3 className="text-lg font-medium text-maison-primary mb-4">Categories</h3>
                    <div className="flex flex-col gap-2">
                        {categories.map(cat => (
                            <div key={cat.id} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-md border border-gray-100">
                                <span className="text-sm">{cat.name}</span>
                                <button
                                    onClick={() => handleDeleteCategory(cat)}
                                    disabled={!canManageRates}
                                    className={`p-1 transition-colors ${!canManageRates ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                                    title="Delete Category"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
                <Card padding="p-4">
                    <h3 className="text-lg font-medium text-maison-primary mb-4">Task Types</h3>
                    <div className="flex flex-col gap-2">
                        {taskTypes.map(tt => (
                            <div key={tt.id} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-md border border-gray-100">
                                <span className="text-sm">{tt.name}</span>
                                <button
                                    onClick={() => handleDeleteTaskType(tt)}
                                    disabled={!canManageRates}
                                    className={`p-1 transition-colors ${!canManageRates ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500'}`}
                                    title="Delete Task Type"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingItem ? 'Edit Task Rate' : 'Add Task Rate'}
            >
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-maison-secondary mb-1.5">Product Type</label>
                        {showNewProductType ? (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <Input
                                        value={newProductTypeName}
                                        onChange={(e) => setNewProductTypeName(e.target.value)}
                                        placeholder="Enter new product type"
                                    />
                                    <Button type="button" onClick={handleCreateProductType}>Add</Button>
                                    <Button type="button" variant="ghost" onClick={() => {
                                        setShowNewProductType(false);
                                        setFormData({ ...formData, product_type_id: productTypes[0]?.id || '' });
                                    }}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <select
                                className="block w-full rounded-lg border-gray-200 shadow-sm focus:border-maison-accent focus:ring-maison-accent sm:text-sm py-2.5"
                                value={formData.product_type_id}
                                onChange={(e) => {
                                    if (e.target.value === 'NEW') setShowNewProductType(true);
                                    else setFormData({ ...formData, product_type_id: e.target.value });
                                }}
                            >
                                {productTypes.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                                <option value="NEW">+ Add New Product Type</option>
                            </select>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-maison-secondary mb-1.5">Category</label>
                        {showNewCategory ? (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <Input
                                        value={newCategoryName}
                                        onChange={(e) => setNewCategoryName(e.target.value)}
                                        placeholder="Enter new category"
                                    />
                                    <Button type="button" onClick={handleCreateCategory}>Add</Button>
                                    <Button type="button" variant="ghost" onClick={() => {
                                        setShowNewCategory(false);
                                        setFormData({ ...formData, category_type_id: categories[0]?.id || '' });
                                    }}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <select
                                className="block w-full rounded-lg border-gray-200 shadow-sm focus:border-maison-accent focus:ring-maison-accent sm:text-sm py-2.5"
                                value={formData.category_type_id}
                                onChange={(e) => {
                                    if (e.target.value === 'NEW') setShowNewCategory(true);
                                    else setFormData({ ...formData, category_type_id: e.target.value });
                                }}
                            >
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                                <option value="NEW">+ Add New Category</option>
                            </select>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-maison-secondary mb-1.5">Task Name</label>
                        {showNewTaskType ? (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <Input
                                        value={newTaskTypeName}
                                        onChange={(e) => setNewTaskTypeName(e.target.value)}
                                        placeholder="Enter new task name"
                                    />
                                    <Button type="button" onClick={handleCreateTaskType}>Add</Button>
                                    <Button type="button" variant="ghost" onClick={() => {
                                        setShowNewTaskType(false);
                                        setFormData({ ...formData, task_type_id: taskTypes[0]?.id || '' });
                                    }}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <select
                                className="block w-full rounded-lg border-gray-200 shadow-sm focus:border-maison-accent focus:ring-maison-accent sm:text-sm py-2.5"
                                value={formData.task_type_id}
                                onChange={(e) => {
                                    if (e.target.value === 'NEW') setShowNewTaskType(true);
                                    else setFormData({ ...formData, task_type_id: e.target.value });
                                }}
                            >
                                {taskTypes.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                                <option value="NEW">+ Add New Task</option>
                            </select>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Band A Fee (₦)"
                            type="number"
                            value={formData.band_a_fee}
                            onChange={(e) => setFormData({ ...formData, band_a_fee: e.target.value })}
                            placeholder="50.00"
                            required
                            min="0"
                            step="0.01"
                        />
                        <Input
                            label="Band B Fee (₦)"
                            type="number"
                            value={formData.band_b_fee}
                            onChange={(e) => setFormData({ ...formData, band_b_fee: e.target.value })}
                            placeholder="60.00"
                            required
                            min="0"
                            step="0.01"
                        />
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                        <label className="text-sm font-medium text-maison-secondary">Status</label>
                        <select
                            className="rounded-lg border-gray-200 shadow-sm focus:border-maison-accent focus:ring-maison-accent sm:text-sm py-2 px-3"
                            value={formData.active ? 'true' : 'false'}
                            onChange={(e) => setFormData({ ...formData, active: e.target.value === 'true' })}
                        >
                            <option value="true">Active</option>
                            <option value="false">Inactive</option>
                        </select>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canManageRates}>
                            {editingItem ? 'Update' : 'Create'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </div >
    );
}
