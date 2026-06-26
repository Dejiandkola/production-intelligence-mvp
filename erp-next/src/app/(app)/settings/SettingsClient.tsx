// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import React, { useEffect, useState } from 'react';
import { Edit2, Plus, Power, PowerOff, Trash2, X } from 'lucide-react';
import { db } from '@/services/db';
import { Card } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Modal } from '@/components/UI/Modal';
import { Badge, Table, TableCell, TableRow } from '@/components/UI/Table';

const FIELD_TYPES = [
    { value: 'short_text', label: 'Short Text' },
    { value: 'long_text', label: 'Long Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
];

const emptyForm = {
    id: null,
    label: '',
    field_type: 'short_text',
    required: false,
    active: true,
    options: [],
};

function getFieldTypeLabel(type) {
    return FIELD_TYPES.find(fieldType => fieldType.value === type)?.label || type;
}

function makeNewOption() {
    return { id: null, label: '', active: true };
}

export default function SettingsClient() {
    const [fields, setFields] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);

    useEffect(() => {
        loadFields();
    }, []);

    const loadFields = async () => {
        setLoading(true);
        try {
            const data = await db.getCustomFields('items');
            setFields(data);
        } catch (err) {
            setError(err.message || 'Could not load custom fields.');
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setError('');
        setForm({ ...emptyForm, options: [] });
        setIsModalOpen(true);
    };

    const openEditModal = (field) => {
        setError('');
        setForm({
            id: field.id,
            label: field.label || '',
            field_type: field.field_type || 'short_text',
            required: Boolean(field.required),
            active: field.active !== false,
            options: (field.options || []).filter(option => option.active).map(option => ({
                id: option.id,
                label: option.label || '',
                active: option.active !== false,
            })),
        });
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setForm(emptyForm);
        setSaving(false);
    };

    const updateOption = (index, value) => {
        setForm(prev => ({
            ...prev,
            options: prev.options.map((option, optionIndex) => (
                optionIndex === index ? { ...option, label: value } : option
            )),
        }));
    };

    const removeOption = (index) => {
        setForm(prev => ({
            ...prev,
            options: prev.options.filter((_, optionIndex) => optionIndex !== index),
        }));
    };

    const handleSave = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');

        try {
            await db.saveCustomField({
                ...form,
                options: form.field_type === 'dropdown' ? form.options : [],
            });
            closeModal();
            await loadFields();
        } catch (err) {
            setError(err.message || 'Could not save custom field.');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (field) => {
        try {
            await db.setCustomFieldActive(field.id, !field.active);
            await loadFields();
        } catch (err) {
            alert(err.message || 'Could not update field status.');
        }
    };

    const handleDelete = async (field) => {
        const confirmation = window.prompt(`Permanently delete "${field.label}" and ${field.value_count || 0} saved value${field.value_count === 1 ? '' : 's'}? Type DELETE to confirm.`);
        if (confirmation === null) return;

        try {
            await db.deleteCustomField(field.id, confirmation);
            await loadFields();
        } catch (err) {
            alert(err.message || 'Could not delete field.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-serif text-maison-primary">Settings</h1>
                    <p className="text-sm text-maison-secondary">Manage custom item input fields for Customer Service intake.</p>
                </div>
                <Button onClick={openCreateModal}>
                    <Plus size={16} className="mr-2" />
                    Add Field
                </Button>
            </div>

            <div className="border-b border-gray-200">
                <button className="border-b-2 border-maison-primary px-1 pb-3 text-sm font-medium text-maison-primary">
                    Custom Fields
                </button>
            </div>

            {error && !isModalOpen && (
                <Card>
                    <div className="text-sm text-red-600">{error}</div>
                </Card>
            )}

            <Card padding="p-0">
                <Table headers={['Field', 'Type', 'Required', 'Status', 'Saved Values', 'Actions']}>
                    {fields.map(field => (
                        <TableRow key={field.id}>
                            <TableCell className="font-medium">{field.label}</TableCell>
                            <TableCell>{getFieldTypeLabel(field.field_type)}</TableCell>
                            <TableCell>
                                <Badge variant={field.required ? 'warning' : 'neutral'}>
                                    {field.required ? 'Required' : 'Optional'}
                                </Badge>
                            </TableCell>
                            <TableCell>
                                <Badge variant={field.active ? 'success' : 'neutral'}>
                                    {field.active ? 'Active' : 'Inactive'}
                                </Badge>
                            </TableCell>
                            <TableCell>{field.value_count || 0}</TableCell>
                            <TableCell>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        title="Edit field"
                                        onClick={() => openEditModal(field)}
                                        className="p-1 text-gray-400 transition-colors hover:text-maison-primary"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        title={field.active ? 'Deactivate field' : 'Activate field'}
                                        onClick={() => handleToggleActive(field)}
                                        className="p-1 text-gray-400 transition-colors hover:text-maison-primary"
                                    >
                                        {field.active ? <PowerOff size={16} /> : <Power size={16} />}
                                    </button>
                                    <button
                                        type="button"
                                        title="Delete field"
                                        onClick={() => handleDelete(field)}
                                        className="p-1 text-gray-400 transition-colors hover:text-red-500"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}

                    {!loading && fields.length === 0 && (
                        <tr>
                            <td colSpan="6" className="px-6 py-10 text-center text-sm text-gray-500">
                                No custom fields yet.
                            </td>
                        </tr>
                    )}

                    {loading && (
                        <tr>
                            <td colSpan="6" className="px-6 py-10 text-center text-sm text-gray-500">
                                Loading custom fields...
                            </td>
                        </tr>
                    )}
                </Table>
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={closeModal}
                title={form.id ? 'Edit Custom Field' : 'Add Custom Field'}
                maxWidth="max-w-2xl"
            >
                <form onSubmit={handleSave} className="space-y-5">
                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Field Label *</label>
                        <input
                            value={form.label}
                            onChange={(event) => setForm(prev => ({ ...prev, label: event.target.value }))}
                            className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-maison-secondary">Field Type *</label>
                            <select
                                value={form.field_type}
                                onChange={(event) => setForm(prev => ({
                                    ...prev,
                                    field_type: event.target.value,
                                    options: event.target.value === 'dropdown' && prev.options.length === 0 ? [makeNewOption()] : prev.options,
                                }))}
                                className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                            >
                                {FIELD_TYPES.map(type => (
                                    <option key={type.value} value={type.value}>{type.label}</option>
                                ))}
                            </select>
                        </div>

                        <label className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-maison-secondary md:mt-6">
                            <input
                                type="checkbox"
                                checked={form.required}
                                onChange={(event) => setForm(prev => ({ ...prev, required: event.target.checked }))}
                            />
                            Required
                        </label>

                        <label className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-maison-secondary md:mt-6">
                            <input
                                type="checkbox"
                                checked={form.active}
                                onChange={(event) => setForm(prev => ({ ...prev, active: event.target.checked }))}
                            />
                            Active
                        </label>
                    </div>

                    {form.field_type === 'dropdown' && (
                        <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-maison-secondary">Dropdown Options *</label>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setForm(prev => ({ ...prev, options: [...prev.options, makeNewOption()] }))}>
                                    <Plus size={14} className="mr-1" />
                                    Add Option
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {form.options.map((option, index) => (
                                    <div key={option.id || index} className="flex gap-2">
                                        <input
                                            value={option.label}
                                            onChange={(event) => updateOption(index, event.target.value)}
                                            className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-maison-primary/20"
                                            placeholder={`Option ${index + 1}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeOption(index)}
                                            disabled={form.options.length === 1}
                                            className="rounded-md p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                        <Button type="button" variant="ghost" onClick={closeModal} disabled={saving}>Cancel</Button>
                        <Button type="submit" disabled={saving} isLoading={saving}>Save Field</Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
