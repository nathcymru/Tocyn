import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkEmptyState, ParkInput, ParkSelect } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import {
  FaPlus,
  FaXmark,
  FaList,
  FaSquareCheck,
  FaAlignLeft,
  FaFont,
  FaToggleOff
} from 'react-icons/fa6';
import { clsx } from 'clsx';
import { useTicketFields } from '../hooks/useTicketFields';

export function TicketFieldsPage() {
  const queryClient = useQueryClient();
  const opener = React.useRef<HTMLButtonElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: fields, isLoading } = useTicketFields();

  const getIconForType = (type: string) => {
    switch (type) {
      case 'text': return <FaFont className="tocyn-ticket-field-type-icon" />;
      case 'textarea': return <FaAlignLeft className="tocyn-ticket-field-type-icon" />;
      case 'select': return <FaList className="tocyn-ticket-field-type-icon" />;
      case 'checkbox': return <FaSquareCheck className="tocyn-ticket-field-type-icon" />;
      default: return <FaFont className="tocyn-ticket-field-type-icon" />;
    }
  };

  return (
    <div className="tocyn-ticket-fields-page">
      <div className="tocyn-ticket-fields-header">
        <div>
          <h1 className="tocyn-ticket-fields-title">Custom Ticket Fields</h1>
          <p className="tocyn-ticket-fields-description">Manage extra attributes for your tickets.</p>
        </div>
        <ParkButton
          onClick={event => { opener.current = event.currentTarget; setIsModalOpen(true); }}
          className="tocyn-ticket-fields-create"
        >
          <FaPlus className="tocyn-ticket-fields-create-icon" />
          Create Field
        </ParkButton>
      </div>

      <div className="tocyn-ticket-fields-table-shell">
        {isLoading ? (
          <ParkEmptyState title="Loading fields..." headingLevel={false} aria-busy="true" className="tocyn-ticket-fields-loading" />
        ) : fields?.length === 0 ? (
          <ParkEmptyState
            title="No custom fields"
            description="Create fields to collect specific information on tickets."
            className="tocyn-ticket-fields-empty"
            action={<ParkButton
              onClick={event => { opener.current = event.currentTarget; setIsModalOpen(true); }}
              className="tocyn-ticket-fields-empty-action"
            >
              Create your first field
            </ParkButton>}
          />
        ) : (
          <table className="tocyn-ticket-fields-table">
            <thead className="tocyn-ticket-fields-table-head">
              <tr>
                <th>Label</th>
                <th>Key Name</th>
                <th>Type</th>
                <th>Options</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="tocyn-ticket-fields-table-body">
              {fields?.map((field) => (
                <tr key={field.id} className="tocyn-ticket-fields-table-row">
                  <td className="tocyn-ticket-field-label">{field.label}</td>
                  <td className="tocyn-ticket-field-name">{field.name}</td>
                  <td>
                    <div className="tocyn-ticket-field-type">
                      {getIconForType(field.field_type)}
                      <span className="capitalize">{field.field_type}</span>
                    </div>
                  </td>
                  <td className="tocyn-ticket-field-options">
                    {field.options || '-'}
                  </td>
                  <td>
                    <span className={clsx(
                      "tocyn-ticket-field-status",
                      field.is_active
                        ? "tocyn-ticket-field-status-active"
                        : "tocyn-ticket-field-status-inactive"
                    )}>
                      {field.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

        <CreateFieldModal open={isModalOpen} finalFocusEl={() => opener.current}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['ticket-fields'] });
          }}
        />
    </div>
  );
}

function CreateFieldModal({ open, finalFocusEl, onClose, onSuccess }: { open: boolean, finalFocusEl: () => HTMLElement | null, onClose: () => void, onSuccess: () => void }) {
  const titleId = React.useId();
  const initialFocus = React.useRef<HTMLInputElement>(null);
  const savingGuard = React.useRef(false);
  const [saveError, setSaveError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    label: '',
    field_type: 'text',
    options: '',
    is_active: true
  });

  const mutation = useMutation({
    mutationFn: (data: any) => dashboardApi.post('/ticket-fields', data),

  });

  React.useEffect(() => {
    if (!open) {
      setFormData({name:'',label:'',field_type:'text',options:'',is_active:true});
      setSaveError('');
    }
  }, [open]);
  const close = () => { if (!savingGuard.current) onClose(); };

  const generateKeyName = (label: string) => {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    setFormData(prev => ({
      ...prev,
      label: newLabel,
      name: !prev.name || prev.name === generateKeyName(prev.label) ? generateKeyName(newLabel) : prev.name
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingGuard.current) return;
    savingGuard.current = true;
    setSaveError('');
    try { await mutation.mutateAsync(formData); onSuccess(); }
    catch { setSaveError('Ticket field could not be created. Your changes have been kept; try again.'); }
    finally { savingGuard.current = false; }
  };

  return (
    <TocynDialog open={open} busy={mutation.isPending} onOpenChange={next => { if (!next) close(); }}
      labelledBy={titleId} initialFocusEl={() => initialFocus.current} finalFocusEl={finalFocusEl}>
      <div className="tocyn-ticket-field-dialog">
        <div className="tocyn-ticket-field-dialog-header">
          <h2 id={titleId} className="tocyn-ticket-field-dialog-title">Create Ticket Field</h2>
          <ParkButton type="button" aria-label="Close ticket field editor" disabled={mutation.isPending} onClick={close} className="tocyn-ticket-field-dialog-close">
            <FaXmark className="tocyn-ticket-field-dialog-close-icon" />
          </ParkButton>
        </div>

        <form onSubmit={handleSubmit} aria-labelledby={titleId} className="tocyn-ticket-field-dialog-form">
          {saveError && <p role="alert" className="tocyn-ticket-field-dialog-error">{saveError}</p>}
          <fieldset disabled={mutation.isPending} className="tocyn-ticket-field-dialog-fields">
          <div>
            <label htmlFor={`${titleId}-label`} className="tocyn-ticket-field-dialog-label">Display Label</label>
            <ParkInput
              required
              type="text"
              id={`${titleId}-label`} ref={initialFocus} value={formData.label}
              onChange={handleLabelChange}
              placeholder="e.g., Device Model"
              className="tocyn-form-control tocyn-ticket-field-dialog-control"
            />
          </div>

          <div>
            <label htmlFor={`${titleId}-name`} className="tocyn-ticket-field-dialog-label">Key Name</label>
            <ParkInput
              required
              type="text"
              id={`${titleId}-name`} value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., device_model"
              className="tocyn-form-control tocyn-ticket-field-dialog-control tocyn-ticket-field-dialog-control--mono"
            />
            <p className="tocyn-ticket-field-dialog-help">The JSON key used internally and via API.</p>
          </div>

          <div>
            <label htmlFor={`${titleId}-type`} className="tocyn-ticket-field-dialog-label">Field Type</label>
            <ParkSelect
              id={`${titleId}-type`} value={formData.field_type}
              onChange={(e) => setFormData({ ...formData, field_type: e.target.value })}
              className="tocyn-form-control tocyn-ticket-field-dialog-control"
            >
              <option value="text">Text (Single line)</option>
              <option value="textarea">Textarea (Multi-line)</option>
              <option value="select">Dropdown (Select)</option>
              <option value="checkbox">Checkbox</option>
            </ParkSelect>
          </div>

          {formData.field_type === 'select' && (
            <div className="tocyn-ticket-field-options-reveal">
              <label htmlFor={`${titleId}-options`} className="tocyn-ticket-field-dialog-label">Options</label>
              <ParkInput
                required
                type="text"
                id={`${titleId}-options`} value={formData.options}
                onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                placeholder="Comma-separated (e.g. Option 1, Option 2)"
                className="tocyn-form-control tocyn-ticket-field-dialog-control"
              />
            </div>
          )}

          <label className="tocyn-ticket-field-dialog-checkbox">
            <ParkInput type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData,is_active:e.target.checked})} />
            Active
          </label>

          <div className="tocyn-ticket-field-dialog-actions">
            <ParkButton
              type="button"
              onClick={close}
              className="tocyn-ticket-field-dialog-cancel"
            >
              Cancel
            </ParkButton>
            <ParkButton
              type="submit"
              disabled={mutation.isPending}
              className="tocyn-ticket-field-dialog-submit"
            >
              {mutation.isPending ? 'Creating...' : 'Create Field'}
            </ParkButton>
          </div>
          </fieldset>
        </form>
      </div>
    </TocynDialog>
  );
}
