import { DashboardSelect } from '../components/DashboardSelect';
import { css } from '@luminatick/ui/styled-system/css';
import React, { useId, useRef, useState } from 'react';
import { ParkButton, ParkCard, ParkCheckbox, ParkEmptyState, ParkInput, ParkSkeleton } from '@luminatick/ui/park';
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

  if (user?.role !== 'admin') return <ParkEmptyState role="alert" title="Support states are unavailable" description="Only administrators can manage support states." />;
  if (isLoading && states.length === 0) return <section role="status" aria-label="Loading support states" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', p: '6' })}>
    <span className={css({ srOnly: true })}>Loading support states…</span>
    <ParkSkeleton aria-hidden="true" className={css({ h: '8', w: '48' })} />
    <ParkSkeleton aria-hidden="true" className={css({ h: '32', w: 'full' })} />
  </section>;
  if (error && states.length === 0) return <ParkEmptyState role="alert" title="Support states could not be loaded" description="Retry before editing state definitions." action={<ParkButton type="button" onClick={() => void refetch()}>Retry loading support states</ParkButton>} />;

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

  return <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
    <div className={css({"display":"grid","gap":"1","mb":"2"})}><h1 ref={heading} tabIndex={-1} className={css({ m: '0', textStyle: '2xl', fontWeight: 'semibold', color: 'fg.default' })}>Support states</h1><p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>Name the operator workflow separately from the customer-facing label. State labels do not change access permissions.</p></div>
    {notice && <p role="status">{notice}</p>}{errorMessage && <p role="alert">{errorMessage}</p>}
    {error && <p role="alert">The latest support-state list could not be refreshed. <ParkButton type="button" onClick={() => void refetch()}>Retry loading support states</ParkButton></p>}
    <ParkCard.Root variant="outline"><ParkCard.Header><ParkCard.Title asChild><h2>{editing ? `Edit ${editing}` : 'Create support state'}</h2></ParkCard.Title></ParkCard.Header><ParkCard.Body>
    <form onSubmit={save} className={css({ display: 'grid', gap: '4' })} aria-label={editing ? 'Edit support state' : 'Create support state'}>
      <div className={css({"display":"grid","gap":"4","gridTemplateColumns":{"base":"1fr","md":"repeat(2,minmax(0,1fr))"}})}>
        <label className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>State ID<ParkInput id={`${formId}-id`} required disabled={Boolean(editing)} value={form.id} onChange={event => setForm(current => ({ ...current, id: event.target.value }))} maxLength={120} className={css({"w":"full"})} /></label>
        <label className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>Legacy lifecycle<DashboardSelect aria-label="Legacy lifecycle" disabled={Boolean(editing)} value={form.legacyStatus} onValueChange={value => setForm(current => ({ ...current, legacyStatus: value as SupportLifecycle }))} options={lifecycles.map(value => ({ value, label: value }))} /></label>
        <label className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>Internal label<ParkInput id={`${formId}-internal`} required value={form.internalLabel} onChange={event => setForm(current => ({ ...current, internalLabel: event.target.value }))} maxLength={120} className={css({"w":"full"})} /></label>
        <label className={css({"w":"full","display":"grid","gap":"1","fontSize":"sm"})}>Customer-visible label<ParkInput required value={form.publicLabel} onChange={event => setForm(current => ({ ...current, publicLabel: event.target.value }))} maxLength={120} className={css({"w":"full"})} /></label>
      </div>
      <div className={css({ display: 'grid', gap: '4' })}>
        <ParkCheckbox.Root checked={form.waitingReasonRequired} onCheckedChange={({ checked }) => setForm(current => ({ ...current, waitingReasonRequired: checked === true }))}>
          <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Require waiting reason</ParkCheckbox.Label>
        </ParkCheckbox.Root>
        <ParkCheckbox.Root checked={form.nextActionRequired} onCheckedChange={({ checked }) => setForm(current => ({ ...current, nextActionRequired: checked === true }))}>
          <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Require next action</ParkCheckbox.Label>
        </ParkCheckbox.Root>
      </div>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}><ParkButton type="submit" loading={create.isPending || update.isPending} loadingText="Saving support state…">{editing ? 'Save state' : 'Create state'}</ParkButton>{editing && <ParkButton type="button" variant="outline" onClick={reset}>Cancel edit</ParkButton>}</div>
    </form></ParkCard.Body></ParkCard.Root>
    {states.length === 0 ? <ParkEmptyState title="No support states found." description="Create a support state to define the operator workflow." headingLevel={false} /> : <ul className={css({"display":"grid","gap":"4"})} aria-label="Support state definitions">{states.map(state => <li key={state.id}>
      <ParkCard.Root variant="outline"><ParkCard.Body className={css({ display: 'grid', gap: '3' })}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}><div className={css({"minW":0})}><h2 className={css({"fontWeight":"medium","color":"fg.default"})}>{state.internal_label} {!state.is_active && <span className={css({"minW":0})}>(inactive)</span>}</h2><p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>Customer label: {state.public_label} · Legacy lifecycle: {state.legacy_status}</p><p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed"})}>{state.waiting_reason_required ? 'Waiting reason required' : 'Waiting reason optional'} · {state.next_action_required ? 'Next action required' : 'Next action optional'}</p></div><div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}><ParkButton type="button" onClick={() => beginEdit(state)} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>Edit {state.internal_label}</ParkButton>{state.is_active === 1 && state.is_compatibility_default === 0 && <ParkButton type="button" onClick={() => { setDeactivating(state.id); setReplacementId(''); setErrorMessage(''); }} className={css({"minW":0})}>Deactivate {state.internal_label}</ParkButton>}</div></div>
      {deactivating === state.id && <div className={css({"minW":0})}><p className={css({"color":"fg.muted","fontSize":"sm","lineHeight":"relaxed","display":"inline-flex","alignItems":"center","gap":"2"})}>Active tickets must move to an active replacement; this cannot leave tickets without a state.</p><label className={css({"fontWeight":"medium","color":"fg.default","display":"grid","gap":"1","fontSize":"sm"})}>Replacement state<DashboardSelect aria-label="Replacement state" autoFocus value={replacementId} onValueChange={setReplacementId} options={[{ value: '', label: 'Choose a replacement' }, ...states.filter(candidate => candidate.is_active === 1 && candidate.id !== state.id).map(candidate => ({ value: candidate.id, label: `${candidate.internal_label} (${candidate.legacy_status})` }))]} /></label><div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}><ParkButton type="button" loading={deactivate.isPending} loadingText="Deactivating" onClick={() => void confirmDeactivate(state)} className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}>Remap and deactivate</ParkButton><ParkButton type="button" onClick={() => setDeactivating(null)}>Cancel</ParkButton></div></div>}
      </ParkCard.Body></ParkCard.Root>
    </li>)}</ul>}{hasMore && <ParkButton type="button" onClick={() => void loadMore()} loading={isLoadingMore} loadingText="Loading more support states…">Load more support states</ParkButton>}{isLoadMoreError && <p role="alert" className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"fg.default"})}>Could not load more support states. Try again.</p>}
  </div>;
}
