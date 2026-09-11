import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupportStatesPage } from '../pages/SupportStatesPage';
import { useAuthStore } from '../store/authStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const states = [
  { id: 'awaiting-customer', legacy_status: 'pending', internal_label: 'Waiting on customer', public_label: 'We need your reply', waiting_reason_required: 1, next_action_required: 1, is_compatibility_default: 0, is_active: 1 },
  { id: 'legacy-open', legacy_status: 'open', internal_label: 'Open', public_label: 'Open', waiting_reason_required: 0, next_action_required: 0, is_compatibility_default: 1, is_active: 1 },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SupportStatesPage /></QueryClientProvider>);
}

beforeEach(() => {
  useAuthStore.getState().setAuth('synthetic-admin', { id: 'admin', tenant_id: 'tenant-a', email: 'admin@example.invalid', full_name: 'Admin', role: 'admin', mfa_enabled: true });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.unstubAllGlobals(); });

it('keeps labels distinct, retains failed input, and requires an explicit safe remap before deactivation', async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ path, body });
    if (path === '/api/support-states' && options.method === 'GET') return json(states);
    if (path === '/api/support-states' && options.method === 'POST') return json({ error: 'Duplicate state ID' }, 409);
    if (path === '/api/support-states/awaiting-customer/deactivate') return json({ success: true });
    return json({});
  }));
  renderPage();
  expect(await screen.findByText('Waiting on customer')).toBeInTheDocument();
  expect(screen.getByText('Customer label: We need your reply · Legacy lifecycle: pending')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('State ID'), { target: { value: 'awaiting-customer' } });
  fireEvent.change(screen.getByLabelText('Internal label'), { target: { value: 'Still waiting' } });
  fireEvent.change(screen.getByLabelText('Customer-visible label'), { target: { value: 'We need an update' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create state' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate state ID');
  expect(screen.getByLabelText('Internal label')).toHaveValue('Still waiting');
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate Waiting on customer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remap and deactivate' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose an active replacement');
  fireEvent.change(screen.getByLabelText('Replacement state'), { target: { value: 'legacy-open' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remap and deactivate' }));
  await waitFor(() => expect(requests).toContainEqual({ path: '/api/support-states/awaiting-customer/deactivate', body: { replacementId: 'legacy-open' } }));
});

it('does not expose state administration to an agent', () => {
  useAuthStore.getState().setAuth('synthetic-agent', { id: 'agent', tenant_id: 'tenant-a', email: 'agent@example.invalid', full_name: 'Agent', role: 'agent', mfa_enabled: true });
  renderPage();
  expect(screen.getByRole('alert')).toHaveTextContent('Only administrators');
  expect(screen.queryByRole('button', { name: 'Create state' })).not.toBeInTheDocument();
});

it('loads later definition pages explicitly for replacement choices', async () => {
  let page = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const request = new URL(url, 'http://localhost');
    if (request.pathname === '/api/support-states' && options.method === 'GET') {
      page += 1;
      if (page === 1) return new Response(JSON.stringify(states), { headers: { 'Content-Type': 'application/json', 'X-Next-Cursor': 'cursor-2' } });
      return new Response(JSON.stringify([{ ...states[0], id: 'late-state', internal_label: 'Late replacement' }]), { headers: { 'Content-Type': 'application/json' } });
    }
    return json({});
  }));
  renderPage();
  expect(await screen.findByText('Waiting on customer')).toBeInTheDocument();
  expect(screen.queryByText('Late replacement')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more support states' }));
  expect(await screen.findByText('Late replacement')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more support states' })).not.toBeInTheDocument();
});

it('keeps the first page and offers a retry when a later definition page fails', async () => {
  let laterPageAttempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const request = new URL(url, 'http://localhost');
    if (request.pathname === '/api/support-states' && options.method === 'GET') {
      if (!request.searchParams.has('cursor')) {
        return new Response(JSON.stringify(states), { headers: { 'Content-Type': 'application/json', 'X-Next-Cursor': 'cursor-2' } });
      }
      laterPageAttempts += 1;
      if (laterPageAttempts === 1) throw new Error('synthetic later-page failure');
      return json([{ ...states[0], id: 'recovered-state', internal_label: 'Recovered replacement' }]);
    }
    return json({});
  }));
  renderPage();
  expect(await screen.findByText('Waiting on customer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more support states' }));
  expect(await screen.findByText('Could not load more support states. Try again.')).toBeInTheDocument();
  expect(screen.getByText('Waiting on customer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more support states' }));
  expect(await screen.findByText('Recovered replacement')).toBeInTheDocument();
  expect(screen.queryByText('Could not load more support states. Try again.')).not.toBeInTheDocument();
});
