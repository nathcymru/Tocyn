import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { ParkAlert, ParkButton, ParkCard, ParkCheckbox, ParkDialog, ParkEmptyState, ParkInput, ParkSkeleton, ParkTable } from '@luminatick/ui/park';
import { Badge, Field, IconButton as ParkIconButton } from '@luminatick/ui/components';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import {
  IconPlus,
  IconXmark,
  IconList,
  IconSquareCheck,
  IconAlignLeft,
  IconFont
} from '@luminatick/ui/icons';
import { useTicketFields } from '../hooks/useTicketFields';

export function TicketFieldsPage() {
  const queryClient = useQueryClient();
  const opener = React.useRef<HTMLButtonElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: fields, isLoading, isError, refetch } = useTicketFields();

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
    <div className={css({ display: 'grid', gap: '6', maxW: '6xl', mx: 'auto', px: { base: '4', md: '6' }, py: '6' })}>
      <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3', flexWrap: 'wrap' })}>
        <div>
          <h1 className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Custom Ticket Fields</h1>
          <p className={css({ color: 'fg.muted', textStyle: 'sm' })}>Manage extra attributes for your tickets.</p>
        </div>
        <ParkButton type="button"
          onClick={event => { opener.current = event.currentTarget; setIsModalOpen(true); }}
        >
          <IconPlus aria-hidden="true" className={css({ w: '4', h: '4' })} />
          Create Field
        </ParkButton>
      </div>

      {isError && fields !== undefined && <ParkAlert.Root role="alert" status="warning" variant="surface">
        <ParkAlert.Content>
          <ParkAlert.Title>Ticket fields could not be refreshed</ParkAlert.Title>
          <ParkAlert.Description>The last confirmed field definitions remain visible. Retry before relying on changes.</ParkAlert.Description>
          <ParkButton type="button" onClick={() => void refetch()}>Retry ticket fields</ParkButton>
        </ParkAlert.Content>
      </ParkAlert.Root>}
      <ParkCard.Root variant="outline"><ParkCard.Body className={css({ overflowX: 'auto' })}>
        {isLoading ? (
          <section role="status" aria-label="Loading ticket fields" aria-busy="true" className={css({ display: 'grid', gap: '3' })}><span className={css({ srOnly: true })}>Loading fields...</span><ParkSkeleton aria-hidden="true" className={css({ h: '12', w: 'full' })} /><ParkSkeleton aria-hidden="true" className={css({ h: '12', w: 'full' })} /></section>
        ) : isError && fields === undefined ? (
          <ParkEmptyState role="alert" title="Ticket fields could not be loaded" description="Retry before managing field definitions." action={<ParkButton type="button" onClick={() => void refetch()}>Retry ticket fields</ParkButton>} />
        ) : fields?.length === 0 ? (
          <ParkEmptyState
            title="No custom fields"
            description="Create fields to collect specific information on tickets."
            className={css({"py":"6"})}
            action={<ParkButton type="button"
              onClick={event => { opener.current = event.currentTarget; setIsModalOpen(true); }}
              className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
            >
              Create your first field
            </ParkButton>}
          />
        ) : (
          <ParkTable.Root className={css({ w: 'full', fontFamily: 'tabular' })}>
            <ParkTable.Head>
              <ParkTable.Row>
                <ParkTable.Header>Label</ParkTable.Header>
                <ParkTable.Header>Key Name</ParkTable.Header>
                <ParkTable.Header>Type</ParkTable.Header>
                <ParkTable.Header>Options</ParkTable.Header>
                <ParkTable.Header>Status</ParkTable.Header>
              </ParkTable.Row>
            </ParkTable.Head>
            <ParkTable.Body>
              {fields?.map((field) => (
                <ParkTable.Row key={field.id}>
                  <ParkTable.Cell>{field.label}</ParkTable.Cell>
                  <ParkTable.Cell>{field.name}</ParkTable.Cell>
                  <ParkTable.Cell>
                    <div className={css({ display: 'inline-flex', alignItems: 'center', gap: '2' })}>
                      {getIconForType(field.field_type)}
                      <span className={css({ textTransform: 'capitalize' })}>{field.field_type}</span>
                    </div>
                  </ParkTable.Cell>
                  <ParkTable.Cell>
                    {field.options || '-'}
                  </ParkTable.Cell>
                  <ParkTable.Cell>
                    <Badge colorPalette={field.is_active ? 'green' : 'gray'}>
                      {field.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </ParkTable.Cell>
                </ParkTable.Row>
              ))}
            </ParkTable.Body>
          </ParkTable.Root>
        )}
      </ParkCard.Body></ParkCard.Root>

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
  const formId = `${titleId}-form`;
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
    <ParkDialog.Root open={open} onOpenChange={({ open: next }) => { if (!next && !mutation.isPending) close(); }}
      initialFocusEl={() => initialFocus.current} finalFocusEl={finalFocusEl}
      closeOnEscape={!mutation.isPending} closeOnInteractOutside={false} lazyMount unmountOnExit>
      <ParkDialog.Backdrop />
      <ParkDialog.Positioner>
        <ParkDialog.Content aria-labelledby={titleId}>
        <ParkDialog.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
          <ParkDialog.Title id={titleId}>Create Ticket Field</ParkDialog.Title>
          <ParkIconButton type="button" variant="plain" aria-label="Close ticket field editor" disabled={mutation.isPending} onClick={close}>
            <IconXmark aria-hidden="true" className={css({ w: '4', h: '4' })} />
          </ParkIconButton>
        </ParkDialog.Header>

        <ParkDialog.Body><form id={formId} onSubmit={handleSubmit} aria-labelledby={titleId} className={css({ display: 'grid', gap: '4' })}>
          {saveError && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{saveError}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
          <fieldset disabled={mutation.isPending} className={css({ display: 'grid', gap: '4' })}>
          <Field.Root required>
            <Field.Label htmlFor={`${titleId}-label`}>Display Label</Field.Label>
            <ParkInput
              required
              type="text"
              id={`${titleId}-label`} ref={initialFocus} value={formData.label}
              onChange={handleLabelChange}
              placeholder="e.g., Device Model"
              className={css({ w: 'full' })}
            />
          </Field.Root>

          <Field.Root required>
            <Field.Label htmlFor={`${titleId}-name`}>Key Name</Field.Label>
            <ParkInput
              required
              type="text"
              id={`${titleId}-name`} aria-describedby={`${titleId}-name-help`} value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., device_model"
              className={css({ w: 'full' })}
            />
            <Field.HelperText id={`${titleId}-name-help`}>The JSON key used internally and via API.</Field.HelperText>
          </Field.Root>

          <DashboardSelect id={`${titleId}-type`} label="Field Type" value={formData.field_type} onValueChange={value => setFormData({ ...formData, field_type: value })} options={[{ value: 'text', label: 'Text (Single line)' }, { value: 'textarea', label: 'Textarea (Multi-line)' }, { value: 'select', label: 'Dropdown (Select)' }, { value: 'checkbox', label: 'Checkbox' }]} />

          {formData.field_type === 'select' && (
            <Field.Root required>
              <Field.Label htmlFor={`${titleId}-options`}>Options</Field.Label>
              <ParkInput
                required
                type="text"
                id={`${titleId}-options`} value={formData.options}
                onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                placeholder="Comma-separated (e.g. Option 1, Option 2)"
                className={css({ w: 'full' })}
              />
            </Field.Root>
          )}

          <ParkCheckbox.Root checked={formData.is_active} onCheckedChange={({ checked }) => setFormData({ ...formData, is_active: checked === true })}>
            <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
            <ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Active</ParkCheckbox.Label>
          </ParkCheckbox.Root>

          </fieldset>
        </form></ParkDialog.Body>
        <ParkDialog.Footer>
          <ParkButton type="button" variant="outline" disabled={mutation.isPending} onClick={close}>Cancel</ParkButton>
          <ParkButton type="submit" form={formId} loading={mutation.isPending} loadingText="Creating field…">Create Field</ParkButton>
        </ParkDialog.Footer>
        </ParkDialog.Content>
      </ParkDialog.Positioner>
    </ParkDialog.Root>
  );
}
