import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InboxWorkspacePage } from '../pages/InboxWorkspacePage';
import { useAuthStore } from '../store/authStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const operator = {
  id: 'operator', tenant_id: 'tenant-a', email: 'operator@example.invalid',
  full_name: 'Operator', role: 'admin', mfa_enabled: true,
};
const ticket = {
  id: 'ticket-with-draft', ticket_no: 12, subject: 'Saved workspace result',
  customer_email: 'customer@example.invalid', status: 'open', priority: 'normal',
  snippet: 'The latest customer message remains visible.',
  created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z',
};
const workspace = {
  revision: 4, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '',
  listAnchor: 'page:1', selectedTicketId: null, panel: 'conversation',
  splitterRatio: 32, updatedAt: '2026-09-11T00:00:00Z',
};
const counts = {
  scope: 'standard_queues', counts: {
    all: 1, actionable: 1, mine: 0, unassigned: 1,
    mentions: 0, drafts: 0, snoozed: 0,
  }, triageOverdueCount: 0,
};
let client: QueryClient;
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}
function showInbox() {
  const router = createMemoryRouter([{
    path: '/inbox/*', element: <><InboxWorkspacePage /><Location /></>,
  }], { initialEntries: ['/inbox/all'] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
}
function stubApi(malformedSla: boolean, failSave: boolean) {
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url === '/api/workspace/state' && options.method === 'PUT') {
      writes.push(JSON.parse(String(options.body)));
      return failSave ? json({ error: 'Unavailable' }, 503) : json({ ...workspace, revision: 5 });
    }
    if (url === '/api/workspace/state') return json(workspace);
    if (url === '/api/workspace/drafts?limit=50') return json({ items: [], next: null });
    if (url === '/api/settings/filters') return json([]);
    if (url === '/api/settings') return json({ TICKET_PREFIX: '#' });
    if (url === '/api/tickets/queue-counts') return json(counts);
    if (url.startsWith('/api/tickets?')) return json({ data: [ticket], meta: { page: 1, limit: 20, total: 1, total_pages: 1 } });
    if (url === '/api/ticket-sla/projections') return json(malformedSla ? { [ticket.id]: ticket } : {});
    return json([]);
  }));
  return writes;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  useAuthStore.setState({ token: null, user: null, mfaRequired: false, sessionGeneration: 0 });
  useAuthStore.getState().setAuth('tenant-session', operator);
});
afterEach(() => {
  cleanup(); client.clear(); useAuthStore.getState().logout(); localStorage.clear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('keeps the active inbox route and retry action after workspace autosave fails', async () => {
  const writes = stubApi(false, true);
  showInbox();
  await screen.findByRole('option', { name: /Saved workspace result/ });
  fireEvent.click(screen.getByRole('button', { name: 'Filter tickets' }));
  await userEvent.click(screen.getByRole('button', { name: /^Sort:/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'newest first' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(writes.length).toBeGreaterThan(0));
  await screen.findByRole('button', { name: 'Retry saving view' });
  const workspaceAlert = screen.getByRole('alert');
  expect(workspaceAlert).toHaveClass('alert__root');
  expect(within(workspaceAlert).getByRole('button', { name: 'Retry saving view' })).toBeEnabled();
  fireEvent.click(screen.getByRole('link', { name: /Saved workspace result/ }));
  await screen.findByText('Workspace preferences are not saved. Stay in this view, retry saving, then navigate again.');
  expect(screen.getByTestId('location')).toHaveTextContent('/inbox/all');
  expect(screen.getByTestId('location')).not.toHaveTextContent(ticket.id);
  expect(screen.getByRole('button', { name: 'Retry saving view' })).toBeEnabled();
});

it('shows malformed batch SLA data as unavailable without asserting a breach', async () => {
  stubApi(true, false);
  showInbox();
  const row = await screen.findByRole('option', { name: /Saved workspace result/ });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/ticket-sla/projections')).toBe(true));
  expect(await screen.findByLabelText('Service level unavailable')).toBeInTheDocument();
  expect(within(row).queryByText('Overdue')).not.toBeInTheDocument();
  expect(document.querySelector('[data-part="inbox-page-metrics"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Quick statistics' }));
  const drawer = screen.getByRole('region', { name: 'Quick statistics' });
  expect(within(drawer).getByText('Overdue').parentElement).toHaveTextContent('—');
});
