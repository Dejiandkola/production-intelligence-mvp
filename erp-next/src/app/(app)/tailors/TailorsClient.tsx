// eslint-disable-next-line @typescript-eslint/ban-ts-comment
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
import { formatMoney } from '@/lib/formatters';
import { Edit2, Plus, Power, PowerOff, Trash2 } from 'lucide-react';

const DEPARTMENTS = ['PANT', 'SHIRT', 'SUIT', 'KAFTAN', 'ACCESSORIES', 'DESIGN', 'CUTTER', 'OTHER'];
export default function ManageTailors({ canManageTailors }: { canManageTailors: boolean }) {
    const [tailors, setTailors] = useState([]);
    const [taskTypes, setTaskTypes] = useState([]);
    const [specialPayRules, setSpecialPayRules] = useState([]);
    const [loading, setLoading] = useState(true);

    const [isTailorModalOpen, setIsTailorModalOpen] = useState(false);
    const [editingTailor, setEditingTailor] = useState(null);

    const [isSpecialPayModalOpen, setIsSpecialPayModalOpen] = useState(false);
    const [activeSpecialPayTailor, setActiveSpecialPayTailor] = useState(null);
    const [editingSpecialPayRule, setEditingSpecialPayRule] = useState(null);
    const [specialPayForm, setSpecialPayForm] = useState({ task_type_id: '', special_fee: '' });

    const [tailorForm, setTailorForm] = useState({
        name: '', department: 'OTHER', band: 'A', active: true
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        const [tailorsData, taskTypesData, specialPayData] = await Promise.all([
            db.getTailors(),
            db.getTaskTypes(),
            db.getTailorSpecialPay()
        ]);
        setTailors(tailorsData);
        setTaskTypes(taskTypesData || []);
        setSpecialPayRules(specialPayData || []);
        setLoading(false);
    };

    const getTailorSpecialPayRules = (tailorId) => {
        return specialPayRules
            .filter(rule => rule.tailor_id === tailorId)
            .sort((a, b) => (a.task_type_name || '').localeCompare(b.task_type_name || ''));
    };

    const resetSpecialPayForm = () => {
        setEditingSpecialPayRule(null);
        setSpecialPayForm({ task_type_id: taskTypes[0]?.id || '', special_fee: '' });
    };

    const handleOpenTailorModal = (tailor = null) => {
        if (tailor) {
            setEditingTailor(tailor);
            setTailorForm({
                name: tailor.name,
                department: tailor.department || 'OTHER',
                band: tailor.band || 'A',
                active: tailor.active
            });
        } else {
            setEditingTailor(null);
            setTailorForm({ name: '', department: 'OTHER', band: 'A', active: true });
        }
        setIsTailorModalOpen(true);
    };

    const handleOpenSpecialPayModal = (tailor) => {
        setActiveSpecialPayTailor(tailor);
        setIsSpecialPayModalOpen(true);
        setEditingSpecialPayRule(null);
        setSpecialPayForm({ task_type_id: taskTypes[0]?.id || '', special_fee: '' });
    };

    const handleEditSpecialPayRule = (rule) => {
        setEditingSpecialPayRule(rule);
        setSpecialPayForm({
            task_type_id: rule.task_type_id,
            special_fee: String(rule.special_fee ?? '')
        });
    };

    const handleCloseSpecialPayModal = () => {
        setIsSpecialPayModalOpen(false);
        setActiveSpecialPayTailor(null);
        resetSpecialPayForm();
    };

    const handleSaveSpecialPay = async (event) => {
        event.preventDefault();
        if (!canManageTailors || !activeSpecialPayTailor) return;

        try {
            await db.saveTailorSpecialPay(
                activeSpecialPayTailor.id,
                specialPayForm.task_type_id,
                specialPayForm.special_fee
            );
            await loadData();
            resetSpecialPayForm();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDeleteSpecialPay = async (rule) => {
        if (!canManageTailors) return;
        if (!window.confirm(`Remove special fee for ${rule.task_type_name || 'this task'}?`)) return;

        try {
            await db.removeTailorSpecialPay(rule.id);
            await loadData();
            if (editingSpecialPayRule?.id === rule.id) resetSpecialPayForm();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleSaveTailor = async (e) => {
        e.preventDefault();
        if (!canManageTailors) {
            alert("Master Data writes are read-only for your role.");
            return;
        }
        try {
            if (editingTailor) {
                await db.updateTailor(editingTailor.id, tailorForm);
            } else {
                await db.createTailor(tailorForm);
            }
            setIsTailorModalOpen(false);
            loadData();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleToggleStatus = async (tailor) => {
        if (!canManageTailors) {
            alert("Master Data writes are read-only for your role.");
            return;
        }
        const action = tailor.active ? 'deactivate' : 'activate';
        if (tailor.active && !window.confirm(`Are you sure you want to ${action} ${tailor.name}? They will no longer appear in assignment dropdowns.`)) {
            return;
        }

        try {
            await db.toggleTailorStatus(tailor.id);
            await loadData();
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDeleteTailor = async (tailor) => {
        if (!canManageTailors) {
            alert("Master Data writes are read-only for your role.");
            return;
        }

        if (window.confirm(`Are you sure you want to delete ${tailor.name}?`)) {
            try {
                await db.deleteTailor(tailor.id);
                setTailors(prev => prev.filter(t => t.id !== tailor.id));
                setSpecialPayRules(prev => prev.filter(rule => rule.tailor_id !== tailor.id));
            } catch (err) {
                alert(err.message);
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Tailors</h1>
                    <p className="text-sm text-maison-secondary">Manage atelier staff, departments, pay bands, and special task fees</p>
                </div>
                <div className="flex gap-3">
                    {canManageTailors && (
                        <CSVImporter
                            onImport={async (data) => {
                                if (!canManageTailors) {
                                    alert("Tailor writes are read-only for your role.");
                                    return;
                                }

                                let created = 0;
                                let updated = 0;
                                let unchanged = 0;
                                let skipped = 0;
                                const skippedReasons = [];

                                setLoading(true);

                                try {
                                    for (const row of data) {
                                        const name = String(row['Tailor Name'] ?? '').trim();
                                        const department = String(row['Department'] ?? '').trim();
                                        const bandRaw = String(row['Band'] ?? '').trim();

                                        const isCompletelyBlank = !name && !department && !bandRaw;
                                        if (isCompletelyBlank) {
                                            continue;
                                        }

                                        if (!name) {
                                            skipped++;
                                            skippedReasons.push({ row, reason: 'Missing Tailor Name' });
                                            continue;
                                        }

                                        const cleanedBand = bandRaw.toLowerCase();
                                        const validBand =
                                            cleanedBand === 'a' || cleanedBand === 'band a'
                                                ? 'A'
                                                : cleanedBand === 'b' || cleanedBand === 'band b'
                                                    ? 'B'
                                                    : null;

                                        if (!validBand) {
                                            skipped++;
                                            skippedReasons.push({ row, reason: `Invalid Band: ${bandRaw}` });
                                            continue;
                                        }

                                        try {
                                            const result = await db.upsertTailorByName({
                                                name,
                                                department: department || '-',
                                                band: validBand
                                            });

                                            if (result.action === 'created') created++;
                                            else if (result.action === 'updated') updated++;
                                            else unchanged++;
                                        } catch (rowError) {
                                            skipped++;
                                            skippedReasons.push({
                                                row,
                                                reason: rowError.message || 'Unknown import error'
                                            });
                                            console.error('Tailor row import failed:', row, rowError);
                                        }
                                    }

                                    await loadData();

                                    console.log('Tailor import skipped reasons:', skippedReasons);
                                    alert(
                                        `Tailor import complete.\nCreated: ${created}\nUpdated: ${updated}\nUnchanged: ${unchanged}\nSkipped: ${skipped}`
                                    );
                                } catch (error) {
                                    console.error('Tailor import failed:', error);
                                    alert(error.message || 'Tailor import failed.');
                                } finally {
                                    setLoading(false);
                                }
                            }}
                        />
                    )}
                    <Button onClick={() => handleOpenTailorModal()} disabled={!canManageTailors}>
                        <Plus size={16} className="mr-2" />
                        Add Tailor
                    </Button>
                </div>
            </div>

            <Card padding="p-0">
                <Table headers={['Name', 'Department', 'Band', 'Special Pay', 'Status', 'Actions']}>
                    {tailors.map((tailor) => {
                        const rules = getTailorSpecialPayRules(tailor.id);
                        return (
                            <TableRow key={tailor.id}>
                                <TableCell className="font-medium">{tailor.name}</TableCell>
                                <TableCell>{tailor.department}</TableCell>
                                <TableCell>
                                    <Badge variant={(tailor.band || 'A') === 'B' ? 'warning' : 'neutral'}>
                                        Band {tailor.band || 'A'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    {rules.length > 0 ? (
                                        <Badge variant="brand">
                                            {rules.length} special {rules.length === 1 ? 'task' : 'tasks'}
                                        </Badge>
                                    ) : (
                                        <span className="text-sm text-gray-400">None</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={tailor.active ? 'success' : 'neutral'}>
                                        {tailor.active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-3">
                                        <button
                                            title="Special Pay"
                                            onClick={() => handleOpenSpecialPayModal(tailor)}
                                            disabled={!canManageTailors}
                                            className={`p-1 transition-colors ${!canManageTailors ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-maison-primary'}`}
                                        >
                                            <Plus size={16} />
                                        </button>
                                        <button
                                            title={tailor.active ? "Deactivate Tailor" : "Activate Tailor"}
                                            onClick={() => handleToggleStatus(tailor)}
                                            disabled={!canManageTailors}
                                            className={`p-1 transition-colors ${!canManageTailors ? 'text-gray-300 cursor-not-allowed' : tailor.active ? 'text-gray-400 hover:text-red-500' : 'text-red-400 hover:text-green-500'}`}
                                        >
                                            {tailor.active ? <PowerOff size={16} /> : <Power size={16} />}
                                        </button>
                                        <button
                                            title="Edit Tailor"
                                            onClick={() => handleOpenTailorModal(tailor)}
                                            disabled={!canManageTailors}
                                            className={`p-1 transition-colors ${!canManageTailors ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-maison-primary'}`}
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            title="Delete Tailor"
                                            onClick={() => handleDeleteTailor(tailor)}
                                            disabled={!canManageTailors}
                                            className={`p-1 transition-colors ${!canManageTailors ? 'text-gray-300 cursor-not-allowed' : 'text-red-400 hover:text-red-600'}`}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                    {tailors.length === 0 && !loading && (
                        <tr>
                            <td colSpan="6" className="px-6 py-8 text-center text-gray-500 text-sm">
                                No tailors found.
                            </td>
                        </tr>
                    )}
                </Table>
            </Card>

            <Modal
                isOpen={isTailorModalOpen}
                onClose={() => setIsTailorModalOpen(false)}
                title={editingTailor ? 'Edit Tailor' : 'Add New Tailor'}
            >
                <form onSubmit={handleSaveTailor} className="space-y-4">
                    <Input
                        label="Full Name"
                        value={tailorForm.name}
                        onChange={(e) => setTailorForm({ ...tailorForm, name: e.target.value })}
                        placeholder="e.g. Marco Vitti"
                        required
                    />

                    <div>
                        <label className="block text-sm font-medium text-maison-secondary mb-1.5">Department</label>
                        <select
                            className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                            value={tailorForm.department}
                            onChange={(e) => setTailorForm({ ...tailorForm, department: e.target.value })}
                            required
                        >
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-maison-secondary mb-1.5">Pay Band</label>
                        <select
                            className="block w-full rounded-lg border-gray-200 shadow-sm sm:text-sm py-2.5"
                            value={tailorForm.band}
                            onChange={(e) => setTailorForm({ ...tailorForm, band: e.target.value })}
                            required
                        >
                            <option value="A">Band A (Standard)</option>
                            <option value="B">Band B (Senior)</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                        <input
                            type="checkbox"
                            id="activeTailor"
                            checked={tailorForm.active}
                            onChange={(e) => setTailorForm({ ...tailorForm, active: e.target.checked })}
                            className="rounded border-gray-300 text-maison-primary focus:ring-maison-primary"
                        />
                        <label htmlFor="activeTailor" className="text-sm font-medium text-maison-secondary">Active Status</label>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <Button type="button" variant="ghost" onClick={() => setIsTailorModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canManageTailors}>
                            {editingTailor ? 'Update Tailor' : 'Create Tailor'}
                        </Button>
                    </div>
                </form>
            </Modal>

            <Modal
                isOpen={isSpecialPayModalOpen}
                onClose={handleCloseSpecialPayModal}
                title={activeSpecialPayTailor ? `Special Pay: ${activeSpecialPayTailor.name}` : 'Special Pay'}
                maxWidth="max-w-2xl"
            >
                <div className="space-y-5">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="text-sm font-medium text-maison-primary">Existing special fees</div>
                        <div className="mt-3 space-y-2">
                            {activeSpecialPayTailor && getTailorSpecialPayRules(activeSpecialPayTailor.id).length > 0 ? (
                                getTailorSpecialPayRules(activeSpecialPayTailor.id).map(rule => (
                                    <div key={rule.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
                                        <div>
                                            <div className="font-medium text-maison-primary">{rule.task_type_name || 'Task'}</div>
                                            <div className="text-maison-secondary">{formatMoney(rule.special_fee)}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleEditSpecialPayRule(rule)}
                                                className="rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-maison-primary"
                                                title="Edit special fee"
                                            >
                                                <Edit2 size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteSpecialPay(rule)}
                                                className="rounded p-1.5 text-red-400 transition hover:bg-red-50 hover:text-red-600"
                                                title="Delete special fee"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-sm text-gray-500">No special fees yet.</div>
                            )}
                        </div>
                    </div>

                    <form onSubmit={handleSaveSpecialPay} className="space-y-4 border-t border-gray-100 pt-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Task Type</label>
                                <select
                                    value={specialPayForm.task_type_id}
                                    onChange={(event) => setSpecialPayForm(prev => ({ ...prev, task_type_id: event.target.value }))}
                                    required
                                    className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                >
                                    <option value="">Select task...</option>
                                    {taskTypes.map(task => (
                                        <option key={task.id} value={task.id}>{task.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Special Fee</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={specialPayForm.special_fee}
                                    onChange={(event) => setSpecialPayForm(prev => ({ ...prev, special_fee: event.target.value }))}
                                    placeholder="3000"
                                    required
                                    className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            {editingSpecialPayRule && (
                                <Button type="button" variant="ghost" onClick={resetSpecialPayForm}>
                                    Cancel Edit
                                </Button>
                            )}
                            <Button type="submit" disabled={!canManageTailors || taskTypes.length === 0}>
                                {editingSpecialPayRule ? 'Update Special Fee' : 'Add Special Fee'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Modal>
        </div>
    );
}