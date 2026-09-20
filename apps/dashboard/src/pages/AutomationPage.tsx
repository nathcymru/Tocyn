import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { ParkAlert, ParkButton, ParkCard, ParkCheckbox, ParkDialog, ParkEmptyState, ParkInput, ParkSkeleton } from '@luminatick/ui/park';
import { Badge, Field as ParkField } from '@luminatick/ui/components';
import React, { useEffect, useState } from 'react';
import { dashboardApi } from '../api/client';
import { AutomationRule, AutomationCondition, WebhookConfig, RetentionConfig } from '../types';
import {
  IconPlus,
  IconTrash,
  IconToggleOff,
  IconToggleOn,
  IconPenToSquare,
  IconFloppyDisk,
  IconXmark
} from '@luminatick/ui/icons';

const EVENT_TYPES = [
  { value: 'ticket.created', label: 'Ticket Created' },
  { value: 'article.created', label: 'Article Created' },
  { value: 'ticket.updated', label: 'Ticket Updated' },
  { value: 'scheduled.retention', label: 'Scheduled Retention' },
];

const ACTION_TYPES = [
  { value: 'webhook', label: 'Webhook' },
  { value: 'retention', label: 'Retention Cleanup' },
];

const FIELDS = [
  { value: 'ticket.subject', label: 'Ticket Subject' },
  { value: 'ticket.status', label: 'Ticket Status' },
  { value: 'ticket.priority', label: 'Ticket Priority' },
  { value: 'ticket.customer_email', label: 'Customer Email' },
  { value: 'article.body', label: 'Article Body' },
  { value: 'article.sender_type', label: 'Sender Type' },
];

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Does Not Equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'regex', label: 'Matches Regex' },
];

function conditionCount(value: string | null | undefined) {
  try { const parsed: unknown = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.length : 0; }
  catch { return 0; }
}

