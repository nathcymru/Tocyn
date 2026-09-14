import React, { useId, useRef, useState } from 'react';
import { ParkButton, ParkEmptyState, ParkInput, ParkSelect } from '@luminatick/ui/park';
import { ApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { type SupportLifecycle, type SupportStateDefinition, useCreateSupportState, useDeactivateSupportState, useSupportStates, useUpdateSupportState } from '../hooks/useSupportStates';

const lifecycles: readonly SupportLifecycle[] = ['open', 'pending', 'resolved', 'closed'];
const blank = () => ({ id: '', legacyStatus: 'open' as SupportLifecycle, internalLabel: '', publicLabel: '', waitingReasonRequired: false, nextActionRequired: false });

export function SupportStatesPage() {
  const { user } = useAuthStore();
  const { data: states = [], isLoading, error, refetch, loadMore, hasMore, isLoadingMore, isLoadMoreError } = useSupportStates(true);
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

  if (user?.role !== 'admin') return <div><h1 className="tocyn-support-state-denied-title">Support states</h1><p role="alert" className="tocyn-support-state-denied-message">Only administrators can manage support states.</p></div>;

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

  return <div className="tocyn-support-state-page">
    <div className="tocyn-support-state-header"><h1 ref={heading} tabIndex={-1} className="tocyn-support-state-title">Support states</h1><p className="tocyn-support-state-description">Name the operator workflow separately from the customer-facing label. State labels do not change access permissions.</p></div>
    {notice && <p role="status">{notice}</p>}{errorMessage && <p role="alert">{errorMessage}</p>}
    {error && states.length === 0 && <div role="alert">Could not load support states. <ParkButton type="button" onClick={() => void refetch()} className="tocyn-u-underline">Retry loading support states</ParkButton></div>}
    <form onSubmit={save} className="tocyn-support-state-form" aria-label={editing ? 'Edit support state' : 'Create support state'}>
      <h2 className="tocyn-support-state-form-title">{editing ? `Edit ${editing}` : 'Create support state'}</h2>
      <div className="tocyn-support-state-fields">
        <label className="tocyn-form-field">State ID<ParkInput id={`${formId}-id`} required disabled={Boolean(editing)} value={form.id} onChange={event => setForm(current => ({ ...current, id: event.target.value }))} maxLength={120} className="tocyn-form-control" /></label>
        <label className="tocyn-form-field">Legacy lifecycle<ParkSelect disabled={Boolean(editing)} value={form.legacyStatus} onChange={event => setForm(current => ({ ...current, legacyStatus: event.target.value as SupportLifecycle }))} className="tocyn-form-control">{lifecycles.map(value => <option key={value} value={value}>{value}</option>)}</ParkSelect></label>
        <label className="tocyn-form-field">Internal label<ParkInput id={`${formId}-internal`} required value={form.internalLabel} onChange={event => setForm(current => ({ ...current, internalLabel: event.target.value }))} maxLength={120} className="tocyn-form-control" /></label>
        <label className="tocyn-form-field">Customer-visible label<ParkInput required value={form.publicLabel} onChange={event => setForm(current => ({ ...current, publicLabel: event.target.value }))} maxLength={120} className="tocyn-form-control" /></label>
      </div>
      <div className="tocyn-support-state-options"><label><ParkInput type="checkbox" checked={form.waitingReasonRequired} onChange={event => setForm(current => ({ ...current, waitingReasonRequired: event.target.checked }))} /> Require waiting reason</label><label><ParkInput type="checkbox" checked={form.nextActionRequired} onChange={event => setForm(current => ({ ...current, nextActionRequired: event.target.checked }))} /> Require next action</label></div>
      <div className="tocyn-support-state-actions"><ParkButton type="submit" aria-disabled={create.isPending || update.isPending} className="tocyn-support-state-submit">{editing ? 'Save state' : 'Create state'}</ParkButton>{editing && <ParkButton type="button" onClick={reset} className="tocyn-u-underline">Cancel edit</ParkButton>}</div>
    </form>
    {isLoading ? <ParkEmptyState title="Loading support states…" headingLevel={false} aria-busy="true" className="tocyn-support-state-loading" /> : <>{states.length === 0 ? <ParkEmptyState title="No support states found." description="Create a support state to define the operator workflow." headingLevel={false} /> : <ul className="tocyn-support-state-list" aria-label="Support state definitions">{states.map(state => <li key={state.id} className="tocyn-support-state-card">
      <div className="tocyn-support-state-row"><div className="tocyn-support-state-info"><h2 className="tocyn-support-state-name">{state.internal_label} {!state.is_active && <span className="tocyn-support-state-inactive">(inactive)</span>}</h2><p className="tocyn-support-state-meta">Customer label: {state.public_label} · Legacy lifecycle: {state.legacy_status}</p><p className="tocyn-support-state-meta">{state.waiting_reason_required ? 'Waiting reason required' : 'Waiting reason optional'} · {state.next_action_required ? 'Next action required' : 'Next action optional'}</p></div><div className="tocyn-support-state-actions"><ParkButton type="button" onClick={() => beginEdit(state)} className="tocyn-support-state-edit">Edit {state.internal_label}</ParkButton>{state.is_active === 1 && state.is_compatibility_default === 0 && <ParkButton type="button" onClick={() => { setDeactivating(state.id); setReplacementId(''); setErrorMessage(''); }} className="tocyn-support-state-deactivate">Deactivate {state.internal_label}</ParkButton>}</div></div>
      {deactivating === state.id && <div className="tocyn-support-state-remap"><p className="tocyn-support-state-remap-copy">Active tickets must move to an active replacement; this cannot leave tickets without a state.</p><label className="tocyn-support-state-replacement-label">Replacement state<ParkSelect autoFocus value={replacementId} onChange={event => setReplacementId(event.target.value)} className="tocyn-support-state-replacement"><option value="">Choose a replacement</option>{states.filter(candidate => candidate.is_active === 1 && candidate.id !== state.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.internal_label} ({candidate.legacy_status})</option>)}</ParkSelect></label><div className="tocyn-support-state-remap-actions"><ParkButton type="button" aria-disabled={deactivate.isPending} onClick={() => void confirmDeactivate(state)} className="tocyn-support-state-remap-submit">Remap and deactivate</ParkButton><ParkButton type="button" onClick={() => setDeactivating(null)} className="tocyn-u-underline">Cancel</ParkButton></div></div>}
    </li>)}</ul>}{hasMore && <ParkButton type="button" onClick={() => void loadMore()} aria-disabled={isLoadingMore} className="tocyn-u-underline">{isLoadingMore ? 'Loading more support states…' : 'Load more support states'}</ParkButton>}{isLoadMoreError && <p role="alert" className="tocyn-support-state-error">Could not load more support states. Try again.</p>}</>}
  </div>;
}
