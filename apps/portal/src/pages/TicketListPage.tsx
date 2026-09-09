import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { portalApi } from '../api/client';
import type { Ticket, PaginatedResponse } from '../types';
import { Loader2, Plus, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { utcTimestamp } from '../utils/utcTimestamp';

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
  const createDialog = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    if (!isCreating) return;
    const dialog = createDialog.current;
    const opener = createButton.current;
    dialog?.showModal();
    subjectInput.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [isCreating]);

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
    open: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    resolved: 'bg-gray-100 text-gray-800',
    closed: 'bg-gray-100 text-gray-800',
  };

  if (loading) {
    return <div role="status" className="flex justify-center py-12"><Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-brand-600" /><span className="sr-only">Loading tickets…</span></div>;
  }

  if (error) {
    return <div className="bg-red-50 text-red-700 p-4 rounded-lg">
      <p role="alert">{error}</p>
      <button type="button" onClick={retryTickets} className="mt-3 rounded border border-red-700 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Retry loading tickets</button>
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 ref={listHeading} tabIndex={-1} className="text-2xl font-bold text-gray-900">Your Tickets</h1>
        <button
          ref={createButton}
          type="button"
          onClick={() => { setCreateError(null); setIsCreating(true); }}
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <Plus className="w-5 h-5" />
          New Ticket
        </button>
      </div>

      <p role="status" aria-live="polite" className="text-sm text-gray-700">{createStatus}</p>
      {isCreating && (
        <dialog ref={createDialog} aria-labelledby="create-ticket-heading"
          onCancel={(event) => { event.preventDefault(); if (!creatingTicket) setIsCreating(false); }}
          className="w-full max-w-lg rounded-lg border border-gray-300 bg-white p-6 shadow-xl backdrop:bg-gray-900/40">
          <h2 id="create-ticket-heading" className="text-lg font-semibold mb-4">Create New Ticket</h2>
          {createError && <p id="create-ticket-error" role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-700">{createError}</p>}
          <p role="status" aria-live="polite" className="mb-3 text-sm text-gray-700">{creatingTicket ? 'Creating ticket…' : ''}</p>
          <form aria-busy={creatingTicket} onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="create-ticket-subject" className="block text-sm font-medium text-gray-700">Subject</label>
              <input
                id="create-ticket-subject"
                ref={subjectInput}
                readOnly={creatingTicket}
                aria-describedby={createError ? "create-ticket-error" : undefined}
                type="text"
                required
                value={newSubject}
                onChange={(e) => { if (!creatingTicket) setNewSubject(e.target.value); }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
                placeholder="What do you need help with?"
              />
            </div>
            <div>
              <label htmlFor="create-ticket-message" className="block text-sm font-medium text-gray-700">Message</label>
              <textarea
                id="create-ticket-message"
                readOnly={creatingTicket}
                aria-describedby={createError ? "create-ticket-error" : undefined}
                required
                rows={4}
                value={newMessage}
                onChange={(e) => { if (!creatingTicket) setNewMessage(e.target.value); }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-brand-500 focus:ring-brand-500 sm:text-sm"
                placeholder="Describe your issue in detail..."
              />
            </div>
            <div className="flex justify-end gap-3">
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
              <button
                type="button"
                aria-disabled={creatingTicket}
                onClick={() => { if (!creatingTicket) setIsCreating(false); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                aria-disabled={creatingTicket}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-md aria-disabled:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                {creatingTicket && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Ticket
              </button>
            </div>
          </form>
        </dialog>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">You haven't created any tickets yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="hover:bg-gray-50 transition-colors">
                <Link to={`/tickets/${ticket.id}`} className="block p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-500 font-mono">{ticketPrefix}{ticket.ticket_no}</span>
                      <h3 className="text-lg font-medium text-gray-900">{ticket.subject}</h3>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${statusColors[ticket.status]}`}>
                      {ticket.status}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-gray-500 flex items-center gap-4">
                    <span>Created {formatDistanceToNow(utcTimestamp(ticket.created_at), { addSuffix: true })}</span>
                    <span>•</span>
                    <span className="capitalize text-gray-700 font-medium">Priority: {ticket.priority}</span>
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
