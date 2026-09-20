import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { TocynDialog, TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkEmptyState, ParkInput, ParkTable } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useFilters, useCreateFilter, useUpdateFilter, useDeleteFilter } from '../hooks/useFilters';
import {
  IconPlus,
  IconPenToSquare,
  IconTrash,
  IconXmark
} from '@luminatick/ui/icons';
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
    return <ParkEmptyState role="status" className={css({"py":"6"})} title="Loading filters..." headingLevel={false} />;
  }

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={heading} tabIndex={-1} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Custom Filters</h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Create and manage ticket filters for your team.</p>
        </div>
        <ParkButton
          onClick={event => handleOpenModal(undefined, event.currentTarget)}
          className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
        >
          <IconPlus className={css({"w":"4","h":"4","flexShrink":0})} />
          Create Filter
        </ParkButton>
      </div>

      {deleteStatus && <p role="status">{deleteStatus}</p>}
      <TocynConfirmDialog open={deleteOpen} busy={deleting} title={`Delete filter: ${deletion?.name ?? ''}`}
        description="Delete this filter? This action cannot be undone." confirmLabel={deleting ? 'Deleting...' : 'Delete filter'} error={deleteError}
        onConfirm={handleDelete} onOpenChange={next => { if (!next && !deletionGuard.current) setDeleteOpen(false); }}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current} />
      <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4","overflowX":"auto"})}>
        <ParkTable.Root className={css({"w":"full","borderCollapse":"collapse"})}>
          <ParkTable.Head>
            <ParkTable.Row className={css({"borderBottomWidth":"1px","borderColor":"border.default"})}>
              <ParkTable.Header className={css({"p":"3","textAlign":"left","verticalAlign":"top","fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Name</ParkTable.Header>
              <ParkTable.Header className={css({"p":"3","textAlign":"left","verticalAlign":"top","fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>System</ParkTable.Header>
              <ParkTable.Header className={css({"p":"3","textAlign":"right","verticalAlign":"top","fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>Actions</ParkTable.Header>
            </ParkTable.Row>
          </ParkTable.Head>
          <ParkTable.Body className={css({"minW":0})}>
            {filters?.length === 0 ? (
              <ParkTable.Row>
                <ParkTable.Cell colSpan={3} className={css({"py":"6"})}>
                  <ParkEmptyState title="No filters created yet." description="Create a filter to save a view for your team."
                    headingLevel={false} action={<ParkButton type="button" onClick={event => handleOpenModal(undefined, event.currentTarget)}>Create filter</ParkButton>} />
                </ParkTable.Cell>
              </ParkTable.Row>
            ) : (
              filters?.map((filter) => (
                <ParkTable.Row key={filter.id} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","borderBottomWidth":"1px","borderColor":"border.default"})}>
                  <ParkTable.Cell className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>
                    <div className={css({"fontWeight":"medium","color":"text.default"})}>{filter.name}</div>
                  </ParkTable.Cell>
                  <ParkTable.Cell className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>
                    {filter.is_system ? (
                      <span className={css({"display":"inline-flex","alignItems":"center","rounded":"full","px":"2","py":"0.5","fontSize":"xs","fontWeight":"medium","bg":"bg.muted","minW":0})}>System</span>
                    ) : (
                      <span className={css({"display":"inline-flex","alignItems":"center","rounded":"full","px":"2","py":"0.5","fontSize":"xs","fontWeight":"medium","bg":"bg.muted","minW":0})}>Custom</span>
                    )}
                  </ParkTable.Cell>
                  <ParkTable.Cell className={css({"p":"3","textAlign":"left","verticalAlign":"top"})}>
                    <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                      <ParkButton
                        onClick={event => handleOpenModal(filter, event.currentTarget)}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                        title="Edit Filter"
                      >
                        <IconPenToSquare className={css({"w":"4","h":"4","flexShrink":0})} />
                      </ParkButton>
                      {!filter.is_system && (
                        <ParkButton
                          aria-label={`Delete ${filter.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(filter); setDeleteError(''); setDeleteOpen(true); }}
                          className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                          title="Delete Filter"
                        >
                          <IconTrash className={css({"w":"4","h":"4","flexShrink":0})} />
                        </ParkButton>
                      )}
                    </div>
                  </ParkTable.Cell>
                </ParkTable.Row>
              ))
            )}
          </ParkTable.Body>
        </ParkTable.Root>
      </div>

      <TocynDialog open={isModalOpen} busy={saving} onOpenChange={open => { if (!open) handleCloseModal(); }}
        labelledBy={titleId} initialFocusEl={() => nameInput.current} finalFocusEl={() => opener.current}>
          <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <h2 id={titleId} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
                {editingFilter ? 'Edit Filter' : 'Create Filter'}
              </h2>
              <ParkButton type="button" aria-label="Close filter editor" disabled={saving} onClick={handleCloseModal} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
                <IconXmark className={css({"w":"4","h":"4","flexShrink":0})} />
              </ParkButton>
            </div>
            <form onSubmit={handleSubmit} aria-labelledby={titleId} className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>
              {saveError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>{saveError}</p>}
              <fieldset disabled={saving} className={css({"display":"grid","gap":"4"})}>
              <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                <label htmlFor={nameId}>Filter Name</label>
                <ParkInput id={nameId} ref={nameInput}
                  type="text"
                  required
                  className={css({"w":"full"})}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Open Tickets"
                />
              </div>

              <div>
                <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                  <label className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>Conditions</label>
                  <ParkButton
                    type="button"
                    onClick={addCondition}
                    className={css({"minW":0})}
                  >
                    <IconPlus className={css({"w":"4","h":"4","flexShrink":0})} /> Add Condition
                  </ParkButton>
                </div>

                <div className={css({"display":"grid","gap":"4"})}>
                  {formData.conditions.map((cond, idx) => (
                    <div key={idx} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                      <DashboardSelect aria-label={`Condition ${idx + 1} field`} value={cond.field} onValueChange={value => changeCondition(idx, 'field', value)} options={FIELDS} />
                      <DashboardSelect aria-label={`Condition ${idx + 1} operator`} value={cond.operator} onValueChange={value => changeCondition(idx, 'operator', value)} options={OPERATORS} />
                      <ParkInput
                        type="text"
                        className={css({"minW":0})}
                        placeholder="Value..."
                        aria-label={`Condition ${idx + 1} value`} value={cond.value}
                        onChange={e => changeCondition(idx, 'value', e.target.value)}
                      />
                      <ParkButton
                        type="button"
                        aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)}
                        className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                      >
                        <IconTrash className={css({"w":"4","h":"4","flexShrink":0})} />
                      </ParkButton>
                    </div>
                  ))}

                  {formData.conditions.length === 0 && (
                    <p className={css({"minW":0})}>
                      No conditions. This filter will match all tickets.
                    </p>
                  )}
                </div>
              </div>

              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                <ParkButton
                  type="button"
                  onClick={handleCloseModal}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                >
                  Cancel
                </ParkButton>
                <ParkButton
                  type="submit"
                  disabled={saving || createFilter.isPending || updateFilter.isPending}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
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
