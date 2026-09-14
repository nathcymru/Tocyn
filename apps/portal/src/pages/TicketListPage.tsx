import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkEmptyState, ParkInput, ParkTextarea } from '@luminatick/ui/park';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { portalApi } from '../api/client';
import type { Ticket, PaginatedResponse } from '../types';
import {
  FaSpinner,
  FaPlus
} from '@luminatick/ui/icons';
import { formatDistanceToNow } from 'date-fns';
import { utcTimestamp } from '../utils/utcTimestamp';
import { ticketReference } from '../utils/ticket-reference';

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
    open: 'tocyn-status-open',
    pending: 'tocyn-status-pending',
    resolved: 'tocyn-status-resolved',
    closed: 'tocyn-status-closed',
  };

  if (loading) {
    return <ParkEmptyState role="status" title="Loading tickets…" headingLevel={false} aria-busy="true" className="tocyn-portal-ticket-loading" />;
  }

  if (error) {
    return <ParkEmptyState role="alert" title="Tickets could not be loaded." description={error} headingLevel={false} className="tocyn-portal-ticket-error" action={<ParkButton type="button" onClick={retryTickets} className="tocyn-portal-ticket-retry">Retry loading tickets</ParkButton>} />;
  }

  return (
    <div className="tocyn-portal-ticket-list">
      <div className="tocyn-portal-ticket-list-header">
        <h1 ref={listHeading} tabIndex={-1} className="tocyn-portal-ticket-list-title">Your Tickets</h1>
        <ParkButton
          ref={createButton}
          type="button"
          onClick={() => { setCreateError(null); setIsCreating(true); }}
          className="tocyn-portal-ticket-list-create"
        >
          <FaPlus className="tocyn-portal-ticket-list-icon" />
          New Ticket
        </ParkButton>
      </div>

      <p role="status" aria-live="polite" className="tocyn-portal-ticket-list-status">{createStatus}</p>
      <TocynDialog open={isCreating} onOpenChange={setIsCreating} busy={creatingTicket}
          labelledBy="create-ticket-heading" initialFocusEl={() => subjectInput.current} finalFocusEl={() => createButton.current}
          className="tocyn-portal-ticket-dialog">
          <h2 id="create-ticket-heading" className="tocyn-portal-ticket-dialog-title">Create New Ticket</h2>
          {createError && <p id="create-ticket-error" role="alert" className="tocyn-portal-ticket-dialog-error">{createError}</p>}
          <p role="status" aria-live="polite" className="tocyn-portal-ticket-dialog-status">{creatingTicket ? 'Creating ticket…' : ''}</p>
          <form aria-busy={creatingTicket} onSubmit={handleCreate} className="tocyn-portal-ticket-form">
            <div className="tocyn-portal-ticket-field">
              <label htmlFor="create-ticket-subject" className="tocyn-portal-ticket-field-label">Subject</label>
              <ParkInput
                id="create-ticket-subject"
                ref={subjectInput}
                readOnly={creatingTicket}
                aria-describedby={createError ? "create-ticket-error" : undefined}
                type="text"
                required
                value={newSubject}
                onChange={(e) => { if (!creatingTicket) setNewSubject(e.target.value); }}
                className="tocyn-portal-ticket-field-input"
                placeholder="What do you need help with?"
              />
            </div>
            <div className="tocyn-portal-ticket-field">
              <label htmlFor="create-ticket-message" className="tocyn-portal-ticket-field-label">Message</label>
              <ParkTextarea
                id="create-ticket-message"
                readOnly={creatingTicket}
                aria-describedby={createError ? "create-ticket-error" : undefined}
                required
                rows={4}
                value={newMessage}
                onChange={(e) => { if (!creatingTicket) setNewMessage(e.target.value); }}
                className="tocyn-portal-ticket-field-input"
                placeholder="Describe your issue in detail..."
              />
            </div>
            <div className="tocyn-portal-ticket-actions">
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
              <ParkButton
                type="button"
                aria-disabled={creatingTicket}
                onClick={() => { if (!creatingTicket) setIsCreating(false); }}
                className="tocyn-portal-ticket-cancel"
              >
                Cancel
              </ParkButton>
              <ParkButton
                type="submit"
                aria-disabled={creatingTicket}
                className="tocyn-portal-ticket-submit"
              >
                {creatingTicket && <FaSpinner className="tocyn-portal-ticket-spinner" />}
                Create Ticket
              </ParkButton>
            </div>
          </form>
      </TocynDialog>

      <div className="tocyn-portal-surface">
        {tickets.length === 0 ? (
          <ParkEmptyState title="You haven't created any tickets yet." description="Create a ticket to start a conversation with support." action={<ParkButton type="button" onClick={() => { setCreateError(null); setIsCreating(true); }} className="tocyn-portal-ticket-empty-create"> <FaPlus className="tocyn-portal-ticket-list-icon" /> New Ticket</ParkButton>} className="tocyn-portal-ticket-empty" />
        ) : (
          <ul className="tocyn-portal-ticket-list-items">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="tocyn-portal-ticket-list-item">
                <Link to={`/tickets/${ticket.id}`} className="tocyn-portal-ticket-list-link">
                  <div className="tocyn-portal-ticket-list-row">
                    <div className="tocyn-portal-ticket-row-main">
                      <span className="tocyn-portal-ticket-reference">{ticketReference(ticket, ticketPrefix)}</span>
                      <h3 className="tocyn-portal-ticket-subject">{ticket.subject}</h3>
                    </div>
                    <span className={`tocyn-portal-ticket-status ${statusColors[ticket.status]}`}>
                      {ticket.status}
                    </span>
                  </div>
                  <div className="tocyn-portal-ticket-list-meta">
                    <span>Created {formatDistanceToNow(utcTimestamp(ticket.created_at), { addSuffix: true })}</span>
                    <span>•</span>
                    <span className="tocyn-portal-ticket-priority">Priority: {ticket.priority}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
