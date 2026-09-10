import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketListPage } from '../pages/TicketListPage';
import { useAuthStore } from '../store/authStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const operator = { id: 'operator', tenant_id: 'tenant-a', email: 'operator@example.invalid', full_name: 'Operator', role: 'admin', mfa_enabled: true };
const ticket = { id: 'ticket-with-draft', ticket_no: 12, subject: 'Saved workspace result', customer_email: 'customer@example.invalid', status: 'open', priority: 'normal', created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z' };
let client: QueryClient;
function Location() { const location = useLocation(); return <output data-testid="location">{`${location.pathname}${location.search}`}</output>; }
function showFeed(entry = '/tickets') {
  const router = createMemoryRouter([
    { path: '/tickets', element: <><TicketListPage/><Location/></> },
    { path: '/tickets/:id', element: <Location/> },
  ], { initialEntries: [entry] });
  render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
  return router;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  useAuthStore.setState({ token: null, user: null, mfaRequired: false, sessionGeneration: 0 });
  useAuthStore.getState().setAuth('tenant-session', operator);
});
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().logout(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('restores the scoped list query/filter/page, marks body-free draft results, and does not add search text to the URL', async () => {
  const ticketQueries: URLSearchParams[] = [];
  const workspaceWrites: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/workspace/state' && options.method === 'PUT') { workspaceWrites.push(JSON.parse(String(options.body))); return json({ revision: 5, view: 'all', sort: 'updated_desc', filters: { filterId: 'open-filter' }, listQuery: 'private search text', listAnchor: 'page:1', selectedTicketId: null, panel: 'conversation', updatedAt: '2026-09-11T00:00:00Z' }); }
    if (url === '/api/workspace/state') return json({ revision: 4, view: 'all', sort: 'updated_desc', filters: { filterId: 'open-filter' }, listQuery: 'server query', listAnchor: 'page:2', selectedTicketId: null, panel: 'conversation', updatedAt: '2026-09-11T00:00:00Z' });
    if (url === '/api/workspace/drafts?limit=50') return json({ items: [{ ticketId: ticket.id, updatedAt: '2026-09-11T00:00:00Z' }], next: null });
    if (url.startsWith('/api/tickets?')) { ticketQueries.push(new URL(url, 'http://localhost').searchParams); return json({ data: [ticket], meta: { page: Number(ticketQueries.at(-1)?.get('page')), limit: 1, total: 2, total_pages: 2 } }); }
    if (url === '/api/settings/filters') return json([{ id: 'open-filter', name: 'Awaiting response' }]);
    if (url === '/api/settings') return json({ TICKET_PREFIX: '#' });
    return json([]);
  }));
  showFeed();
  await screen.findByRole('link', { name: ticket.subject });
  await waitFor(() => expect(ticketQueries.at(-1)?.get('page')).toBe('2'));
  expect(ticketQueries.at(-1)?.get('filter_id')).toBe('open-filter');
  expect(ticketQueries.at(-1)?.get('search')).toBe('server query');
  expect(screen.getByRole('textbox', { name: 'Search tickets' })).toHaveValue('server query');
  expect(screen.getByRole('button', { name: 'Awaiting response' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Draft available')).toBeInTheDocument();
  const search = screen.getByRole('textbox', { name: 'Search tickets' });
  fireEvent.change(search, { target: { value: 'private search text' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(ticketQueries.at(-1)?.get('search')).toBe('private search text'));
  fireEvent.click(screen.getByRole('link', { name: ticket.subject }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/tickets/${ticket.id}`));
  expect(workspaceWrites).toHaveLength(1);
  expect(workspaceWrites[0]).toMatchObject({ expectedRevision: 4, listQuery: 'private search text', listAnchor: 'page:1' });
});

it('applies a legacy search URL once without restoring it over a later operator edit', async () => {
  const ticketQueries: URLSearchParams[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/workspace/state' && options.method === 'PUT') return json({ revision: 5, view: 'all', sort: 'updated_desc', filters: {}, listQuery: 'later query', listAnchor: 'page:1', selectedTicketId: null, panel: 'conversation', updatedAt: '2026-09-11T00:00:00Z' });
    if (url === '/api/workspace/state') return json({ revision: 4, view: 'all', sort: 'updated_desc', filters: {}, listQuery: 'server query', listAnchor: 'page:1', selectedTicketId: null, panel: 'conversation', updatedAt: '2026-09-11T00:00:00Z' });
    if (url === '/api/workspace/drafts?limit=50') return json({ items: [], next: null });
    if (url.startsWith('/api/tickets?')) { ticketQueries.push(new URL(url, 'http://localhost').searchParams); return json({ data: [ticket], meta: { page: 1, limit: 1, total: 1, total_pages: 1 } }); }
    if (url === '/api/settings') return json({ TICKET_PREFIX: '#' });
    return json([]);
  }));
  showFeed('/tickets?search=legacy%20query');
  const search = await screen.findByRole('textbox', { name: 'Search tickets' });
  await waitFor(() => expect(search).toHaveValue('legacy query'));
  fireEvent.change(search, { target: { value: 'later query' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(ticketQueries.at(-1)?.get('search')).toBe('later query'));
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(search).toHaveValue('later query');
});

it('keeps navigation on the list after an autosave has already failed', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/workspace/state') return options.method === 'PUT' ? json({ error: 'Unavailable' }, 503) : json(null);
    if (url.startsWith('/api/workspace/drafts')) return json({ items: [], next: null });
    if (url.startsWith('/api/tickets?')) return json({ data: [ticket], meta: { page: 1, limit: 20, total: 1, total_pages: 1 } });
    if (url === '/api/settings') return json({ TICKET_PREFIX: '#' });
    return json([]);
  }));
  showFeed();
  await screen.findByRole('link', { name: ticket.subject });
  const search = screen.getByRole('textbox', { name: 'Search tickets' });
  fireEvent.change(search, { target: { value: 'retained query' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await screen.findByText('Workspace preferences were not saved. Retry to keep this version.');
  fireEvent.click(screen.getByRole('link', { name: ticket.subject }));
  await screen.findByText('Workspace preferences are not saved. Stay on this list, retry saving, then navigate again.');
  expect(screen.getByTestId('location')).toHaveTextContent('/tickets');
  expect(screen.getByTestId('location')).not.toHaveTextContent(ticket.id);
  expect(search).toHaveValue('retained query');
});
