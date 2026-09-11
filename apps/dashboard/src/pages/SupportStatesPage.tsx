import React, { useId, useRef, useState } from 'react';
import { TocynButton, TocynInput, TocynSelect } from '@luminatick/ui/primitives';
import { ApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { type SupportLifecycle, type SupportStateDefinition, useCreateSupportState, useDeactivateSupportState, useSupportStates, useUpdateSupportState } from '../hooks/useSupportStates';

const lifecycles: readonly SupportLifecycle[] = ['open', 'pending', 'resolved', 'closed'];
const blank = () => ({ id: '', legacyStatus: 'open' as SupportLifecycle, internalLabel: '', publicLabel: '', waitingReasonRequired: false, nextActionRequired: false });

export function SupportStatesPage() {
  const { user } = useAuthStore();
  const { data: states = [], isLoading, error, refetch } = useSupportStates(true);
  const create = useCreateSupportState();
  const update = useUpdateSupportState();
  const deactivate = useDeactivateSupportState();
  const formId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  if (user?.role !== 'admin') return <div><h1 className="text-2xl font-bold text-slate-900">Support states</h1><p role="alert" className="mt-4">Only administrators can manage support states.</p></div>;

  const reset = () => { setForm(blank()); setEditing(null); setErrorMessage(''); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setNotice(''); setErrorMessage('');
    try {
      if (editing) await update.mutateAsync({ id: editing, internalLabel: form.internalLabel.trim(), publicLabel: form.publicLabel.trim(), waitingReasonRequired: form.waitingReasonRequired, nextActionRequired: form.nextActionRequired });
      else await create.mutateAsync({ ...form, id: form.id.trim(), internalLabel: form.internalLabel.trim(), publicLabel: form.publicLabel.trim() });
      setNotice(editing ? 'Support state saved.' : 'Support state created.'); reset(); heading.current?.focus();
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'Support state could not be saved. Your input is retained.'); }
  };
  const beginEdit = (state: SupportStateDefinition) => {
    setEditing(state.id); setForm({ id: state.id, legacyStatus: state.legacy_status, internalLabel: state.internal_label, publicLabel: state.public_label, waitingReasonRequired: Boolean(state.waiting_reason_required), nextActionRequired: Boolean(state.next_action_required) });
    setDeactivating(null); setErrorMessage(''); document.getElementById(`${formId}-internal`)?.focus();
  };
  const confirmDeactivate = async (state: SupportStateDefinition) => {
    if (!replacementId) { setErrorMessage('Choose an active replacement before deactivating this state.'); return; }
    setErrorMessage(''); setNotice('');
    try { await deactivate.mutateAsync({ id: state.id, replacementId }); setNotice(`${state.internal_label} was deactivated and active tickets were remapped.`); setDeactivating(null); setReplacementId(''); heading.current?.focus(); }
    catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'Support state could not be deactivated. No state was discarded.'); }
  };

  return <div className="max-w-4xl space-y-6">
    <div><h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-slate-900">Support states</h1><p className="mt-1 text-slate-600">Name the operator workflow separately from the customer-facing label. State labels do not change access permissions.</p></div>
    {notice && <p role="status">{notice}</p>}{errorMessage && <p role="alert">{errorMessage}</p>}
    {error && <div role="alert">Could not load support states. <TocynButton type="button" onClick={() => void refetch()} className="underline">Retry loading support states</TocynButton></div>}
    <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-label={editing ? 'Edit support state' : 'Create support state'}>
      <h2 className="font-semibold">{editing ? `Edit ${editing}` : 'Create support state'}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">State ID<TocynInput id={`${formId}-id`} required disabled={Boolean(editing)} value={form.id} onChange={event => setForm(current => ({ ...current, id: event.target.value }))} maxLength={120} className="mt-1 w-full border rounded px-3 py-2" /></label>
        <label className="text-sm font-medium">Legacy lifecycle<TocynSelect disabled={Boolean(editing)} value={form.legacyStatus} onChange={event => setForm(current => ({ ...current, legacyStatus: event.target.value as SupportLifecycle }))} className="mt-1 w-full border rounded px-3 py-2">{lifecycles.map(value => <option key={value} value={value}>{value}</option>)}</TocynSelect></label>
        <label className="text-sm font-medium">Internal label<TocynInput id={`${formId}-internal`} required value={form.internalLabel} onChange={event => setForm(current => ({ ...current, internalLabel: event.target.value }))} maxLength={120} className="mt-1 w-full border rounded px-3 py-2" /></label>
        <label className="text-sm font-medium">Customer-visible label<TocynInput required value={form.publicLabel} onChange={event => setForm(current => ({ ...current, publicLabel: event.target.value }))} maxLength={120} className="mt-1 w-full border rounded px-3 py-2" /></label>
      </div>
      <div className="flex flex-wrap gap-5"><label><input type="checkbox" checked={form.waitingReasonRequired} onChange={event => setForm(current => ({ ...current, waitingReasonRequired: event.target.checked }))} /> Require waiting reason</label><label><input type="checkbox" checked={form.nextActionRequired} onChange={event => setForm(current => ({ ...current, nextActionRequired: event.target.checked }))} /> Require next action</label></div>
      <div className="flex gap-3"><TocynButton type="submit" aria-disabled={create.isPending || update.isPending} className="rounded bg-brand-600 px-4 py-2 text-white">{editing ? 'Save state' : 'Create state'}</TocynButton>{editing && <TocynButton type="button" onClick={reset} className="underline">Cancel edit</TocynButton>}</div>
    </form>
    {isLoading ? <p role="status">Loading support states…</p> : <ul className="space-y-3" aria-label="Support state definitions">{states.map(state => <li key={state.id} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{state.internal_label} {!state.is_active && <span className="text-slate-500">(inactive)</span>}</h2><p className="text-sm text-slate-600">Customer label: {state.public_label} · Legacy lifecycle: {state.legacy_status}</p><p className="text-sm text-slate-600">{state.waiting_reason_required ? 'Waiting reason required' : 'Waiting reason optional'} · {state.next_action_required ? 'Next action required' : 'Next action optional'}</p></div><div className="flex gap-3"><TocynButton type="button" onClick={() => beginEdit(state)} className="underline">Edit {state.internal_label}</TocynButton>{state.is_active === 1 && state.is_compatibility_default === 0 && <TocynButton type="button" onClick={() => { setDeactivating(state.id); setReplacementId(''); setErrorMessage(''); }} className="text-red-700 underline">Deactivate {state.internal_label}</TocynButton>}</div></div>
      {deactivating === state.id && <div className="mt-4 border-t pt-4"><p className="text-sm">Active tickets must move to an active replacement; this cannot leave tickets without a state.</p><label className="mt-2 block text-sm font-medium">Replacement state<TocynSelect autoFocus value={replacementId} onChange={event => setReplacementId(event.target.value)} className="mt-1 w-full border rounded px-3 py-2"><option value="">Choose a replacement</option>{states.filter(candidate => candidate.is_active === 1 && candidate.id !== state.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.internal_label} ({candidate.legacy_status})</option>)}</TocynSelect></label><div className="mt-3 flex gap-3"><TocynButton type="button" aria-disabled={deactivate.isPending} onClick={() => void confirmDeactivate(state)} className="rounded bg-red-700 px-4 py-2 text-white">Remap and deactivate</TocynButton><TocynButton type="button" onClick={() => setDeactivating(null)} className="underline">Cancel</TocynButton></div></div>}
    </li>)}</ul>}
  </div>;
}
