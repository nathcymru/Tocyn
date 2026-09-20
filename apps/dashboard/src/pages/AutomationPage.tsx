import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkCheckbox, ParkInput } from '@luminatick/ui/park';
import { ParkEmptyState } from '@luminatick/ui/park';
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
  IconXmark,
  IconCircleExclamation,
  IconCircleCheck
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

export const AutomationPage: React.FC = () => {
  const heading = React.useRef<HTMLHeadingElement>(null);
  const deleteOpener = React.useRef<HTMLButtonElement | null>(null);
  const deleteGuard = React.useRef(false);
  const deleteSucceeded = React.useRef(false);
  const [deletion, setDeletion] = useState<AutomationRule | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch (error) {
      setError('Failed to fetch rules');
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

  if (loading) return <ParkEmptyState title="Loading automations…" className={css({"py":"6"})} aria-busy="true" />;

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 ref={heading} tabIndex={-1} className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Automation Rules</h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>Manage event-driven workflows and data retention.</p>
        </div>
        {!isEditing && (
          <ParkButton
            onClick={startCreate}
            variant="solid" className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            <IconPlus size={20} />
            Create Rule
          </ParkButton>
        )}
      </div>

      {error && (
        <div role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>
          <IconCircleExclamation size={20} />
          {error}
        </div>
      )}

      {success && (
        <div role="status" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>
          <IconCircleCheck size={20} />
          {success}
        </div>
      )}

      <div className={css({"minW":0})}>
        {isEditing && (
          <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <h2 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
                {isEditing === 'new' ? 'Create New Automation Rule' : 'Edit Automation Rule'}
              </h2>
              <ParkButton aria-label="Close automation editor" onClick={() => setIsEditing(null)} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
                <IconXmark size={24} />
              </ParkButton>
            </div>

            <div className={css({"display":"grid","gap":"4"})}>
              <div className={css({"minW":0})}>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <label htmlFor="automation-rule-name">Rule Name</label>
                  <ParkInput
                    id="automation-rule-name"
                    type="text"
                    className={css({"w":"full"})}
                    placeholder="e.g., Slack Notification for Urgent Tickets"
                    value={editForm.name || ''}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <label htmlFor="automation-trigger">Trigger Event</label>
                  <DashboardSelect id="automation-trigger" aria-label="Trigger Event" value={editForm.event_type ?? ''} onValueChange={value => setEditForm({ ...editForm, event_type: value as typeof editForm.event_type })} options={EVENT_TYPES} />
                </div>
              </div>
              <div className={css({"minW":0})}>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <label htmlFor="automation-action">Action Type</label>
                  <DashboardSelect id="automation-action" aria-label="Action Type" value={editForm.action_type ?? ''} onValueChange={value => setEditForm({ ...editForm, action_type: value as typeof editForm.action_type })} options={ACTION_TYPES} />
                </div>
                <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                  <label>Status</label>
                  <div className={css({"w":"full"})}>
                    <ParkButton
                      type="button"
                      aria-label="Rule status"
                      aria-pressed={editForm.is_active}
                      onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                      className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                    >
                      {editForm.is_active ? <IconToggleOn className={css({"w":"4","h":"4","flexShrink":0,"color":"text.default"})} size={40} /> : <IconToggleOff className={css({"w":"4","h":"4","flexShrink":0})} size={40} />}
                    </ParkButton>
                    <span className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>{editForm.is_active ? 'Active' : 'Paused'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className={css({"minW":0})}>
              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Conditions</h3>
                <ParkButton
                  onClick={addCondition}
                  className={css({"minW":0})}
                >
                  <IconPlus size={16} /> Add Condition
                </ParkButton>
              </div>
              <div className={css({"display":"grid","gap":"4"})}>
                {JSON.parse(editForm.conditions || '[]').map((cond: AutomationCondition, idx: number) => (
                  <div key={idx} className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                    <DashboardSelect aria-label={`Condition ${idx + 1} field`} value={cond.field} onValueChange={value => changeCondition(idx, 'field', value)} options={FIELDS} />
                    <DashboardSelect aria-label={`Condition ${idx + 1} operator`} value={cond.operator} onValueChange={value => changeCondition(idx, 'operator', value as typeof cond.operator)} options={OPERATORS} />
                    <ParkInput
                      type="text"
                      className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm","minW":0})}
                      placeholder="Value..."
                      aria-label={`Condition ${idx + 1} value`}
                      value={cond.value}
                      onChange={e => changeCondition(idx, 'value', e.target.value)}
                    />
                    <ParkButton aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
                      <IconTrash size={18} />
                    </ParkButton>
                  </div>
                ))}
                {JSON.parse(editForm.conditions || '[]').length === 0 && (
                  <p className={css({"py":"6"})}>
                    No conditions. This rule will always run for the selected event.
                  </p>
                )}
              </div>
            </div>

            <div className={css({"minW":0})}>
              <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Action Configuration</h3>
              {editForm.action_type === 'webhook' ? (
                <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
                  <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                    <label htmlFor="automation-webhook-url">Webhook URL</label>
                    <ParkInput
                      id="automation-webhook-url"
                      type="url"
                      className={css({"w":"full"})}
                      placeholder="https://hooks.slack.com/services/..."
                      value={getActionConfig().url || ''}
                      onChange={e => updateActionConfig({ ...getActionConfig(), url: e.target.value })}
                    />
                  </div>
                  <div className={css({"display":"grid","gap":"4"})}>
                    <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                      <label htmlFor="automation-webhook-method">HTTP Method</label>
                      <DashboardSelect id="automation-webhook-method" aria-label="HTTP Method" value={getActionConfig().method || 'POST'} onValueChange={value => updateActionConfig({ ...getActionConfig(), method: value })} options={[{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }]} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
                  <div className={css({"display":"grid","gap":"4"})}>
                    <div className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>
                      <label htmlFor="automation-retention-days">Retention Period (Days)</label>
                      <ParkInput
                        id="automation-retention-days"
                        type="number"
                        className={css({"w":"full"})}
                        value={getActionConfig().days_to_keep || 365}
                        onChange={e => updateActionConfig({ ...getActionConfig(), days_to_keep: parseInt(e.target.value) })}
                      />
                    </div>
                    <ParkCheckbox.Root checked={getActionConfig().delete_attachments}
                      onCheckedChange={({ checked }) => updateActionConfig({ ...getActionConfig(), delete_attachments: checked === true })}>
                      <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
                      <ParkCheckbox.HiddenInput id="del-attachments" />
                      <ParkCheckbox.Label>Delete R2 Attachments</ParkCheckbox.Label>
                    </ParkCheckbox.Root>
                  </div>
                </div>
              )}
            </div>

            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <ParkButton
                onClick={() => setIsEditing(null)}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                Cancel
              </ParkButton>
              <ParkButton
                onClick={handleSave}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                <IconFloppyDisk size={20} />
                Save Automation Rule
              </ParkButton>
            </div>
          </div>
        )}

        {rules.length === 0 && !isEditing ? (
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
            <div key={rule.id} className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
              <div className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
                <ParkButton aria-label={`Status of ${rule.name}`} aria-pressed={Boolean(rule.is_active)} onClick={() => handleToggle(rule.id, rule.is_active)} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>
                  {rule.is_active ? (
                    <IconToggleOn className={css({"w":"4","h":"4","flexShrink":0,"color":"text.default"})} size={36} />
                  ) : (
                    <IconToggleOff className={css({"w":"4","h":"4","flexShrink":0})} size={36} />
                  )}
                </ParkButton>
                <div className={css({"minW":0})}>
                  <h3 className={css({"fontWeight":"medium","color":"text.default"})}>{rule.name}</h3>
                  <div className={css({"minW":0})}>
                    <span className={css({"display":"inline-flex","alignItems":"center","rounded":"full","px":"2","py":"0.5","fontSize":"xs","fontWeight":"medium","bg":"bg.muted","minW":0})}>
                      {rule.event_type}
                    </span>
                    <span className={css({"display":"inline-flex","alignItems":"center","rounded":"full","px":"2","py":"0.5","fontSize":"xs","fontWeight":"medium","bg":"bg.muted","gap":"2"})}>
                      {rule.action_type}
                    </span>
                    {rule.conditions && JSON.parse(rule.conditions).length > 0 && (
                      <span className={css({"display":"inline-flex","alignItems":"center","rounded":"full","px":"2","py":"0.5","fontSize":"xs","fontWeight":"medium","bg":"bg.muted","minW":0})}>
                        {JSON.parse(rule.conditions).length} Conditions
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
                <ParkButton
                  onClick={() => startEdit(rule)}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                  title="Edit Rule"
                >
                  <IconPenToSquare size={20} />
                </ParkButton>
                <ParkButton
                  aria-label={`Delete ${rule.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(rule); setDeleteError(''); setDeleteOpen(true); }}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                  title="Delete Rule"
                >
                  <IconTrash size={20} />
                </ParkButton>
              </div>
            </div>
          ))
        )}
      </div>
      <TocynConfirmDialog open={deleteOpen} busy={deleting} title={`Delete rule: ${deletion?.name ?? ''}`}
        description="Delete this automation rule? This action cannot be undone." confirmLabel={deleting ? 'Deleting...' : 'Delete rule'} error={deleteError}
        onConfirm={handleDelete} onOpenChange={next => { if (!next && !deleteGuard.current) setDeleteOpen(false); }}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current} />
    </div>
  );
};
