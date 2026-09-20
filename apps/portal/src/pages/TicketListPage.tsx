import { p } from '../portalStyles';
import { ParkAlert, ParkButton, ParkDialog, ParkEmptyState, ParkField, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { Link as ParkLink } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { useState, useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { portalApi } from '../api/client';
import type { Ticket, PaginatedResponse } from '../types';
import {
  IconSpinner,
  IconPlus
} from '@luminatick/ui/icons';
import { formatDistanceToNow } from 'date-fns';
import { utcTimestamp } from '../utils/utcTimestamp';
import { ticketReference } from '../utils/ticket-reference';
import { PortalLoadingSkeleton } from '../components/RouteContent';

const ticketRowMainWrap = css({ minW: '0', flexWrap: 'wrap' });
const ticketSubjectWrap = css({ minW: '0', overflowWrap: 'anywhere' });

export function TicketListPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketPrefix, setTicketPrefix] = useState<string>('#');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState('');
  const createButton = useRef<HTMLButtonElement>(null);
  const subjectInput = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const recovering = useRef(false);

  useEffect(() => {
    if (!loading && !error && recovering.current) {
      listHeading.current?.focus();
      recovering.current = false;
    }
  }, [loading, error]);

  const retryTickets = async () => {
    if (loading) return;
    recovering.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await portalApi.get<PaginatedResponse<Ticket>>('/tickets');
      setTickets(response.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let active = true;
    portalApi.get<PaginatedResponse<Ticket>>('/tickets')
      .then(response => { if (active) setTickets(response.data); })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load tickets');
      })
      .finally(() => { if (active) setLoading(false); });
    portalApi.get<{ TICKET_PREFIX: string; TURNSTILE_SITE_KEY?: string }>('/config')
      .then(res => {
        if (active) {
          setTicketPrefix(res.TICKET_PREFIX);
          if (res.TURNSTILE_SITE_KEY) setTurnstileSiteKey(res.TURNSTILE_SITE_KEY);
        }
      })
      .catch(err => console.error('Failed to fetch config', err));
    return () => { active = false; };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingTicket || !newSubject.trim() || !newMessage.trim()) return;
    setCreateError(null);
    setCreateStatus('');

    setCreatingTicket(true);
    if (turnstileSiteKey) {
      turnstileRef.current?.execute();
    } else {
      submitTicket();
    }
  };

  const submitTicket = async (token?: string) => {
    try {
      const result = await portalApi.post<{ ticket: Ticket }>('/tickets', {
        subject: newSubject,
        message: newMessage,
        ...(token && { turnstileToken: token })
      });
      setTickets(previous => [result.ticket, ...previous]);
      setCreateStatus('Ticket created. It is now in your ticket list.');
      setIsCreating(false);
      setNewSubject('');
      setNewMessage('');
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setCreatingTicket(false);
      turnstileRef.current?.reset();
    }
  };

  const statusColors = {
    open: p.statusOpen,
    pending: p.statusPending,
    resolved: p.statusResolved,
    closed: p.statusClosed,
  };

  if (loading) {
    return <PortalLoadingSkeleton label="Loading tickets…" className={p.ticketLoading} />;
  }

  if (error) {
    return <ParkEmptyState role="alert" title="Tickets could not be loaded." description={error} headingLevel={false} className={p.ticketError} action={<ParkButton type="button" onClick={retryTickets}>Retry loading tickets</ParkButton>} />;
  }

  return (
    <div className={p.ticketList}>
      <div className={p.ticketListHeader}>
        <h1 ref={listHeading} tabIndex={-1} className={p.ticketListTitle}>Your Tickets</h1>
        <ParkButton
          ref={createButton}
          type="button"
          onClick={() => { setCreateError(null); setIsCreating(true); }}
          variant="solid" className={p.ticketListCreate}
        >
          <IconPlus className={p.ticketListIcon} aria-hidden="true" />
          New Ticket
        </ParkButton>
      </div>

      {createStatus && <ParkAlert.Root role="status" aria-live="polite" status="success" variant="surface">
        <ParkAlert.Content><ParkAlert.Description>{createStatus}</ParkAlert.Description></ParkAlert.Content>
      </ParkAlert.Root>}
      <ParkDialog.Root open={isCreating} onOpenChange={({ open }) => { if (!creatingTicket) setIsCreating(open); }}
        initialFocusEl={() => subjectInput.current} finalFocusEl={() => createButton.current}
        closeOnEscape={!creatingTicket} closeOnInteractOutside={false} lazyMount unmountOnExit>
        <ParkDialog.Backdrop />
        <ParkDialog.Positioner>
          <ParkDialog.Content aria-labelledby="create-ticket-heading" className={p.ticketDialog}>
            <ParkDialog.Header>
              <ParkDialog.Title id="create-ticket-heading" className={p.ticketDialogTitle}>Create New Ticket</ParkDialog.Title>
            </ParkDialog.Header>
            <ParkDialog.Body>
              <form aria-busy={creatingTicket} onSubmit={handleCreate} className={[p.ticketForm, p.ticketFieldInput].join(' ')}>
                {createError && <ParkAlert.Root id="create-ticket-error" role="alert" status="error">
                  <ParkAlert.Content><ParkAlert.Description>{createError}</ParkAlert.Description></ParkAlert.Content>
                </ParkAlert.Root>}
                <p role="status" aria-live="polite" className={p.ticketDialogStatus}>{creatingTicket ? 'Creating ticket…' : ''}</p>
                <ParkField label="Subject" className={p.ticketField}>
                  <ParkInput
                    ref={subjectInput}
                    readOnly={creatingTicket}
                    aria-describedby={createError ? 'create-ticket-error' : undefined}
                    type="text"
                    required
                    value={newSubject}
                    onChange={(e) => { if (!creatingTicket) setNewSubject(e.target.value); }}
                    className={p.ticketFieldInput}
                    placeholder="What do you need help with?"
                  />
                </ParkField>
                <ParkField label="Message" className={p.ticketField}>
                  <ParkTextarea
                    readOnly={creatingTicket}
                    aria-describedby={createError ? 'create-ticket-error' : undefined}
                    required
                    rows={4}
                    value={newMessage}
                    onChange={(e) => { if (!creatingTicket) setNewMessage(e.target.value); }}
                    className={p.ticketFieldInput}
                    placeholder="Describe your issue in detail..."
                  />
                </ParkField>
                <div className={p.ticketActions}>
                  {turnstileSiteKey && (
                    <Turnstile
                      ref={turnstileRef}
                      siteKey={turnstileSiteKey}
                      options={{ size: 'invisible', execution: 'execute' }}
                      onSuccess={(token) => submitTicket(token)}
                      onError={() => {
                        setCreateError('Security check failed. Please try again.');
                        setCreatingTicket(false);
                        turnstileRef.current?.reset();
                      }}
                    />
                  )}
                  <ParkButton type="button" variant="outline" aria-disabled={creatingTicket}
                    onClick={() => { if (!creatingTicket) setIsCreating(false); }}>Cancel</ParkButton>
                  <ParkButton type="submit" aria-disabled={creatingTicket} variant="solid" className={p.ticketSubmit}>
                    {creatingTicket && <IconSpinner className={p.ticketSpinner} aria-hidden="true" />}
                    Create Ticket
                  </ParkButton>
                </div>
              </form>
            </ParkDialog.Body>
          </ParkDialog.Content>
        </ParkDialog.Positioner>
      </ParkDialog.Root>

      <div className={p.surface}>
        {tickets.length === 0 ? (
          <ParkEmptyState title="You haven't created any tickets yet." description="Create a ticket to start a conversation with support." action={<ParkButton type="button" onClick={() => { setCreateError(null); setIsCreating(true); }} variant="solid" className={p.ticketEmptyCreate}> <IconPlus className={p.ticketListIcon} aria-hidden="true" /> New Ticket</ParkButton>} className={p.ticketEmpty} />
        ) : (
          <ul className={p.ticketListItems}>
            {tickets.map((ticket) => (
              <li key={ticket.id} className={p.ticketListItem}>
                <ParkLink asChild variant="plain">
                  <RouterLink to={`/tickets/${ticket.id}`} className={p.ticketListLink}>
                  <div className={p.ticketListRow}>
                    <div className={[p.ticketRowMain, ticketRowMainWrap].join(' ')}>
                      <span className={p.ticketReference}>{ticketReference(ticket, ticketPrefix)}</span>
                      <h3 className={[p.ticketSubject, ticketSubjectWrap].join(' ')}>{ticket.subject}</h3>
                    </div>
                    <span className={[p.ticketStatus, statusColors[ticket.status]].join(' ')}>
                      {ticket.status}
                    </span>
                  </div>
                  <div className={p.ticketListMeta}>
                    <span>Created {formatDistanceToNow(utcTimestamp(ticket.created_at), { addSuffix: true })}</span>
                    <span>•</span>
                    <span className={p.ticketPriority}>Priority: {ticket.priority}</span>
                  </div>
                  </RouterLink>
                </ParkLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
