import { ParkAlert, ParkButton, ParkCheckbox, ParkDialog } from '@luminatick/ui/park';
import { IconButton as ParkIconButton } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import type { CriticalityTier } from '@luminatick/shared';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { DashboardSelect } from '../components/DashboardSelect';
import { categoryOptions, classificationDraftFromTicket, completeClassification, contractOptions,
  criticalityOptions, sameClassification, scopeOptions, type ClassificationDraft } from '../components/ticket-classification';
import { X } from '../components/icons';
import { assignmentIdentity } from '../hooks/useTicketAssignment';
import { useUpdateTicketClassification, type TicketWithClassificationRevision } from '../hooks/useTickets';

export function EditTicketClassificationDialog({ ticket, open, onOpenChange, trigger, onReload, onSaved }: {
  ticket: TicketWithClassificationRevision;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onReload: () => Promise<TicketWithClassificationRevision | null>;
  onSaved: () => void;
}) {
  const titleId = useId();
  const formId = useId();
  const category = useRef<HTMLButtonElement>(null);
  const scope = useRef<HTMLButtonElement>(null);
  const contractTier = useRef<HTMLButtonElement>(null);
  const criticalityTier = useRef<HTMLButtonElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const reload = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<ClassificationDraft>(() => classificationDraftFromTicket(ticket));
  const [confirmedBase, setConfirmedBase] = useState<ClassificationDraft>(() => classificationDraftFromTicket(ticket));
  const [expectedRevision, setExpectedRevision] = useState(ticket.priority_classification_revision);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const [confirmedCurrent, setConfirmedCurrent] = useState<ClassificationDraft | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const continueAfterReview = useRef<HTMLButtonElement>(null);
  const retryKey = useRef<{ payload: string; key: string } | null>(null);
  const updateTicket = useUpdateTicketClassification();
  const pending = updateTicket.isPending;
  const unchanged = sameClassification(draft, confirmedBase);

  // Opening again starts from the last confirmed ticket. A background refetch
  // must never replace edits while this dialog is open.
  useEffect(() => {
    if (!open) return;
    setDraft(classificationDraftFromTicket(ticket));
    setConfirmedBase(classificationDraftFromTicket(ticket));
    setExpectedRevision(ticket.priority_classification_revision);
    setError(null); setNotice(null); setInvalid(false); setConflict(false); setReloaded(false);
    setConfirmedCurrent(null); setReviewPending(false);
    retryKey.current = null;
    const focusFrame = requestAnimationFrame(() => category.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [open]);

  const update = <K extends keyof ClassificationDraft>(key: K, value: ClassificationDraft[K]) => {
    if (pending) return;
    setNotice(null);
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (completeClassification(next)) setInvalid(false);
      return next;
    });
  };
  const close = () => { if (!pending) onOpenChange(false); };
  const submitDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || conflict || reviewPending || unchanged) return;
    setError(null);
    setNotice(null);
    const classification = completeClassification(draft);
    if (!classification) {
      setInvalid(true);
      const missing = !draft.category ? category : !draft.scope ? scope
        : !draft.contractTier ? contractTier : criticalityTier;
      requestAnimationFrame(() => missing.current?.focus());
      return;
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision! < 0) {
      setError('The current classification version is unavailable. Reload the ticket before saving.');
      setConflict(true);
      requestAnimationFrame(() => reload.current?.focus());
      return;
    }
    const identity = assignmentIdentity();
    const payload = JSON.stringify({ classification, expectedClassificationRevision: expectedRevision });
    if (retryKey.current?.payload !== payload) retryKey.current = { payload, key: crypto.randomUUID() };
    try {
      await updateTicket.mutateAsync({ id: ticket.id, classification,
        expectedClassificationRevision: expectedRevision!, idempotencyKey: retryKey.current.key });
      if (identity !== assignmentIdentity()) return;
      retryKey.current = null;
      onOpenChange(false);
      onSaved();
    } catch (cause) {
      if (identity !== assignmentIdentity() || cause instanceof Error && cause.name === 'AbortError') return;
      if (cause instanceof ApiError && cause.status === 409) {
        retryKey.current = null;
        setConflict(true);
        setReloaded(false);
        setError('Classification changed while you were editing. Your choices are still here. Reload the current ticket, review it, then retry saving.');
        requestAnimationFrame(() => reload.current?.focus());
      } else {
        if (cause instanceof ApiError && cause.status < 500 && cause.status !== 408) retryKey.current = null;
        setError(cause instanceof Error ? cause.message : 'Classification could not be saved. Retry when the connection is available.');
        requestAnimationFrame(() => submit.current?.focus());
      }
    }
  };
  const reloadCurrent = async () => {
    if (pending) return;
    const identity = assignmentIdentity();
    try {
      const current = await onReload();
      if (identity !== assignmentIdentity()) return;
      if (!current || !Number.isSafeInteger(current.priority_classification_revision)) throw new Error('Current classification is unavailable.');
      // Retain the unsaved choices. The operator may explicitly discard them
      // or review the confirmed version before retrying with its new revision.
      setExpectedRevision(current.priority_classification_revision);
      setConfirmedBase(classificationDraftFromTicket(current));
      retryKey.current = null;
      setConflict(false);
      setReloaded(true);
      setConfirmedCurrent(classificationDraftFromTicket(current));
      setReviewPending(true);
      setError(null);
      setNotice('Current ticket loaded. Compare its confirmed classification with your unchanged choices below.');
      requestAnimationFrame(() => continueAfterReview.current?.focus());
    } catch (cause) {
      if (identity !== assignmentIdentity() || cause instanceof Error && cause.name === 'AbortError') return;
      setError('Current classification could not be loaded. Your choices are still here; retry loading.');
      requestAnimationFrame(() => reload.current?.focus());
    }
  };

  return <ParkDialog.Root open={open} onOpenChange={({ open: nextOpen }) => { if (!pending) onOpenChange(nextOpen); }}
    initialFocusEl={() => category.current} finalFocusEl={() => trigger.current}
    closeOnEscape={!pending} closeOnInteractOutside={false} lazyMount unmountOnExit>
    <ParkDialog.Backdrop />
    <ParkDialog.Positioner>
      <ParkDialog.Content aria-labelledby={titleId} className={css({ w: 'min(100% - 2rem, 40rem)', maxH: 'calc(100dvh - 2rem)', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
        <ParkDialog.Header className={css({ flexShrink: 0 })}>
          <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
            <ParkDialog.Title id={titleId}>Edit ticket classification</ParkDialog.Title>
            <ParkIconButton type="button" variant="plain" aria-label="Close classification editor" disabled={pending} onClick={close}><X aria-hidden="true" /></ParkIconButton>
          </div>
        </ParkDialog.Header>
        <ParkDialog.Body className={css({ minH: 0, overflowY: 'auto' })}>
          <form id={formId} aria-busy={pending} onSubmit={event => { void submitDraft(event); }} className={css({ display: 'grid', gap: '4' })}>
            <p className={css({ m: 0, color: 'fg.muted', fontSize: 'sm' })}>The score is calculated from these fields. Changing a tier updates the fixed-hour countdown while keeping time already spent.</p>
            {unchanged && <p role="status" className={css({ m: 0, color: 'fg.muted', fontSize: 'sm' })}>No classification changes to save.</p>}
            <p role="status" aria-label="Classification save status" className={css({ m: 0, color: 'fg.muted', fontSize: 'sm' })}>{pending ? 'Saving classification…' : ''}</p>
            {(error || invalid) && <ParkAlert.Root id="classification-edit-error" role="alert" status={conflict ? 'warning' : 'error'} variant="surface">
              <ParkAlert.Content><ParkAlert.Description>{invalid ? 'Choose a category, scope, contract tier, and criticality level.' : error}</ParkAlert.Description>
                {conflict && <ParkButton ref={reload} type="button" variant="outline" onClick={() => void reloadCurrent()}>Reload current ticket</ParkButton>}
              </ParkAlert.Content>
            </ParkAlert.Root>}
            {notice && <ParkAlert.Root role="status" status="info" variant="surface"><ParkAlert.Content><ParkAlert.Description>{notice}</ParkAlert.Description></ParkAlert.Content></ParkAlert.Root>}
            {confirmedCurrent && <section aria-label="Current confirmed classification" className={css({ display: 'grid', gap: '2', p: '3', borderWidth: '1px', borderColor: 'border.default', borderRadius: 'l2' })}>
              <h3 className={css({ m: 0, fontSize: 'sm', fontWeight: 'semibold' })}>Current confirmed classification</h3>
              <dl className={css({ display: 'grid', gridTemplateColumns: { base: '1fr 1fr', sm: 'repeat(4, minmax(0, 1fr))' }, gap: '2', m: 0, fontSize: 'sm' })}>
                {[
                  ['Category', categoryOptions.find(option => option.value === confirmedCurrent.category)?.label ?? 'Unavailable'],
                  ['Scope', scopeOptions.find(option => option.value === confirmedCurrent.scope)?.label ?? 'Unavailable'],
                  ['Contract tier', contractOptions.find(option => option.value === confirmedCurrent.contractTier)?.label ?? 'Unavailable'],
                  ['Criticality level', criticalityOptions.find(option => option.value === String(confirmedCurrent.criticalityTier))?.label ?? 'Unavailable'],
                ].map(([label, value]) => <div key={label}><dt className={css({ color: 'fg.muted' })}>{label}</dt><dd className={css({ m: 0 })}>{value}</dd></div>)}
              </dl>
              <p className={css({ m: 0, fontSize: 'sm' })}>Current urgency: {[
                confirmedCurrent.regulatoryOfficerOnSite && 'Regulatory officer on site',
                confirmedCurrent.vipBlocked && 'VIP blocked',
                confirmedCurrent.hardDeadline && 'Hard deadline',
              ].filter(Boolean).join(', ') || 'No additional conditions'}.</p>
              {reviewPending && <ParkButton ref={continueAfterReview} type="button" variant="outline" onClick={() => {
                setReviewPending(false); setNotice('Current values reviewed. Retry to save your retained choices.');
                requestAnimationFrame(() => submit.current?.focus());
              }}>Continue with my choices</ParkButton>}
            </section>}
            <div className={css({ display: 'grid', gridTemplateColumns: { base: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '4' })}>
              <DashboardSelect id="edit-ticket-category" label="Category (required)" disabled={pending} value={draft.category}
                triggerRef={category} aria-describedby={invalid ? 'classification-edit-error' : undefined}
                onValueChange={value => update('category', value as ClassificationDraft['category'])} options={categoryOptions} />
              <DashboardSelect id="edit-ticket-scope" label="Scope (required)" disabled={pending} value={draft.scope}
                triggerRef={scope} aria-describedby={invalid ? 'classification-edit-error' : undefined}
                onValueChange={value => update('scope', value as ClassificationDraft['scope'])} options={scopeOptions} />
              <DashboardSelect id="edit-ticket-contract-tier" label="Contract tier (required)" disabled={pending} value={draft.contractTier}
                triggerRef={contractTier} aria-describedby={invalid ? 'classification-edit-error' : undefined}
                onValueChange={value => update('contractTier', value as ClassificationDraft['contractTier'])} options={contractOptions} />
              <DashboardSelect id="edit-ticket-criticality-tier" label="Criticality level (required)" disabled={pending}
                value={draft.criticalityTier?.toString() ?? ''} triggerRef={criticalityTier}
                aria-describedby={invalid ? 'classification-edit-error' : undefined}
                onValueChange={value => update('criticalityTier', value ? Number(value) as CriticalityTier : null)} options={criticalityOptions} />
            </div>
            <div className={css({ display: 'grid', gap: '2' })}>
              <p className={css({ m: 0, color: 'fg.muted', fontSize: 'sm' })}>Urgency conditions: each checked condition adds 5 points. Check all that apply.</p>
              <ParkCheckbox.Root checked={draft.regulatoryOfficerOnSite} disabled={pending} onCheckedChange={({ checked }) => update('regulatoryOfficerOnSite', checked === true)}>
                <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Regulatory officer on site</ParkCheckbox.Label>
              </ParkCheckbox.Root>
              <ParkCheckbox.Root checked={draft.vipBlocked} disabled={pending} onCheckedChange={({ checked }) => update('vipBlocked', checked === true)}>
                <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.HiddenInput /><ParkCheckbox.Label>VIP blocked</ParkCheckbox.Label>
              </ParkCheckbox.Root>
              <ParkCheckbox.Root checked={draft.hardDeadline} disabled={pending} onCheckedChange={({ checked }) => update('hardDeadline', checked === true)}>
                <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control><ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Hard deadline</ParkCheckbox.Label>
              </ParkCheckbox.Root>
            </div>
          </form>
        </ParkDialog.Body>
        <ParkDialog.Footer className={css({ flexShrink: 0 })}>
          <ParkButton type="button" variant="outline" disabled={pending} onClick={close}>Cancel</ParkButton>
          <ParkButton ref={submit} type="submit" form={formId} disabled={pending || conflict || reviewPending || unchanged}>{pending ? 'Saving…' : (reloaded || error && !invalid && !conflict) ? 'Retry saving classification' : 'Save classification'}</ParkButton>
        </ParkDialog.Footer>
      </ParkDialog.Content>
    </ParkDialog.Positioner>
  </ParkDialog.Root>;
}
