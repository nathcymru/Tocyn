import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkEmptyState, ParkInput, ParkSelect, ParkTicketFields } from '@luminatick/ui/park';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import {
  IconPlus,
  IconXmark,
  IconList,
  IconSquareCheck,
  IconAlignLeft,
  IconFont,
  IconToggleOff
} from '@luminatick/ui/icons';
import { useTicketFields } from '../hooks/useTicketFields';

export function TicketFieldsPage() {
  const styles = ParkTicketFields();
  const queryClient = useQueryClient();
  const opener = React.useRef<HTMLButtonElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: fields, isLoading } = useTicketFields();

  const getIconForType = (type: string) => {
    switch (type) {
      case 'text': return <IconFont aria-hidden="true" />;
      case 'textarea': return <IconAlignLeft aria-hidden="true" />;
      case 'select': return <IconList aria-hidden="true" />;
      case 'checkbox': return <IconSquareCheck aria-hidden="true" />;
      default: return <IconFont aria-hidden="true" />;
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Custom Ticket Fields</h1>
          <p className={styles.description}>Manage extra attributes for your tickets.</p>
        </div>
        <ParkButton
          onClick={event => { opener.current = event.currentTarget; setIsModalOpen(true); }}
          className={styles.create}
        >
          <IconPlus aria-hidden="true" className={styles.createIcon} />
          Create Field
        </ParkButton>
      </div>

      <div className={styles.tableShell}>
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
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr className={styles.tableRow}>
                <th>Label</th>
                <th>Key Name</th>
                <th>Type</th>
                <th>Options</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {fields?.map((field) => (
                <tr key={field.id} className={styles.tableRow}>
                  <td>{field.label}</td>
                  <td>{field.name}</td>
                  <td>
                    <div className={styles.fieldType}>
                      {getIconForType(field.field_type)}
                      <span className="capitalize">{field.field_type}</span>
                    </div>
                  </td>
                  <td>
                    {field.options || '-'}
                  </td>
                  <td>
                    <span className={[styles.fieldStatus, field.is_active ? styles.fieldStatusActive : styles.fieldStatusInactive].join(' ')}>
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
  const styles = ParkTicketFields();
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
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <h2 id={titleId} className={styles.dialogTitle}>Create Ticket Field</h2>
          <ParkButton type="button" aria-label="Close ticket field editor" disabled={mutation.isPending} onClick={close} className={styles.dialogClose}>
            <IconXmark aria-hidden="true" className={styles.dialogCloseIcon} />
          </ParkButton>
        </div>

        <form onSubmit={handleSubmit} aria-labelledby={titleId} className={styles.dialogForm}>
          {saveError && <p role="alert" className={styles.dialogError}>{saveError}</p>}
          <fieldset disabled={mutation.isPending} className={styles.dialogFields}>
          <div>
            <label htmlFor={`${titleId}-label`} className={styles.dialogLabel}>Display Label</label>
            <ParkInput
              required
              type="text"
              id={`${titleId}-label`} ref={initialFocus} value={formData.label}
              onChange={handleLabelChange}
              placeholder="e.g., Device Model"
              className={styles.dialogControl}
            />
          </div>

          <div>
            <label htmlFor={`${titleId}-name`} className={styles.dialogLabel}>Key Name</label>
            <ParkInput
              required
              type="text"
              id={`${titleId}-name`} value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., device_model"
              className={styles.dialogControl}
            />
            <p className={styles.dialogHelp}>The JSON key used internally and via API.</p>
          </div>

          <div>
            <label htmlFor={`${titleId}-type`} className={styles.dialogLabel}>Field Type</label>
            <ParkSelect
              id={`${titleId}-type`} value={formData.field_type}
              onChange={(e) => setFormData({ ...formData, field_type: e.target.value })}
              className={styles.dialogControl}
            >
              <option value="text">Text (Single line)</option>
              <option value="textarea">Textarea (Multi-line)</option>
              <option value="select">Dropdown (Select)</option>
              <option value="checkbox">Checkbox</option>
            </ParkSelect>
          </div>

          {formData.field_type === 'select' && (
            <div className={styles.optionsReveal}>
              <label htmlFor={`${titleId}-options`} className={styles.dialogLabel}>Options</label>
              <ParkInput
                required
                type="text"
                id={`${titleId}-options`} value={formData.options}
                onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                placeholder="Comma-separated (e.g. Option 1, Option 2)"
                className={styles.dialogControl}
              />
            </div>
          )}

          <label className={styles.checkbox}>
            <ParkInput type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData,is_active:e.target.checked})} />
            Active
          </label>

          <div className={styles.dialogActions}>
            <ParkButton
              type="button"
              onClick={close}
              className={styles.dialogCancel}
            >
              Cancel
            </ParkButton>
            <ParkButton
              type="submit"
              disabled={mutation.isPending}
              className={styles.dialogSubmit}
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