export const AutomationPage: React.FC = () => {
  const heading = React.useRef<HTMLHeadingElement>(null);
  const deleteOpener = React.useRef<HTMLButtonElement | null>(null);
  const deleteCancel = React.useRef<HTMLButtonElement | null>(null);
  const deleteTitleId = React.useId();
  const deleteDescriptionId = React.useId();
  const deleteGuard = React.useRef(false);
  const deleteSucceeded = React.useRef(false);
  const [deletion, setDeletion] = useState<AutomationRule | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<AutomationRule>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      setLoading(true);
      const data = await dashboardApi.get<AutomationRule[]>('/automations');
      setRules(data);
      setLoadError(false);
    } catch (error) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id: string, currentStatus: boolean) => {
    try {
      await dashboardApi.patch(`/automations/${id}`, { is_active: !currentStatus });
      setRules(rules.map(r => r.id === id ? { ...r, is_active: !currentStatus } : r));
      showSuccess('Rule updated');
    } catch (error) {
      setError('Failed to toggle rule');
    }
  };

  const handleDelete = async () => {
    if (!deletion || deleteGuard.current) return;
    deleteGuard.current = true; setDeleting(true); setDeleteError('');
    try {
      await dashboardApi.delete(`/automations/${deletion.id}`);
      setRules(current => current.filter(rule => rule.id !== deletion.id));
      deleteSucceeded.current = true; setDeleteOpen(false);
      showSuccess('Rule deleted');
    } catch { setDeleteError('Rule could not be deleted. Try again.'); }
    finally { deleteGuard.current = false; setDeleting(false); }
  };

  const startCreate = () => {
    setIsEditing('new');
    setEditForm({
      name: '',
      event_type: 'ticket.created',
      action_type: 'webhook',
      conditions: '[]',
      action_config: JSON.stringify({ url: '', method: 'POST', headers: {} }),
      is_active: true
    });
  };

  const startEdit = (rule: AutomationRule) => {
    setIsEditing(rule.id);
    setEditForm(rule);
  };

  const handleSave = async () => {
    setError(null);
    try {
      // Validate JSON fields if they were edited manually (though we'll use a builder)
      try {
        if (editForm.conditions) JSON.parse(editForm.conditions);
        if (editForm.action_config) JSON.parse(editForm.action_config);
      } catch (e) {
        setError('Invalid JSON in conditions or action config');
        return;
      }

      if (isEditing === 'new') {
        const newRule = await dashboardApi.post<AutomationRule>('/automations', editForm);
        setRules([newRule, ...rules]);
      } else {
        const updatedRule = await dashboardApi.patch<AutomationRule>(`/automations/${isEditing}`, editForm);
        setRules(rules.map(r => r.id === isEditing ? updatedRule : r));
      }
      setIsEditing(null);
      showSuccess('Rule saved successfully');
    } catch (error) {
      setError('Failed to save rule');
    }
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const updateConditions = (conditions: AutomationCondition[]) => {
    setEditForm({ ...editForm, conditions: JSON.stringify(conditions) });
  };

  const addCondition = () => {
    const current = JSON.parse(editForm.conditions || '[]');
    updateConditions([...current, { field: 'ticket.subject', operator: 'contains', value: '' }]);
  };

  const removeCondition = (index: number) => {
    const current = JSON.parse(editForm.conditions || '[]');
    updateConditions(current.filter((_: any, i: number) => i !== index));
  };

  const changeCondition = (index: number, field: keyof AutomationCondition, value: string) => {
    const current = JSON.parse(editForm.conditions || '[]');
    current[index][field] = value;
    updateConditions(current);
  };

  const getActionConfig = (): any => {
    try {
      return JSON.parse(editForm.action_config || '{}');
    } catch {
      return {};
    }
  };

  const updateActionConfig = (config: any) => {
    setEditForm({ ...editForm, action_config: JSON.stringify(config) });
  };

  if (loading && rules.length === 0 && !loadError) return <section role="status" aria-label="Loading automations" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', p: '6' })}><span className={css({ srOnly: true })}>Loading automations…</span><ParkSkeleton aria-hidden="true" className={css({ h: '8', w: '48' })} /><ParkSkeleton aria-hidden="true" className={css({ h: '32', w: 'full' })} /></section>;

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={heading} tabIndex={-1} className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Automation Rules</h1>
          <p className={css({ color: 'fg.muted', textStyle: 'sm', lineHeight: 'relaxed' })}>Manage event-driven workflows and data retention.</p>
        </div>
        {!isEditing && <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
          {rules.length > 0 && <ParkButton type="button" variant="outline" loading={loading} loadingText="Refreshing automations…" onClick={() => void fetchRules()}>Refresh automations</ParkButton>}
          <ParkButton type="button"
            onClick={startCreate}
            variant="solid" className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            <IconPlus aria-hidden="true" size={20} />
            Create Rule
          </ParkButton>
        </div>}
      </div>

      {error && <ParkAlert.Root role="alert" status="error"><ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}

      {success && <ParkAlert.Root role="status" status="success"><ParkAlert.Content><ParkAlert.Description>{success}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
      {loadError && rules.length > 0 && <ParkAlert.Root role="alert" status="error">
        <ParkAlert.Content>
          <ParkAlert.Title>Automation rules could not be refreshed</ParkAlert.Title>
          <ParkAlert.Description>These rules are the last loaded version and may have changed. Retry before relying on the list.</ParkAlert.Description>
          <ParkButton type="button" variant="outline" loading={loading} loadingText="Retrying automations…" onClick={() => void fetchRules()}>Retry automations refresh</ParkButton>
        </ParkAlert.Content>
      </ParkAlert.Root>}

      <div className={css({"minW":0})}>
        {isEditing && (
          <ParkCard.Root variant="outline">
            <ParkCard.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
              <ParkCard.Title asChild><h2>
                {isEditing === 'new' ? 'Create New Automation Rule' : 'Edit Automation Rule'}
              </h2></ParkCard.Title>
              <ParkButton type="button" variant="plain" aria-label="Close automation editor" onClick={() => setIsEditing(null)}>
                <IconXmark aria-hidden="true" size={24} />
              </ParkButton>
            </ParkCard.Header>

            <ParkCard.Body className={css({ display: 'grid', gap: '5' })}>
            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({"minW":0})}>
                <ParkField.Root className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <ParkField.Label htmlFor="automation-rule-name">Rule Name</ParkField.Label>
                  <ParkInput
                    id="automation-rule-name"
                    type="text"
                    className={css({"w":"full"})}
                    placeholder="e.g., Slack Notification for Urgent Tickets"
                    value={editForm.name || ''}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </ParkField.Root>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <DashboardSelect id="automation-trigger" label="Trigger Event" value={editForm.event_type ?? ''} onValueChange={value => setEditForm({ ...editForm, event_type: value as typeof editForm.event_type })} options={EVENT_TYPES} />
                </div>
              </div>
              <div className={css({"minW":0})}>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <DashboardSelect id="automation-action" label="Action Type" value={editForm.action_type ?? ''} onValueChange={value => setEditForm({ ...editForm, action_type: value as typeof editForm.action_type })} options={ACTION_TYPES} />
                </div>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <span className={css({ textStyle: 'label' })}>Status</span>
                  <div>
                    <ParkButton type="button" variant="outline"
                      aria-label="Rule status"
                      aria-pressed={editForm.is_active}
                      onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                      className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                    >
                      {editForm.is_active ? <IconToggleOn aria-hidden="true" size={20} /> : <IconToggleOff aria-hidden="true" size={20} />}
                      {editForm.is_active ? 'Active' : 'Paused'}
                    </ParkButton>
                  </div>
                </div>
              </div>
            </div>

            <div className={css({"minW":0})}>
              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"fg.default"})}>Conditions</h3>
                <ParkButton
                  onClick={addCondition}
                  className={css({"minW":0})}
                >
                  <IconPlus aria-hidden="true" size={16} /> Add Condition
                </ParkButton>
              </div>
              <div className={css({"display":"grid","gap":"4"})}>
                {JSON.parse(editForm.conditions || '[]').map((cond: AutomationCondition, idx: number) => (
                  <div key={idx} className={css({ display: 'grid', gap: '2', gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr)) auto' }, alignItems: 'end' })}>
                    <DashboardSelect label={`Condition ${idx + 1} field`} value={cond.field} onValueChange={value => changeCondition(idx, 'field', value)} options={FIELDS} />
                    <DashboardSelect label={`Condition ${idx + 1} operator`} value={cond.operator} onValueChange={value => changeCondition(idx, 'operator', value as typeof cond.operator)} options={OPERATORS} />
                    <ParkField.Root className={css({ minW: '0' })}>
                      <ParkField.Label>Condition {idx + 1} value</ParkField.Label>
                      <ParkInput
                        type="text"
                        className={css({ w: 'full', minW: '0' })}
                        placeholder="Value..."
                        value={cond.value}
                        onChange={e => changeCondition(idx, 'value', e.target.value)}
                      />
                    </ParkField.Root>
                    <ParkButton type="button" variant="outline" aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)}>
                      <IconTrash aria-hidden="true" size={18} />
                    </ParkButton>
                  </div>
                ))}
                {JSON.parse(editForm.conditions || '[]').length === 0 && (
                  <ParkEmptyState
                    headingLevel={false}
                    title="No conditions added"
                    description="This rule will always run for the selected event. Use Add Condition above to narrow it."
                  />
                )}
              </div>
            </div>

            <div className={css({"minW":0})}>
              <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"fg.default"})}>Action Configuration</h3>
              {editForm.action_type === 'webhook' ? (
                <ParkCard.Root variant="outline"><ParkCard.Body className={css({ display: 'grid', gap: '4' })}>
                  <ParkField.Root className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                    <ParkField.Label htmlFor="automation-webhook-url">Webhook URL</ParkField.Label>
                    <ParkInput
                      id="automation-webhook-url"
                      type="url"
                      className={css({"w":"full"})}
                      placeholder="https://hooks.slack.com/services/..."
                      value={getActionConfig().url || ''}
                      onChange={e => updateActionConfig({ ...getActionConfig(), url: e.target.value })}
                    />
                  </ParkField.Root>
                  <div className={css({"display":"grid","gap":"4"})}>
                    <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                      <DashboardSelect id="automation-webhook-method" label="HTTP Method" value={getActionConfig().method || 'POST'} onValueChange={value => updateActionConfig({ ...getActionConfig(), method: value })} options={[{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }]} />
                    </div>
                  </div>
                </ParkCard.Body></ParkCard.Root>
              ) : (
                <ParkCard.Root variant="outline"><ParkCard.Body>
                  <div className={css({"display":"grid","gap":"4"})}>
                    <ParkField.Root className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                      <ParkField.Label htmlFor="automation-retention-days">Retention Period (Days)</ParkField.Label>
                      <ParkInput
                        id="automation-retention-days"
                        type="number"
                        className={css({"w":"full"})}
                        value={getActionConfig().days_to_keep || 365}
                        onChange={e => updateActionConfig({ ...getActionConfig(), days_to_keep: parseInt(e.target.value) })}
                      />
                    </ParkField.Root>
                    <ParkCheckbox.Root checked={getActionConfig().delete_attachments}
                      onCheckedChange={({ checked }) => updateActionConfig({ ...getActionConfig(), delete_attachments: checked === true })}>
                      <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                      <ParkCheckbox.HiddenInput id="del-attachments" />
                      <ParkCheckbox.Label>Delete R2 Attachments</ParkCheckbox.Label>
                    </ParkCheckbox.Root>
                  </div>
                </ParkCard.Body></ParkCard.Root>
              )}
            </div>

            </ParkCard.Body>
            <ParkCard.Footer asChild><div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3', flexWrap: 'wrap' })}>
              <ParkButton
                type="button" variant="outline" onClick={() => setIsEditing(null)}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Cancel
              </ParkButton>
              <ParkButton
                type="button" onClick={handleSave}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                <IconFloppyDisk aria-hidden="true" size={20} />
                Save Automation Rule
              </ParkButton>
            </div></ParkCard.Footer>
          </ParkCard.Root>
        )}

        {loadError && rules.length === 0 && !isEditing ? <ParkEmptyState role="alert" title="Automation rules could not be loaded" description="Retry before editing rule definitions." action={<ParkButton type="button" onClick={() => void fetchRules()}>Retry automations</ParkButton>} /> : rules.length === 0 && !isEditing ? (
          <ParkEmptyState
            title="No automation rules yet"
            description="Create rules to automate your ticket workflows, notify external systems, or manage data retention."
            className={css({"py":"6"})}
            action={<ParkButton
              onClick={startCreate}
              className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
            >
              Create your first rule
            </ParkButton>}
          />
        ) : (
          !isEditing && rules.map(rule => (
            <ParkCard.Root key={rule.id} variant="outline"><ParkCard.Body className={css({ display: 'grid', gap: '4' })}>
              <div className={css({ display: 'flex', alignItems: 'center', gap: '3', flexWrap: 'wrap', color: 'fg.muted', textStyle: 'sm' })}>
                <ParkButton type="button" variant="plain" aria-label={`Status of ${rule.name}`} aria-pressed={Boolean(rule.is_active)} onClick={() => handleToggle(rule.id, rule.is_active)}>
                  {rule.is_active ? (
                    <IconToggleOn aria-hidden="true" size={24} />
                  ) : (
                    <IconToggleOff aria-hidden="true" size={24} />
                  )}
                </ParkButton>
                <div className={css({"minW":0})}>
                  <h3 className={css({ m: '0', fontWeight: 'medium', color: 'fg.default' })}>{rule.name}</h3>
                  <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '2', mt: '2' })}>
                    <Badge>{rule.event_type}</Badge>
                    <Badge>{rule.action_type}</Badge>
                    {conditionCount(rule.conditions) > 0 && <Badge>{conditionCount(rule.conditions)} Conditions</Badge>}
                  </div>
                </div>
              </div>

              <div className={css({ display: 'flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
                <ParkButton type="button" variant="outline" aria-label={`Edit ${rule.name}`}
                  onClick={() => startEdit(rule)}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                  title="Edit Rule"
                >
                  <IconPenToSquare aria-hidden="true" size={20} />
                </ParkButton>
                <ParkButton type="button" variant="outline"
                  aria-label={`Delete ${rule.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(rule); setDeleteError(''); setDeleteOpen(true); }}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                  title="Delete Rule"
                >
                  <IconTrash aria-hidden="true" size={20} />
                </ParkButton>
              </div>
            </ParkCard.Body></ParkCard.Root>
          ))
        )}
      </div>
      <ParkDialog.Root open={deleteOpen} onOpenChange={({ open }) => { if (!deleting && !deleteGuard.current) setDeleteOpen(open); }}
        initialFocusEl={() => deleteCancel.current}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current}
        closeOnEscape={!deleting} closeOnInteractOutside={false} lazyMount unmountOnExit>
        <ParkDialog.Backdrop />
        <ParkDialog.Positioner>
          <ParkDialog.Content aria-labelledby={deleteTitleId} aria-describedby={deleteDescriptionId}>
            <ParkDialog.Header>
              <ParkDialog.Title id={deleteTitleId}>{`Delete rule: ${deletion?.name ?? ''}`}</ParkDialog.Title>
            </ParkDialog.Header>
            <ParkDialog.Body>
              <ParkDialog.Description id={deleteDescriptionId}>Delete this automation rule? This action cannot be undone.</ParkDialog.Description>
              {deleteError && <ParkAlert.Root role="alert" aria-atomic="true" status="error" variant="surface">
                <ParkAlert.Content><ParkAlert.Description>{deleteError}</ParkAlert.Description></ParkAlert.Content>
              </ParkAlert.Root>}
            </ParkDialog.Body>
            <ParkDialog.Footer>
              <ParkButton ref={deleteCancel} type="button" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</ParkButton>
              <ParkButton type="button" disabled={deleting} onClick={handleDelete}>{deleting ? 'Deleting...' : 'Delete rule'}</ParkButton>
            </ParkDialog.Footer>
          </ParkDialog.Content>
        </ParkDialog.Positioner>
      </ParkDialog.Root>
    </div>
  );
};
