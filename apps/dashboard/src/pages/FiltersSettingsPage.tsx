import { TocynDialog, TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkEmptyState, ParkInput, ParkSelect } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useFilters, useCreateFilter, useUpdateFilter, useDeleteFilter } from '../hooks/useFilters';
import {
  FaPlus,
  FaPenToSquare,
  FaTrash,
  FaXmark
} from 'react-icons/fa6';
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
    return <ParkEmptyState role="status" className="tocyn-filters-loading" title="Loading filters..." headingLevel={false} />;
  }

  return (
    <div className="tocyn-filters-page">
      <div className="tocyn-filters-header">
        <div>
          <h1 ref={heading} tabIndex={-1} className="tocyn-filters-title">Custom Filters</h1>
          <p className="tocyn-filters-description">Create and manage ticket filters for your team.</p>
        </div>
        <ParkButton
          onClick={event => handleOpenModal(undefined, event.currentTarget)}
          className="tocyn-filters-create"
        >
          <FaPlus className="tocyn-filters-create-icon" />
          Create Filter
        </ParkButton>
      </div>

      {deleteStatus && <p role="status">{deleteStatus}</p>}
      <TocynConfirmDialog open={deleteOpen} busy={deleting} title={`Delete filter: ${deletion?.name ?? ''}`}
        description="Delete this filter? This action cannot be undone." confirmLabel={deleting ? 'Deleting...' : 'Delete filter'} error={deleteError}
        onConfirm={handleDelete} onOpenChange={next => { if (!next && !deletionGuard.current) setDeleteOpen(false); }}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current} />
      <div className="tocyn-filters-table-shell">
        <table className="tocyn-filters-table">
          <thead>
            <tr className="tocyn-filters-table-head">
              <th className="tocyn-filters-table-heading">Name</th>
              <th className="tocyn-filters-table-heading">System</th>
              <th className="tocyn-filters-table-heading tocyn-filters-table-heading-actions">Actions</th>
            </tr>
          </thead>
          <tbody className="tocyn-filters-table-body">
            {filters?.length === 0 ? (
              <tr>
                <td colSpan={3} className="tocyn-filters-empty">
                  No filters created yet.
                </td>
              </tr>
            ) : (
              filters?.map((filter) => (
                <tr key={filter.id} className="tocyn-filters-table-row">
                  <td className="tocyn-filters-table-cell">
                    <div className="tocyn-filters-name">{filter.name}</div>
                  </td>
                  <td className="tocyn-filters-table-cell">
                    {filter.is_system ? (
                      <span className="tocyn-filter-kind tocyn-filter-kind-system">System</span>
                    ) : (
                      <span className="tocyn-filter-kind tocyn-filter-kind-custom">Custom</span>
                    )}
                  </td>
                  <td className="tocyn-filters-table-actions-cell">
                    <div className="tocyn-filters-table-actions">
                      <ParkButton
                        onClick={event => handleOpenModal(filter, event.currentTarget)}
                        className="tocyn-filter-action tocyn-filter-action-edit"
                        title="Edit Filter"
                      >
                        <FaPenToSquare className="tocyn-filter-action-icon" />
                      </ParkButton>
                      {!filter.is_system && (
                        <ParkButton
                          aria-label={`Delete ${filter.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(filter); setDeleteError(''); setDeleteOpen(true); }}
                          className="tocyn-filter-action tocyn-filter-action-delete"
                          title="Delete Filter"
                        >
                          <FaTrash className="tocyn-filter-action-icon" />
                        </ParkButton>
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
          <div className="tocyn-filter-dialog">
            <div className="tocyn-filter-dialog-header">
              <h2 id={titleId} className="tocyn-filter-dialog-title">
                {editingFilter ? 'Edit Filter' : 'Create Filter'}
              </h2>
              <ParkButton type="button" aria-label="Close filter editor" disabled={saving} onClick={handleCloseModal} className="tocyn-filter-dialog-close">
                <FaXmark className="tocyn-filter-dialog-close-icon" />
              </ParkButton>
            </div>
            <form onSubmit={handleSubmit} aria-labelledby={titleId} className="tocyn-filter-dialog-form">
              {saveError && <p role="alert" className="tocyn-filter-dialog-error">{saveError}</p>}
              <fieldset disabled={saving} className="tocyn-filter-dialog-fields">
              <div className="tocyn-form-field">
                <label htmlFor={nameId}>Filter Name</label>
                <ParkInput id={nameId} ref={nameInput}
                  type="text"
                  required
                  className="tocyn-filter-name-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Open Tickets"
                />
              </div>

              <div>
                <div className="tocyn-filter-conditions-header">
                  <label className="tocyn-filter-conditions-label">Conditions</label>
                  <ParkButton
                    type="button"
                    onClick={addCondition}
                    className="tocyn-filter-add-condition"
                  >
                    <FaPlus className="tocyn-filter-action-icon" /> Add Condition
                  </ParkButton>
                </div>

                <div className="tocyn-filter-condition-list">
                  {formData.conditions.map((cond, idx) => (
                    <div key={idx} className="tocyn-filter-condition-row">
                      <ParkSelect
                        className="tocyn-filter-condition-field"
                        aria-label={`Condition ${idx + 1} field`} value={cond.field}
                        onChange={e => changeCondition(idx, 'field', e.target.value)}
                      >
                        {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </ParkSelect>
                      <ParkSelect
                        className="tocyn-filter-condition-operator"
                        aria-label={`Condition ${idx + 1} operator`} value={cond.operator}
                        onChange={e => changeCondition(idx, 'operator', e.target.value)}
                      >
                        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </ParkSelect>
                      <ParkInput
                        type="text"
                        className="tocyn-filter-condition-value"
                        placeholder="Value..."
                        aria-label={`Condition ${idx + 1} value`} value={cond.value}
                        onChange={e => changeCondition(idx, 'value', e.target.value)}
                      />
                      <ParkButton
                        type="button"
                        aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)}
                        className="tocyn-filter-condition-remove"
                      >
                        <FaTrash className="tocyn-filter-action-icon" />
                      </ParkButton>
                    </div>
                  ))}

                  {formData.conditions.length === 0 && (
                    <p className="tocyn-filter-no-conditions">
                      No conditions. This filter will match all tickets.
                    </p>
                  )}
                </div>
              </div>

              <div className="tocyn-filter-dialog-actions">
                <ParkButton
                  type="button"
                  onClick={handleCloseModal}
                  className="tocyn-filter-dialog-cancel"
                >
                  Cancel
                </ParkButton>
                <ParkButton
                  type="submit"
                  disabled={saving || createFilter.isPending || updateFilter.isPending}
                  className="tocyn-filter-dialog-submit"
                >
                  {editingFilter ? 'Save Changes' : 'Create Filter'}
                </ParkButton>
              </div>
              </fieldset>
            </form>
          </div>
      </TocynDialog>
    </div>
  );
}
