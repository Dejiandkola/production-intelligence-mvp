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
import { Plus, Edit2, Power, PowerOff, Trash2 } from 'lucide-react';

const DEPARTMENTS = ['PANT', 'SHIRT', 'SUIT', 'KAFTAN', 'ACCESSORIES', 'DESIGN', 'CUTTER', 'OTHER'];

export default function ManageTailors({ canManageTailors }: { canManageTailors: boolean }) {
    const [tailors, setTailors] = useState([]);
    const [loading, setLoading] = useState(true);

    const [isTailorModalOpen, setIsTailorModalOpen] = useState(false);
    const [editingTailor, setEditingTailor] = useState(null);

    const [tailorForm, setTailorForm] = useState({
        name: '', department: 'OTHER', band: 'A', active: true
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        const tailorsData = await db.getTailors();
        setTailors(tailorsData);
        setLoading(false);
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
                await db.deleteTailor(tailor.id)

                setTailors(prev => prev.filter(t => t.id !== tailor.id))

            } catch (err) {
                alert(err.message)
            }
        }
    };

    const handleImportCSV = async (data) => {
        if (!canManageTailors) {
            alert("Master Data writes are read-only for your role.");
            return;
        }
        setLoading(true);
        let count = 0;
        for (const row of data) {
            const name = row['TAILOR NAME'] || row.Name;
            if (name) {
                await db.createTailor({
                    name,
                    department: row['DEPARTMENT'] || 'OTHER',
                    band: row['BAND'] || row['Band'] || 'A',
                    active: true
                });
                count++;
            }
        }
        await loadData();
        alert(`Imported ${count} tailors with Band configurations.`);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Tailors</h1>
                    <p className="text-sm text-maison-secondary">Manage atelier staff, departments, and pay bands</p>
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
                <Table headers={['Name', 'Department', 'Band', 'Status', 'Actions']}>
                    {tailors.map((tailor) => {
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
                                    <Badge variant={tailor.active ? 'success' : 'neutral'}>
                                        {tailor.active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-3">
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
                        )
                    })}
                    {tailors.length === 0 && !loading && (
                        <tr>
                            <td colSpan="5" className="px-6 py-8 text-center text-gray-500 text-sm">
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
        </div>
    );
}
