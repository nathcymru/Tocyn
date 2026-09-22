import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  return client;
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
  for (const label of ['State ID', 'Internal label', 'Customer-visible label']) {
    const input = screen.getByRole('textbox', { name: label });
    const field = input.closest('[data-scope="field"][data-part="root"]');
    expect(field).toHaveClass('field__root');
    expect(field?.querySelector('[data-scope="field"][data-part="label"]')).toHaveTextContent(label);
  }
  expect(screen.getByRole('combobox', { name: 'Legacy lifecycle' })).toHaveAttribute('data-scope', 'select');
  expect(screen.getByText('Legacy lifecycle').closest('[data-scope="select"][data-part="label"]')).toHaveClass('select__label');
  expect(screen.getByText('Waiting on customer').closest('[class*="card__root"]')).toBeInTheDocument();
  expect(screen.getByText('Customer label: We need your reply · Legacy lifecycle: pending')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('State ID'), { target: { value: 'awaiting-customer' } });
  fireEvent.change(screen.getByLabelText('Internal label'), { target: { value: 'Still waiting' } });
  fireEvent.change(screen.getByLabelText('Customer-visible label'), { target: { value: 'We need an update' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create state' }));
  const saveError = await screen.findByRole('alert');
  expect(saveError).toHaveClass('alert__root', 'alert__root--status_error');
  expect(saveError.querySelector('.alert__description')).toHaveTextContent('Duplicate state ID');
  expect(screen.getByLabelText('Internal label')).toHaveValue('Still waiting');
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate Waiting on customer' }));
  expect(screen.getByRole('combobox', { name: 'Replacement state' })).toHaveAttribute('data-scope', 'select');
  expect(screen.getByText('Replacement state').closest('[data-scope="select"][data-part="label"]')).toHaveClass('select__label');
  fireEvent.click(screen.getByRole('button', { name: 'Remap and deactivate' }));
  expect(screen.getByRole('alert').querySelector('.alert__description')).toHaveTextContent('Choose an active replacement');
  await userEvent.click(screen.getByRole('combobox', { name: 'Replacement state' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Open (open)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remap and deactivate' }));
  await waitFor(() => expect(requests).toContainEqual({ path: '/api/support-states/awaiting-customer/deactivate', body: { replacementId: 'legacy-open' } }));
  expect(await screen.findByRole('status')).toHaveClass('alert__root', 'alert__root--status_success');
  expect(screen.getByRole('status')).toHaveTextContent('was deactivated and active tickets were remapped');
});

it('uses a retryable empty state when initial definitions fail to load', async () => {
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (new URL(url, 'http://localhost').pathname === '/api/support-states' && options.method === 'GET') {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic initial failure');
      return json(states);
    }
    return json({});
  }));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Support states could not be loaded');
  expect(screen.queryByRole('button', { name: 'Create state' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading support states' }));
  expect(await screen.findByText('Waiting on customer')).toBeInTheDocument();
});

it('keeps cached definitions and identifies them as stale after a failed refresh', async () => {
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (new URL(url, 'http://localhost').pathname === '/api/support-states' && options.method === 'GET') {
      attempts += 1;
      if (attempts === 2) throw new Error('synthetic refresh failure');
      return json(states);
    }
    return json({});
  }));
  const client = renderPage();
  expect(await screen.findByText('Waiting on customer')).toBeInTheDocument();
  await act(async () => { await client.invalidateQueries({ queryKey: ['support-states'] }); });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Support states could not be refreshed');
  expect(alert).toHaveTextContent('last loaded version');
  expect(screen.getByText('Waiting on customer')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create state' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit Waiting on customer' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Deactivate Waiting on customer' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading support states' }));
  await waitFor(() => expect(screen.queryByText('Support states could not be refreshed')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Create state' })).toBeEnabled();
  expect(attempts).toBe(3);
});

it('keeps an unsaved first-state draft visible when a cached empty list fails to refresh', async () => {
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (new URL(url, 'http://localhost').pathname === '/api/support-states' && options.method === 'GET') {
      attempts += 1;
      if (attempts === 2) throw new Error('synthetic refresh failure');
      return json([]);
    }
    return json({});
  }));
  const client = renderPage();
  expect(await screen.findByText('No support states found.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('State ID'), { target: { value: 'first-state' } });
  fireEvent.change(screen.getByLabelText('Internal label'), { target: { value: 'First state draft' } });
  fireEvent.change(screen.getByLabelText('Customer-visible label'), { target: { value: 'We are working on this' } });

  await act(async () => { await client.invalidateQueries({ queryKey: ['support-states'] }); });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveClass('alert__root');
  expect(alert).toHaveTextContent('Support states could not be refreshed');
  expect(screen.getByRole('form', { name: 'Create support state' })).toBeInTheDocument();
  expect(screen.getByLabelText('State ID')).toHaveValue('first-state');
  expect(screen.getByLabelText('Internal label')).toHaveValue('First state draft');
  expect(screen.getByLabelText('Customer-visible label')).toHaveValue('We are working on this');
  expect(screen.getByRole('button', { name: 'Create state' })).toBeDisabled();
  expect(screen.queryByText('No support states found.')).not.toBeInTheDocument();
  expect(screen.queryByText('Support states could not be loaded')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading support states' }));
  await waitFor(() => expect(screen.queryByText('Support states could not be refreshed')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Internal label')).toHaveValue('First state draft');
  expect(screen.getByText('No support states found.')).toBeInTheDocument();
  expect(attempts).toBe(3);
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load more support states');
  expect(screen.getByRole('alert')).toHaveTextContent('definitions already shown are retained');
  expect(screen.getByText('Waiting on customer')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more support states' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading more support states' }));
  expect(await screen.findByText('Recovered replacement')).toBeInTheDocument();
  expect(screen.queryByText('Could not load more support states')).not.toBeInTheDocument();
});
