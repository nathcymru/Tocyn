import { Field } from '@luminatick/ui/components';
import { ParkAlert, ParkButton, ParkCheckbox, ParkDialog, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import React, { useRef, useState } from 'react';
import type { CriticalityTier } from '@luminatick/shared';
import { DashboardSelect } from '../components/DashboardSelect';
import { categoryOptions, scopeOptions, contractOptions, criticalityOptions, emptyClassificationDraft,
  type ClassificationDraft } from '../components/ticket-classification';
import { X } from '../components/icons';
import { useAgents, useGroups } from '../hooks/useGroups';
import { useCreateTicket } from '../hooks/useTickets';

type NewTicketDraft = {
  subject: string;
  customer_email: string;
  body: string;
  status: string;
  group_id: string;
  assigned_to: string;
  custom_fields: Record<string, unknown>;
  classification: ClassificationDraft;
};

const emptyDraft = (): NewTicketDraft => ({
  subject: '', customer_email: '', body: '', status: 'open',
  group_id: '', assigned_to: '', custom_fields: {},
  classification: emptyClassificationDraft(),
});

/** The active inbox owns the trigger; this dialog keeps a failed draft in place for retry. */
export function NewTicketDialog({ open, onOpenChange, trigger, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onCreated: () => void;
}) {
  const titleId = React.useId();
  const subject = useRef<HTMLInputElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const category = useRef<HTMLButtonElement>(null);
  const scope = useRef<HTMLButtonElement>(null);
  const contractTier = useRef<HTMLButtonElement>(null);
  const criticalityTier = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<NewTicketDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [classificationError, setClassificationError] = useState(false);
  const createTicket = useCreateTicket();
  const { data: groups } = useGroups();
  const { data: agents } = useAgents();
  const pending = createTicket.isPending;
  const update = <K extends keyof NewTicketDraft>(key: K, value: NewTicketDraft[K]) => {
    if (!pending) setDraft(current => ({ ...current, [key]: value }));
  };
  const updateClassification = <K extends keyof ClassificationDraft>(key: K, value: ClassificationDraft[K]) => {
    if (pending) return;
    const classification = { ...draft.classification, [key]: value };
    setDraft(current => ({ ...current, classification: { ...current.classification, [key]: value } }));
    if (classification.category && classification.scope && classification.contractTier && classification.criticalityTier !== null) {
      setClassificationError(false);
    }
  };
  const close = () => { if (!pending) onOpenChange(false); };
  const submitDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    const classification = draft.classification;
    if (!classification.category || !classification.scope || !classification.contractTier || classification.criticalityTier === null) {
      setClassificationError(true);
      const firstMissing = !classification.category ? category : !classification.scope ? scope
        : !classification.contractTier ? contractTier : criticalityTier;
      requestAnimationFrame(() => firstMissing.current?.focus());
      return;
    }
    setClassificationError(false);
    try {
      await createTicket.mutateAsync({
        ...draft,
        classification: {
          category: classification.category,
          scope: classification.scope,
          regulatoryOfficerOnSite: classification.regulatoryOfficerOnSite,
          vipBlocked: classification.vipBlocked,
          hardDeadline: classification.hardDeadline,
          contractTier: classification.contractTier,
          criticalityTier: classification.criticalityTier,
        },
        group_id: draft.group_id || undefined,
        assigned_to: draft.assigned_to || undefined,
        custom_fields: Object.keys(draft.custom_fields).length ? draft.custom_fields : undefined,
      });
      setDraft(emptyDraft());
      setClassificationError(false);
      onOpenChange(false);
      onCreated();
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Failed to create ticket. Please try again.');
      // A rejected submit must leave the action and the draft available for retry.
      requestAnimationFrame(() => submit.current?.focus());
    }
  };

  return <ParkDialog.Root open={open} onOpenChange={({ open: nextOpen }) => { if (!pending) onOpenChange(nextOpen); }}
    initialFocusEl={() => subject.current} finalFocusEl={() => trigger.current}
    closeOnEscape={!pending} closeOnInteractOutside={false} lazyMount unmountOnExit>
    <ParkDialog.Backdrop />
    <ParkDialog.Positioner>
    <ParkDialog.Content aria-labelledby={titleId} className={css({ w: 'min(100% - 2rem, 40rem)', maxH: 'calc(100dvh - 2rem)', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
    <ParkDialog.Header className={css({ flexShrink: 0 })}>
      <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
        <ParkDialog.Title id={titleId}>Create New Ticket</ParkDialog.Title>
        <ParkButton type="button" variant="plain" aria-label="Close new ticket" aria-disabled={pending} onClick={close}>
          <X aria-hidden="true" />
        </ParkButton>
      </div>
    </ParkDialog.Header>
    <ParkDialog.Body className={css({ minH: 0, overflowY: 'auto' })}>
      <form id="new-ticket-form" aria-busy={pending} onSubmit={event => { void submitDraft(event); }}
        className={css({ display: 'grid', gap: '4' })}>
        <p role="status" aria-label="Ticket creation status" className={css({ m: '0', color: 'fg.muted', fontSize: 'sm' })}>
          {pending ? 'Creating ticket…' : ''}
        </p>
        {error && <ParkAlert.Root id="create-ticket-error" role="alert" status="error" variant="surface">
          <ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>}
        <div className={css({ display: 'grid', gridTemplateColumns: { base: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '4' })}>
          <Field.Root required className={css({ minW: 0 })}>
            <Field.Label htmlFor="create-ticket-subject">Subject</Field.Label>
            <ParkInput id="create-ticket-subject" ref={subject} required readOnly={pending}
              aria-describedby={`create-ticket-subject-help${error ? ' create-ticket-error' : ''}`} value={draft.subject}
              onChange={event => update('subject', event.target.value)} />
            <Field.HelperText id="create-ticket-subject-help">A short title for this conversation.</Field.HelperText>
          </Field.Root>
          <Field.Root required className={css({ minW: 0 })}>
            <Field.Label htmlFor="create-ticket-customer_email">Customer Email</Field.Label>
            <ParkInput id="create-ticket-customer_email" type="email" required readOnly={pending}
              aria-describedby={`create-ticket-customer-help${error ? ' create-ticket-error' : ''}`} value={draft.customer_email}
              onChange={event => update('customer_email', event.target.value)} />
            <Field.HelperText id="create-ticket-customer-help">The customer who will receive replies.</Field.HelperText>
          </Field.Root>
          <DashboardSelect id="create-ticket-group_id" label="Group" disabled={pending} value={draft.group_id}
            onValueChange={value => update('group_id', value)} options={[
              { value: '', label: 'No Group' }, ...(Array.isArray(groups) ? groups.map(group => ({ value: group.id, label: group.name })) : []),
            ]} />
          <DashboardSelect id="create-ticket-assigned_to" label="Assignee" disabled={pending} value={draft.assigned_to}
            onValueChange={value => update('assigned_to', value)} options={[
              { value: '', label: 'Unassigned' }, ...(Array.isArray(agents) ? agents.map(agent => ({ value: agent.id, label: agent.full_name || agent.email })) : []),
            ]} />
        </div>
        <Field.Root required className={css({ minW: 0 })}>
          <Field.Label htmlFor="create-ticket-body">Initial Message</Field.Label>
          <ParkTextarea id="create-ticket-body" rows={4} required readOnly={pending}
            aria-describedby={`create-ticket-body-help${error ? ' create-ticket-error' : ''}`} value={draft.body}
            onChange={event => update('body', event.target.value)} />
          <Field.HelperText id="create-ticket-body-help">The first message in the conversation.</Field.HelperText>
        </Field.Root>
        <section aria-labelledby="create-ticket-classification-heading" className={css({ display: 'grid', gap: '4' })}>
          <div>
            <h3 id="create-ticket-classification-heading" className={css({ m: '0', fontSize: 'md', fontWeight: 'semibold' })}>Ticket classification</h3>
            <p className={css({ m: '0', color: 'fg.muted', fontSize: 'sm' })}>Choose a category, scope, contract tier, and criticality level. The score is calculated when the ticket is created.</p>
          </div>
          {classificationError && <ParkAlert.Root id="create-ticket-classification-error" role="alert" status="error" variant="surface">
            <ParkAlert.Content><ParkAlert.Description>Choose a category, scope, contract tier, and criticality level before creating a ticket.</ParkAlert.Description></ParkAlert.Content>
          </ParkAlert.Root>}
          <div className={css({ display: 'grid', gridTemplateColumns: { base: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '4' })}>
            <DashboardSelect id="create-ticket-category" label="Category (required)" disabled={pending} value={draft.classification.category}
              triggerRef={category} aria-describedby={classificationError ? 'create-ticket-classification-error' : undefined}
              onValueChange={value => updateClassification('category', value as ClassificationDraft['category'])} options={categoryOptions} />
            <DashboardSelect id="create-ticket-scope" label="Scope (required)" disabled={pending} value={draft.classification.scope}
              triggerRef={scope} aria-describedby={classificationError ? 'create-ticket-classification-error' : undefined}
              onValueChange={value => updateClassification('scope', value as ClassificationDraft['scope'])} options={scopeOptions} />
            <DashboardSelect id="create-ticket-contract-tier" label="Contract tier (required)" disabled={pending} value={draft.classification.contractTier}
              triggerRef={contractTier} aria-describedby={classificationError ? 'create-ticket-classification-error' : undefined}
              onValueChange={value => updateClassification('contractTier', value as ClassificationDraft['contractTier'])} options={contractOptions} />
            <DashboardSelect id="create-ticket-criticality-tier" label="Criticality level (required)" disabled={pending}
              value={draft.classification.criticalityTier?.toString() ?? ''} triggerRef={criticalityTier}
              aria-describedby={classificationError ? 'create-ticket-classification-error' : undefined}
              onValueChange={value => updateClassification('criticalityTier', value ? Number(value) as CriticalityTier : null)} options={criticalityOptions} />
          </div>
          <div className={css({ display: 'grid', gap: '2' })}>
            <p className={css({ m: '0', color: 'fg.muted', fontSize: 'sm' })}>Urgency conditions: each checked condition adds 5 points. Check all that apply.</p>
            <ParkCheckbox.Root checked={draft.classification.regulatoryOfficerOnSite} disabled={pending}
              onCheckedChange={({ checked }) => updateClassification('regulatoryOfficerOnSite', checked === true)}>
              <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
              <ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Regulatory officer on site</ParkCheckbox.Label>
            </ParkCheckbox.Root>
            <ParkCheckbox.Root checked={draft.classification.vipBlocked} disabled={pending}
              onCheckedChange={({ checked }) => updateClassification('vipBlocked', checked === true)}>
              <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
              <ParkCheckbox.HiddenInput /><ParkCheckbox.Label>VIP blocked</ParkCheckbox.Label>
            </ParkCheckbox.Root>
            <ParkCheckbox.Root checked={draft.classification.hardDeadline} disabled={pending}
              onCheckedChange={({ checked }) => updateClassification('hardDeadline', checked === true)}>
              <ParkCheckbox.Control><ParkCheckbox.Indicator /></ParkCheckbox.Control>
              <ParkCheckbox.HiddenInput /><ParkCheckbox.Label>Hard deadline</ParkCheckbox.Label>
            </ParkCheckbox.Root>
          </div>
        </section>
      </form>
    </ParkDialog.Body>
    <ParkDialog.Footer className={css({ flexShrink: 0 })}>
      <ParkButton type="button" variant="outline" aria-disabled={pending} onClick={close}>Cancel</ParkButton>
      <ParkButton ref={submit} type="submit" form="new-ticket-form" aria-disabled={pending} onClick={event => { if (pending) event.preventDefault(); }}>
        {pending ? 'Creating…' : 'Create Ticket'}
      </ParkButton>
    </ParkDialog.Footer>
    </ParkDialog.Content>
    </ParkDialog.Positioner>
  </ParkDialog.Root>;
}
