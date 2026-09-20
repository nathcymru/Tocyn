import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollaborationProvider } from '../components/CollaborationContext';
import { Layout } from '../components/layout/Layout';
import { InboxWorkspacePage } from '../pages/InboxWorkspacePage';
import { useAuthStore } from '../store/authStore';

class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = Socket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Socket.latest = this; }
  send() {}
  close() {}
  emit(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
}

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const ticket = {
  id: 'after-event', ticket_no: 63, subject: 'Authoritative post-event arrival',
  customer_email: 'customer@example.invalid', status: 'open', priority: 'normal',
  created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z',
};
const empty = { data: [], meta: { page: 1, limit: 20, total: 0, total_pages: 1 } };
const populated = { data: [ticket], meta: { page: 1, limit: 20, total: 1, total_pages: 1 } };
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  vi.stubGlobal('WebSocket', Socket);
  useAuthStore.getState().setAuth('synthetic-live-session', {
    id: 'operator', tenant_id: 'synthetic-tenant', full_name: 'Operator',
    email: 'operator@example.invalid', role: 'admin', mfa_enabled: true,
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  useAuthStore.getState().logout();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderInbox() {
  const router = createMemoryRouter([{
    path: '/', element: <Layout />,
    children: [{ path: 'inbox/*', element: <InboxWorkspacePage /> }],
  }], { initialEntries: ['/inbox/all'] });
  render(<QueryClientProvider client={client}><CollaborationProvider><RouterProvider router={router} /></CollaborationProvider></QueryClientProvider>);
}

function stubInboxApi(arrived: () => boolean, oldRead?: () => Promise<Response> | null) {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/workspace/state') return json({
      revision: 1, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '', listAnchor: 'page:1',
      selectedTicketId: null, panel: 'conversation', splitterRatio: 32, updatedAt: '2026-09-09T00:00:00Z',
    });
    if (url === '/api/workspace/presentation-preference') return json({
      version: 2, revision: 0, density: 'comfortable', fontScale: 'normal', focusMode: false,
      motion: 'system', navigation: 'labelled', contextDefault: 'remember', shortcutsEnabled: true,
      interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null,
    });
    if (url === '/api/workspace/theme-preference') return json({ revision: 0, mode: 'system', updatedAt: null });
    if (url === '/api/settings/theme') return json({ fallback: false, version: '1', light: {}, dark: {} });
    if (url === '/api/workspace/drafts?limit=50') return json({ items: [], next: null });
    if (url === '/api/settings/filters') return json([]);
    if (url === '/api/settings') return json({ TICKET_PREFIX: '#' });
    if (url === '/api/tickets/queue-counts') return json({ scope: 'standard_queues', counts: {
      all: arrived() ? 1 : 0, actionable: arrived() ? 1 : 0, mine: 0, unassigned: arrived() ? 1 : 0,
      mentions: 0, drafts: 0, snoozed: 0,
    } });
    if (url === '/api/ticket-sla/projections') return json({});
    if (url.startsWith('/api/tickets?')) {
      reads++;
      const stale = oldRead?.();
      return stale ?? json(arrived() ? populated : empty);
    }
    return json([]);
  }));
  return () => reads;
}

it.each(['ticket.updated', 'article.created'] as const)('reloads the active inbox from the API for %s instead of displaying event hints', async type => {
  let arrived = false;
  const reads = stubInboxApi(() => arrived);
  renderInbox();
  await screen.findByRole('heading', { name: 'No conversations in this view' });
  // The empty-state heading can render before workspace restoration enables
  // the list query. Measure event reads only after the initial API response.
  await waitFor(() => expect(client.getQueryCache().getAll().some(query =>
    query.queryKey[0] === 'tickets' && query.queryKey.length === 3
      && query.state.data !== undefined && query.state.fetchStatus === 'idle',
  )).toBe(true));
  const readsBeforeEvent = reads();
  arrived = true;
  act(() => Socket.latest.emit({ type, payload: type === 'article.created'
    ? { ticket_id: ticket.id, article_id: 'synthetic-article', subject: 'Untrusted event display hint' }
    : { id: ticket.id, subject: 'Untrusted event display hint' },
  }));
  const list = screen.getByRole('listbox', { name: 'Conversation list' });
  await within(list).findByRole('option', { name: /Authoritative post-event arrival/ });
  await waitFor(() => expect(reads()).toBe(readsBeforeEvent + 1));
  expect(screen.queryByText('Untrusted event display hint')).not.toBeInTheDocument();
});

it('replaces a pending stale inbox read after ticket.created and displays only the authoritative ticket', async () => {
  let releaseOldRead!: (response: Response) => void;
  const oldRead = new Promise<Response>(resolve => { releaseOldRead = resolve; });
  let holdOldRead = false;
  let arrived = false;
  const reads = stubInboxApi(() => arrived, () => {
    if (!holdOldRead) return null;
    holdOldRead = false;
    return oldRead;
  });

  renderInbox();
  await screen.findByRole('heading', { name: 'No conversations in this view' });
  await waitFor(() => expect(client.getQueryCache().getAll().some(query =>
    query.queryKey[0] === 'tickets' && query.queryKey.length === 3 && query.state.data !== undefined,
  )).toBe(true));
  const readsBeforePending = reads();
  holdOldRead = true;
  let pending!: Promise<void>;
  act(() => { pending = client.invalidateQueries({ queryKey: ['tickets'] }); });
  await waitFor(() => expect(reads()).toBeGreaterThan(readsBeforePending));

  arrived = true;
  const readsBeforeEvent = reads();
  act(() => Socket.latest.emit({ type: 'ticket.created', payload: {
    id: ticket.id, subject: 'Untrusted event display hint',
  } }));
  const list = screen.getByRole('listbox', { name: 'Conversation list' });
  await within(list).findByRole('option', { name: /Authoritative post-event arrival/ });
  await waitFor(() => expect(reads()).toBeGreaterThan(readsBeforeEvent));

  await act(async () => { releaseOldRead(json(empty)); await pending; });
  expect(within(list).getByRole('option', { name: /Authoritative post-event arrival/ })).toBeInTheDocument();
  expect(screen.queryByText('Untrusted event display hint')).not.toBeInTheDocument();
});

it('replaces a pending initial inbox read when a ticket is created', async () => {
  let releaseOldRead!: (response: Response) => void;
  const oldRead = new Promise<Response>(resolve => { releaseOldRead = resolve; });
  let holdOldRead = true;
  let arrived = false;
  const reads = stubInboxApi(() => arrived, () => {
    if (!holdOldRead) return null;
    holdOldRead = false;
    return oldRead;
  });

  renderInbox();
  await waitFor(() => expect(reads()).toBe(1));
  arrived = true;
  act(() => Socket.latest.emit({ type: 'ticket.created', payload: {
    id: ticket.id, subject: 'Untrusted event display hint',
  } }));

  const list = screen.getByRole('listbox', { name: 'Conversation list' });
  await within(list).findByRole('option', { name: /Authoritative post-event arrival/ });
  await waitFor(() => expect(reads()).toBeGreaterThan(1));
  await act(async () => { releaseOldRead(json(empty)); });
  expect(within(list).getByRole('option', { name: /Authoritative post-event arrival/ })).toBeInTheDocument();
  expect(screen.queryByText('Untrusted event display hint')).not.toBeInTheDocument();
});
