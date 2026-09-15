import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkInput, ParkSelect } from '@luminatick/ui/park';
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

  if (loading) return <ParkEmptyState title="Loading automations…" className="tocyn-automation-loading" aria-busy="true" />;

  return (
    <div className="tocyn-automation-page">
      <div className="tocyn-automation-header">
        <div>
          <h1 ref={heading} tabIndex={-1} className="tocyn-automation-title">Automation Rules</h1>
          <p className="tocyn-automation-description">Manage event-driven workflows and data retention.</p>
        </div>
        {!isEditing && (
          <ParkButton
            onClick={startCreate}
            variant="solid" className="tocyn-automation-create"
          >
            <IconPlus size={20} />
            Create Rule
          </ParkButton>
        )}
      </div>

      {error && (
        <div role="alert" className="tocyn-automation-alert tocyn-automation-alert--error">
          <IconCircleExclamation size={20} />
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="tocyn-automation-alert tocyn-automation-alert--success">
          <IconCircleCheck size={20} />
          {success}
        </div>
      )}

      <div className="tocyn-automation-content">
        {isEditing && (
          <div className="tocyn-automation-editor">
            <div className="tocyn-automation-editor-header">
              <h2 className="tocyn-automation-editor-title">
                {isEditing === 'new' ? 'Create New Automation Rule' : 'Edit Automation Rule'}
              </h2>
              <ParkButton aria-label="Close automation editor" onClick={() => setIsEditing(null)} className="tocyn-automation-editor-close">
                <IconXmark size={24} />
              </ParkButton>
            </div>

            <div className="tocyn-automation-editor-grid">
              <div className="tocyn-automation-editor-column">
                <div className="tocyn-form-field">
                  <label htmlFor="automation-rule-name">Rule Name</label>
                  <ParkInput
                    id="automation-rule-name"
                    type="text"
                    className="tocyn-form-control"
                    placeholder="e.g., Slack Notification for Urgent Tickets"
                    value={editForm.name || ''}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div className="tocyn-form-field">
                  <label htmlFor="automation-trigger">Trigger Event</label>
                  <ParkSelect
                    id="automation-trigger"
                    className="tocyn-form-control"
                    value={editForm.event_type}
                    onChange={e => setEditForm({ ...editForm, event_type: e.target.value as any })}
                  >
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </ParkSelect>
                </div>
              </div>
              <div className="tocyn-automation-editor-column">
                <div className="tocyn-form-field">
                  <label htmlFor="automation-action">Action Type</label>
                  <ParkSelect
                    className="tocyn-form-control"
                    id="automation-action"
                    value={editForm.action_type}
                    onChange={e => setEditForm({ ...editForm, action_type: e.target.value as any })}
                  >
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </ParkSelect>
                </div>
                <div className="tocyn-form-field">
                  <label>Status</label>
                  <div className="tocyn-automation-status-control">
                    <ParkButton
                      type="button"
                      aria-label="Rule status"
                      aria-pressed={editForm.is_active}
                      onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                      className="tocyn-automation-status-toggle"
                    >
                      {editForm.is_active ? <IconToggleOn className="tocyn-automation-status-icon tocyn-automation-status-icon--active" size={40} /> : <IconToggleOff className="tocyn-automation-status-icon tocyn-automation-status-icon--paused" size={40} />}
                    </ParkButton>
                    <span className="tocyn-automation-status-label">{editForm.is_active ? 'Active' : 'Paused'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="tocyn-automation-conditions-section">
              <div className="tocyn-automation-conditions-header">
                <h3 className="tocyn-automation-conditions-title">Conditions</h3>
                <ParkButton
                  onClick={addCondition}
                  className="tocyn-automation-add-condition"
                >
                  <IconPlus size={16} /> Add Condition
                </ParkButton>
              </div>
              <div className="tocyn-automation-condition-list">
                {JSON.parse(editForm.conditions || '[]').map((cond: AutomationCondition, idx: number) => (
                  <div key={idx} className="tocyn-automation-condition-row">
                    <ParkSelect
                      className="tocyn-automation-condition-field tocyn-automation-condition-field--flex"
                      aria-label={`Condition ${idx + 1} field`}
                      value={cond.field}
                      onChange={e => changeCondition(idx, 'field', e.target.value)}
                    >
                      {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </ParkSelect>
                    <ParkSelect
                      className="tocyn-automation-condition-field tocyn-automation-condition-field--operator"
                      aria-label={`Condition ${idx + 1} operator`}
                      value={cond.operator}
                      onChange={e => changeCondition(idx, 'operator', e.target.value as any)}
                    >
                      {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </ParkSelect>
                    <ParkInput
                      type="text"
                      className="tocyn-automation-condition-field tocyn-automation-condition-field--value"
                      placeholder="Value..."
                      aria-label={`Condition ${idx + 1} value`}
                      value={cond.value}
                      onChange={e => changeCondition(idx, 'value', e.target.value)}
                    />
                    <ParkButton aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)} className="tocyn-automation-condition-remove">
                      <IconTrash size={18} />
                    </ParkButton>
                  </div>
                ))}
                {JSON.parse(editForm.conditions || '[]').length === 0 && (
                  <p className="tocyn-automation-condition-empty">
                    No conditions. This rule will always run for the selected event.
                  </p>
                )}
              </div>
            </div>

            <div className="tocyn-automation-action-section">
              <h3 className="tocyn-automation-action-title">Action Configuration</h3>
              {editForm.action_type === 'webhook' ? (
                <div className="tocyn-automation-config-panel">
                  <div className="tocyn-form-field">
                    <label htmlFor="automation-webhook-url">Webhook URL</label>
                    <ParkInput
                      id="automation-webhook-url"
                      type="url"
                      className="tocyn-automation-config-control"
                      placeholder="https://hooks.slack.com/services/..."
                      value={getActionConfig().url || ''}
                      onChange={e => updateActionConfig({ ...getActionConfig(), url: e.target.value })}
                    />
                  </div>
                  <div className="tocyn-automation-config-grid">
                    <div className="tocyn-form-field">
                      <label htmlFor="automation-webhook-method">HTTP Method</label>
                      <ParkSelect
                        id="automation-webhook-method"
                        className="tocyn-automation-config-control"
                        value={getActionConfig().method || 'POST'}
                        onChange={e => updateActionConfig({ ...getActionConfig(), method: e.target.value })}
                      >
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </ParkSelect>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="tocyn-automation-config-panel">
                  <div className="tocyn-automation-config-grid">
                    <div className="tocyn-form-field">
                      <label htmlFor="automation-retention-days">Retention Period (Days)</label>
                      <ParkInput
                        id="automation-retention-days"
                        type="number"
                        className="tocyn-automation-config-control"
                        value={getActionConfig().days_to_keep || 365}
                        onChange={e => updateActionConfig({ ...getActionConfig(), days_to_keep: parseInt(e.target.value) })}
                      />
                    </div>
                    <div className="tocyn-automation-retention-checkbox">
                      <ParkInput
                        type="checkbox"
                        id="del-attachments"
                        checked={getActionConfig().delete_attachments}
                        onChange={e => updateActionConfig({ ...getActionConfig(), delete_attachments: e.target.checked })}
                        className="tocyn-automation-checkbox"
                      />
                      <label htmlFor="del-attachments" className="tocyn-automation-checkbox-label">Delete R2 Attachments</label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="tocyn-automation-editor-actions">
              <ParkButton
                onClick={() => setIsEditing(null)}
                className="tocyn-automation-cancel"
              >
                Cancel
              </ParkButton>
              <ParkButton
                onClick={handleSave}
                className="tocyn-automation-save"
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
            className="tocyn-automation-empty"
            action={<ParkButton
              onClick={startCreate}
              className="tocyn-automation-empty-action"
            >
              Create your first rule
            </ParkButton>}
          />
        ) : (
          !isEditing && rules.map(rule => (
            <div key={rule.id} className="tocyn-automation-rule-card">
              <div className="tocyn-automation-rule-summary">
                <ParkButton aria-label={`Status of ${rule.name}`} aria-pressed={Boolean(rule.is_active)} onClick={() => handleToggle(rule.id, rule.is_active)} className="tocyn-automation-toggle">
                  {rule.is_active ? (
                    <IconToggleOn className="tocyn-automation-toggle-icon tocyn-automation-toggle-icon--active" size={36} />
                  ) : (
                    <IconToggleOff className="tocyn-automation-toggle-icon tocyn-automation-toggle-icon--paused" size={36} />
                  )}
                </ParkButton>
                <div className="tocyn-automation-rule-info">
                  <h3 className="tocyn-automation-rule-name">{rule.name}</h3>
                  <div className="tocyn-automation-rule-tags">
                    <span className="tocyn-automation-tag tocyn-automation-tag-event">
                      {rule.event_type}
                    </span>
                    <span className="tocyn-automation-tag tocyn-automation-tag-action">
                      {rule.action_type}
                    </span>
                    {rule.conditions && JSON.parse(rule.conditions).length > 0 && (
                      <span className="tocyn-automation-tag tocyn-automation-tag-conditions">
                        {JSON.parse(rule.conditions).length} Conditions
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="tocyn-automation-rule-actions">
                <ParkButton
                  onClick={() => startEdit(rule)}
                  className="tocyn-automation-rule-action tocyn-automation-rule-action-edit"
                  title="Edit Rule"
                >
                  <IconPenToSquare size={20} />
                </ParkButton>
                <ParkButton
                  aria-label={`Delete ${rule.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(rule); setDeleteError(''); setDeleteOpen(true); }}
                  className="tocyn-automation-rule-action tocyn-automation-rule-action-delete"
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
