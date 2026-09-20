import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkAlert, ParkButton, ParkDialog, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import React, { useRef, useState } from 'react';
import { DashboardSelect } from '../components/DashboardSelect';
import { X } from '../components/icons';
import { useAgents, useGroups } from '../hooks/useGroups';
import { useCreateTicket } from '../hooks/useTickets';

type NewTicketDraft = {
  subject: string;
  customer_email: string;
  body: string;
  priority: string;
  status: string;
  group_id: string;
  assigned_to: string;
  custom_fields: Record<string, unknown>;
};

const emptyDraft = (): NewTicketDraft => ({
  subject: '', customer_email: '', body: '', priority: 'normal', status: 'open',
  group_id: '', assigned_to: '', custom_fields: {},
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
  const [draft, setDraft] = useState<NewTicketDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const createTicket = useCreateTicket();
  const { data: groups } = useGroups();
  const { data: agents } = useAgents();
  const pending = createTicket.isPending;
  const update = <K extends keyof NewTicketDraft>(key: K, value: NewTicketDraft[K]) => {
    if (!pending) setDraft(current => ({ ...current, [key]: value }));
  };
  const close = () => { if (!pending) onOpenChange(false); };
  const submitDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    try {
      await createTicket.mutateAsync({
        ...draft,
        group_id: draft.group_id || undefined,
        assigned_to: draft.assigned_to || undefined,
        custom_fields: Object.keys(draft.custom_fields).length ? draft.custom_fields : undefined,
      });
      setDraft(emptyDraft());
      onOpenChange(false);
      onCreated();
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Failed to create ticket. Please try again.');
      // A rejected submit must leave the action and the draft available for retry.
      requestAnimationFrame(() => submit.current?.focus());
    }
  };

  return <TocynDialog open={open} onOpenChange={onOpenChange} busy={pending}
    labelledBy={titleId} initialFocusEl={() => subject.current} finalFocusEl={() => trigger.current}
    className={css({ w: 'min(100% - 2rem, 40rem)', maxH: 'calc(100dvh - 2rem)', overflowY: 'auto' })}>
    <ParkDialog.Header className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' })}>
      <ParkDialog.Title id={titleId}>Create New Ticket</ParkDialog.Title>
      <ParkButton type="button" variant="plain" aria-label="Close new ticket" aria-disabled={pending} onClick={close}>
        <X aria-hidden="true" />
      </ParkButton>
    </ParkDialog.Header>
    <ParkDialog.Body>
      <form id="new-ticket-form" aria-busy={pending} onSubmit={event => { void submitDraft(event); }}
        className={css({ display: 'grid', gap: '4' })}>
        <p role="status" aria-label="Ticket creation status" className={css({ m: '0', color: 'fg.muted', fontSize: 'sm' })}>
          {pending ? 'Creating ticket…' : ''}
        </p>
        {error && <ParkAlert.Root id="create-ticket-error" role="alert" status="error" variant="surface">
          <ParkAlert.Content><ParkAlert.Description>{error}</ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>}
        <div className={css({ display: 'grid', gridTemplateColumns: { base: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '4' })}>
          <div className={css({ display: 'grid', gap: '1', minW: 0 })}>
            <label htmlFor="create-ticket-subject">Subject</label>
            <ParkInput id="create-ticket-subject" ref={subject} required readOnly={pending}
              aria-describedby={error ? 'create-ticket-error' : undefined} value={draft.subject}
              onChange={event => update('subject', event.target.value)} />
          </div>
          <div className={css({ display: 'grid', gap: '1', minW: 0 })}>
            <label htmlFor="create-ticket-customer_email">Customer Email</label>
            <ParkInput id="create-ticket-customer_email" type="email" required readOnly={pending}
              aria-describedby={error ? 'create-ticket-error' : undefined} value={draft.customer_email}
              onChange={event => update('customer_email', event.target.value)} />
          </div>
          <DashboardSelect id="create-ticket-priority" label="Priority" disabled={pending} value={draft.priority}
            onValueChange={value => update('priority', value)} options={[
              { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
            ]} />
          <DashboardSelect id="create-ticket-group_id" label="Group" disabled={pending} value={draft.group_id}
            onValueChange={value => update('group_id', value)} options={[
              { value: '', label: 'No Group' }, ...(Array.isArray(groups) ? groups.map(group => ({ value: group.id, label: group.name })) : []),
            ]} />
          <DashboardSelect id="create-ticket-assigned_to" label="Assignee" disabled={pending} value={draft.assigned_to}
            onValueChange={value => update('assigned_to', value)} options={[
              { value: '', label: 'Unassigned' }, ...(Array.isArray(agents) ? agents.map(agent => ({ value: agent.id, label: agent.full_name || agent.email })) : []),
            ]} />
        </div>
        <div className={css({ display: 'grid', gap: '1', minW: 0 })}>
          <label htmlFor="create-ticket-body">Initial Message</label>
          <ParkTextarea id="create-ticket-body" rows={4} required readOnly={pending}
            aria-describedby={error ? 'create-ticket-error' : undefined} value={draft.body}
            onChange={event => update('body', event.target.value)} />
        </div>
      </form>
    </ParkDialog.Body>
    <ParkDialog.Footer>
      <ParkButton type="button" variant="outline" aria-disabled={pending} onClick={close}>Cancel</ParkButton>
      <ParkButton ref={submit} type="submit" form="new-ticket-form" aria-disabled={pending} onClick={event => { if (pending) event.preventDefault(); }}>
        {pending ? 'Creating…' : 'Create Ticket'}
      </ParkButton>
    </ParkDialog.Footer>
  </TocynDialog>;
}
