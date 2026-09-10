import { TocynConfirmDialog } from '@luminatick/ui/dialog';
import { TocynButton, TocynInput, TocynSelect } from '@luminatick/ui/primitives';
import React, { useEffect, useState } from 'react';
import { dashboardApi } from '../api/client';
import { AutomationRule, AutomationCondition, WebhookConfig, RetentionConfig } from '../types';
import { Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X, AlertCircle, CheckCircle } from 'lucide-react';

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

  if (loading) return <div className="p-8 text-center text-slate-500">Loading automations...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-slate-900">Automation Rules</h1>
          <p className="text-slate-500">Manage event-driven workflows and data retention.</p>
        </div>
        {!isEditing && (
          <TocynButton
            onClick={startCreate}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <Plus size={20} />
            Create Rule
          </TocynButton>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg flex items-center gap-3">
          <CheckCircle size={20} />
          {success}
        </div>
      )}

      <div className="space-y-4">
        {isEditing && (
          <div className="bg-white border-2 border-indigo-100 rounded-xl p-6 shadow-lg mb-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-slate-900">
                {isEditing === 'new' ? 'Create New Automation Rule' : 'Edit Automation Rule'}
              </h2>
              <TocynButton aria-label="Close automation editor" onClick={() => setIsEditing(null)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </TocynButton>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="space-y-4">
                <div>
                  <label htmlFor="automation-rule-name" className="block text-sm font-semibold text-slate-700 mb-1">Rule Name</label>
                  <TocynInput
                    id="automation-rule-name"
                    type="text"
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="e.g., Slack Notification for Urgent Tickets"
                    value={editForm.name || ''}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="automation-trigger" className="block text-sm font-semibold text-slate-700 mb-1">Trigger Event</label>
                  <TocynSelect
                    id="automation-trigger"
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={editForm.event_type}
                    onChange={e => setEditForm({ ...editForm, event_type: e.target.value as any })}
                  >
                    {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </TocynSelect>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="automation-action" className="block text-sm font-semibold text-slate-700 mb-1">Action Type</label>
                  <TocynSelect
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    id="automation-action"
                    value={editForm.action_type}
                    onChange={e => setEditForm({ ...editForm, action_type: e.target.value as any })}
                  >
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </TocynSelect>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Status</label>
                  <div className="flex items-center gap-3 h-10">
                    <TocynButton
                      type="button"
                      aria-label="Rule status"
                      aria-pressed={editForm.is_active}
                      onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                      className="transition-colors"
                    >
                      {editForm.is_active ? <ToggleRight className="text-indigo-600" size={40} /> : <ToggleLeft className="text-slate-300" size={40} />}
                    </TocynButton>
                    <span className="font-medium text-slate-700">{editForm.is_active ? 'Active' : 'Paused'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-900">Conditions</h3>
                <TocynButton
                  onClick={addCondition}
                  className="text-sm text-indigo-600 font-medium flex items-center gap-1 hover:underline"
                >
                  <Plus size={16} /> Add Condition
                </TocynButton>
              </div>
              <div className="space-y-3">
                {JSON.parse(editForm.conditions || '[]').map((cond: AutomationCondition, idx: number) => (
                  <div key={idx} className="flex gap-3 items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <TocynSelect
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-md text-sm"
                      aria-label={`Condition ${idx + 1} field`}
                      value={cond.field}
                      onChange={e => changeCondition(idx, 'field', e.target.value)}
                    >
                      {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </TocynSelect>
                    <TocynSelect
                      className="w-40 px-3 py-1.5 border border-slate-200 rounded-md text-sm"
                      aria-label={`Condition ${idx + 1} operator`}
                      value={cond.operator}
                      onChange={e => changeCondition(idx, 'operator', e.target.value as any)}
                    >
                      {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </TocynSelect>
                    <TocynInput
                      type="text"
                      className="flex-[2] px-3 py-1.5 border border-slate-200 rounded-md text-sm"
                      placeholder="Value..."
                      aria-label={`Condition ${idx + 1} value`}
                      value={cond.value}
                      onChange={e => changeCondition(idx, 'value', e.target.value)}
                    />
                    <TocynButton aria-label={`Remove condition ${idx + 1}`} onClick={() => removeCondition(idx)} className="text-slate-400 hover:text-red-500 p-1">
                      <Trash2 size={18} />
                    </TocynButton>
                  </div>
                ))}
                {JSON.parse(editForm.conditions || '[]').length === 0 && (
                  <p className="text-sm text-slate-400 italic bg-slate-50 p-4 rounded-lg border border-dashed border-slate-300 text-center">
                    No conditions. This rule will always run for the selected event.
                  </p>
                )}
              </div>
            </div>

            <div className="mb-8">
              <h3 className="font-semibold text-slate-900 mb-4">Action Configuration</h3>
              {editForm.action_type === 'webhook' ? (
                <div className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div>
                    <label htmlFor="automation-webhook-url" className="block text-xs font-bold text-slate-500 uppercase mb-1">Webhook URL</label>
                    <TocynInput
                      id="automation-webhook-url"
                      type="url"
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="https://hooks.slack.com/services/..."
                      value={getActionConfig().url || ''}
                      onChange={e => updateActionConfig({ ...getActionConfig(), url: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="automation-webhook-method" className="block text-xs font-bold text-slate-500 uppercase mb-1">HTTP Method</label>
                      <TocynSelect
                        id="automation-webhook-method"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                        value={getActionConfig().method || 'POST'}
                        onChange={e => updateActionConfig({ ...getActionConfig(), method: e.target.value })}
                      >
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </TocynSelect>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="automation-retention-days" className="block text-xs font-bold text-slate-500 uppercase mb-1">Retention Period (Days)</label>
                      <TocynInput
                        id="automation-retention-days"
                        type="number"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm"
                        value={getActionConfig().days_to_keep || 365}
                        onChange={e => updateActionConfig({ ...getActionConfig(), days_to_keep: parseInt(e.target.value) })}
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-5">
                      <TocynInput
                        type="checkbox"
                        id="del-attachments"
                        checked={getActionConfig().delete_attachments}
                        onChange={e => updateActionConfig({ ...getActionConfig(), delete_attachments: e.target.checked })}
                        className="w-4 h-4 text-indigo-600 rounded"
                      />
                      <label htmlFor="del-attachments" className="text-sm text-slate-700">Delete R2 Attachments</label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
              <TocynButton
                onClick={() => setIsEditing(null)}
                className="px-6 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </TocynButton>
              <TocynButton
                onClick={handleSave}
                className="bg-indigo-600 text-white px-8 py-2.5 rounded-lg flex items-center gap-2 hover:bg-indigo-700 font-bold shadow-md transition-all active:scale-95"
              >
                <Save size={20} />
                Save Automation Rule
              </TocynButton>
            </div>
          </div>
        )}

        {rules.length === 0 && !isEditing ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Plus className="text-slate-400" size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">No automation rules yet</h3>
            <p className="text-slate-500 mb-6">Create rules to automate your ticket workflows, notify external systems, or manage data retention.</p>
            <TocynButton
              onClick={startCreate}
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-indigo-700 transition-colors"
            >
              Create your first rule
            </TocynButton>
          </div>
        ) : (
          !isEditing && rules.map(rule => (
            <div key={rule.id} className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between hover:border-indigo-200 hover:shadow-sm transition-all">
              <div className="flex items-center gap-4">
                <TocynButton aria-label={`Status of ${rule.name}`} aria-pressed={Boolean(rule.is_active)} onClick={() => handleToggle(rule.id, rule.is_active)} className="transition-transform active:scale-90">
                  {rule.is_active ? (
                    <ToggleRight className="text-indigo-600" size={36} />
                  ) : (
                    <ToggleLeft className="text-slate-300" size={36} />
                  )}
                </TocynButton>
                <div>
                  <h3 className="font-bold text-slate-900">{rule.name}</h3>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full uppercase font-black tracking-widest border border-slate-200">
                      {rule.event_type}
                    </span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full uppercase font-black tracking-widest border border-indigo-100">
                      {rule.action_type}
                    </span>
                    {rule.conditions && JSON.parse(rule.conditions).length > 0 && (
                      <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full uppercase font-black tracking-widest border border-amber-100">
                        {JSON.parse(rule.conditions).length} Conditions
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <TocynButton
                  onClick={() => startEdit(rule)}
                  className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
                  title="Edit Rule"
                >
                  <Edit2 size={20} />
                </TocynButton>
                <TocynButton
                  aria-label={`Delete ${rule.name}`} onClick={event => { deleteOpener.current = event.currentTarget; deleteSucceeded.current = false; setDeletion(rule); setDeleteError(''); setDeleteOpen(true); }}
                  className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  title="Delete Rule"
                >
                  <Trash2 size={20} />
                </TocynButton>
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
