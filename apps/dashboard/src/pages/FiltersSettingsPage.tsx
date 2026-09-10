import { TocynDialog, TocynConfirmDialog } from '@luminatick/ui/dialog';
import { TocynButton, TocynInput, TocynSelect } from '@luminatick/ui/primitives';
import React, { useState } from 'react';
import { useFilters, useCreateFilter, useUpdateFilter, useDeleteFilter } from '../hooks/useFilters';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import { TicketFilter, FilterCondition } from '@luminatick/shared';

const FIELDS = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'group_id', label: 'Group ID' },
  { value: 'assigned_to', label: 'Assigned To' },
  { value: 'source', label: 'Source' },
];

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Does Not Equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'in', label: 'In' },
];

export function FiltersSettingsPage() {
  const { data: filters, isLoading } = useFilters();
  const createFilter = useCreateFilter();
  const updateFilter = useUpdateFilter();
  const deleteFilter = useDeleteFilter();

  const deleteOpener = React.useRef<HTMLButtonElement | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const deletionGuard = React.useRef(false);
  const deleteSucceeded = React.useRef(false);
  const [deletion, setDeletion] = useState<TicketFilter | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingGuard = React.useRef(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const nameInput = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const nameId = React.useId();
  const [editingFilter, setEditingFilter] = useState<TicketFilter | null>(null);

  const [formData, setFormData] = useState<{ name: string; conditions: FilterCondition[] }>({
    name: '',
    conditions: [],
  });

  const handleOpenModal = (filter?: TicketFilter, trigger?: HTMLElement) => {
    opener.current = trigger ?? null;
    setSaveError('');
    if (filter) {
      setEditingFilter(filter);
      setFormData({
        name: filter.name,
        conditions: filter.conditions || [],
      });
    } else {
      setEditingFilter(null);
      setFormData({ name: '', conditions: [] });
    }
    setIsModalOpen(true);
  };

  const resetModal = () => {
    setIsModalOpen(false);
    setEditingFilter(null);
    setFormData({ name: '', conditions: [] });
  };

  const handleCloseModal = () => { if (!savingGuard.current) resetModal(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingGuard.current) return;
    savingGuard.current = true;
    setSaving(true);
    setSaveError('');
    try {
      if (editingFilter) {
        await updateFilter.mutateAsync({
          id: editingFilter.id,
          name: formData.name,
          conditions: formData.conditions,
        });
      } else {
        await createFilter.mutateAsync({
          name: formData.name,
          conditions: formData.conditions,
        });
      }
      resetModal();
    } catch {
      setSaveError('Filter could not be saved. Your changes have been kept; try again.');
    } finally {
      savingGuard.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletion || deletionGuard.current) return;
    deletionGuard.current = true; setDeleting(true); setDeleteError(''); setDeleteStatus('');
    try {
      await deleteFilter.mutateAsync(deletion.id);
      deleteSucceeded.current = true; setDeleteOpen(false); setDeleteStatus('Filter deleted.');
    } catch { setDeleteError('Filter could not be deleted. Try again.'); }
    finally { deletionGuard.current = false; setDeleting(false); }
  };

  const addCondition = () => {
    setFormData({
      ...formData,
      conditions: [...formData.conditions, { field: 'status', operator: 'equals', value: '' }]
    });
  };

  const removeCondition = (index: number) => {
    setFormData({
      ...formData,
      conditions: formData.conditions.filter((_, i) => i !== index)
    });
  };

  const changeCondition = (index: number, field: keyof FilterCondition, value: any) => {
    const newConditions = [...formData.conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setFormData({ ...formData, conditions: newConditions });
  };

  if (isLoading) {
    return <div className="p-8 text-slate-500">Loading filters...</div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-slate-900">Custom Filters</h1>
          <p className="text-slate-500 text-sm">Create and manage ticket filters for your team.</p>
        </div>
        <TocynButton
          onClick={event => handleOpenModal(undefined, event.currentTarget)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Filter
        </TocynButton>
      </div>

      {deleteStatus && <p role="status">{deleteStatus}</p>}
      <TocynConfirmDialog open={deleteOpen} busy={deleting} title={`Delete filter: ${deletion?.name ?? ''}`}
        description="Delete this filter? This action cannot be undone." confirmLabel={deleting ? 'Deleting...' : 'Delete filter'} error={deleteError}
        onConfirm={handleDelete} onOpenChange={next => { if (!next && !deletionGuard.current) setDeleteOpen(false); }}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current} />
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">System</th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filters?.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-slate-500 text-sm">
                  No filters created yet.
                </td>
              </tr>
            ) : (
              filters?.map((filter) => (
                <tr key={filter.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{filter.name}</div>
                  </td>
                  <td className="px-6 py-4">
                    {filter.is_system ? (
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-full font-medium">System</span>
                    ) : (
                      <span className="px-2 py-1 bg-blue-50 text-blue-600 text-xs rounded-full font-medium">Custom</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <TocynButton
                        onClick={event => handleOpenModal(filter, event.currentTarget)}
                        className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                        title="Edit Filter"
                      >
                        <Edit2 className="w-4 h-4" />
                      </TocynButton>
                      {!filter.is_system && (
                        <TocynButton
                          aria-label={`Delete ${filter.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(filter); setDeleteError(''); setDeleteOpen(true); }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Filter"
                        >
                          <Trash2 className="w-4 h-4" />
                        </TocynButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TocynDialog open={isModalOpen} busy={saving} onOpenChange={open => { if (!open) handleCloseModal(); }}
        labelledBy={titleId} initialFocusEl={() => nameInput.current} finalFocusEl={() => opener.current}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 id={titleId} className="text-xl font-bold text-slate-900">
                {editingFilter ? 'Edit Filter' : 'Create Filter'}
              </h2>
              <TocynButton type="button" aria-label="Close filter editor" disabled={saving} onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </TocynButton>
            </div>
            <form onSubmit={handleSubmit} aria-labelledby={titleId} className="p-6">
              {saveError && <p role="alert" className="mb-4 text-red-700">{saveError}</p>}
              <fieldset disabled={saving} className="space-y-6">
              <div>
                <label htmlFor={nameId} className="block text-sm font-medium text-slate-700 mb-1">Filter Name</label>
                <TocynInput id={nameId} ref={nameInput}
                  type="text"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Open Tickets"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="block text-sm font-medium text-slate-700">Conditions</label>
                  <TocynButton
                    type="button"
                    onClick={addCondition}
                    className="text-sm text-brand-600 font-medium flex items-center gap-1 hover:underline"
                  >
                    <Plus className="w-4 h-4" /> Add Condition
                  </TocynButton>
                </div>

                <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                  {formData.conditions.map((cond, idx) => (
                    <div key={idx} className="flex gap-3 items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <TocynSelect
                        className="flex-1 px-3 py-1.5 border border-slate-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                        aria-label={`Condition ${idx + 1} field`} value={cond.field}
                        onChange={e => changeCondition(idx, 'field', e.target.value)}
                      >
                        {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </TocynSelect>
                      <TocynSelect
                        className="w-40 px-3 py-1.5 border border-slate-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                        aria-label={`Condition ${idx + 1} operator`} value={cond.operator}
                        onChange={e => changeCondition(idx, 'operator', e.target.value)}
                      >
                        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </TocynSelect>
                      <TocynInput
                        type="text"
                        className="flex-[2] px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="Value..."
                        aria-label={`Condition ${idx + 1} value`} value={cond.value}
                        onChange={e => changeCondition(idx, 'value', e.target.value)}
                      />
                      <TocynButton
                        type="button"
                        aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)}
                        className="text-slate-400 hover:text-red-500 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </TocynButton>
                    </div>
                  ))}

                  {formData.conditions.length === 0 && (
                    <p className="text-sm text-slate-500 italic bg-slate-50 p-4 rounded-lg border border-dashed border-slate-300 text-center">
                      No conditions. This filter will match all tickets.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <TocynButton
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  Cancel
                </TocynButton>
                <TocynButton
                  type="submit"
                  disabled={saving || createFilter.isPending || updateFilter.isPending}
                  className="px-4 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {editingFilter ? 'Save Changes' : 'Create Filter'}
                </TocynButton>
              </div>
              </fieldset>
            </form>
          </div>
      </TocynDialog>
    </div>
  );
}
