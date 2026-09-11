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
