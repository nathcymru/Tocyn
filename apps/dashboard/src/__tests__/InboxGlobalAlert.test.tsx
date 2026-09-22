import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { GlobalPriorityAlertBridge, InboxGlobalAlertProvider, useInboxGlobalAlert } from '../components/InboxGlobalAlert';
import { useAuthStore } from '../store/authStore';

afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.unstubAllGlobals(); });

function Trigger() {
  const setAlert = useInboxGlobalAlert();
  return <><button type="button" onClick={() => setAlert({ count: 2, scope: 'All tickets' })}>Show inbox alert</button>
    <button type="button" onClick={() => setAlert({ count: 2, scope: 'All tickets', kind: 'priority-triage' })}>Show priority alert</button>
    <button type="button" onClick={() => setAlert({ count: 3, scope: 'All tickets', kind: 'priority-triage' })}>Change priority count</button>
    <button type="button" onClick={() => setAlert({ count: 0, scope: 'All tickets', kind: 'priority-triage' })}>Clear priority alert</button>
    <button type="button" onClick={() => setAlert(null)}>Report read failure</button></>;
}

it('uses Park Alert anatomy and keeps the assertive notice dismissible in document flow', () => {
  render(<InboxGlobalAlertProvider><Trigger /><p>Workspace remains available</p></InboxGlobalAlertProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Show inbox alert' }));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveClass('alert__root', 'alert__root--status_error', 'alert__root--variant_surface');
  expect(alert).toHaveAttribute('aria-live', 'assertive');
  expect(alert.querySelector('.alert__description')).toHaveTextContent('Action required: 2 overdue unassigned conversations in All tickets.');
  expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText('Workspace remains available')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss inbox alert' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Workspace remains available')).toBeInTheDocument();
});

it('labels expired fixed-hour triage clocks separately from contractual SLA breaches', () => {
  render(<InboxGlobalAlertProvider><Trigger /></InboxGlobalAlertProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Show priority alert' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Action required: 2 fixed-hour priority countdowns have expired in All tickets.');
});

it('keeps an unchanged priority alert mounted and respects dismissal until the count changes', () => {
  render(<InboxGlobalAlertProvider><Trigger /></InboxGlobalAlertProvider>);
  const show = screen.getByRole('button', { name: 'Show priority alert' });
  fireEvent.click(show);
  const original = screen.getByRole('alert');
  fireEvent.click(show);
  expect(screen.getByRole('alert')).toBe(original);

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss inbox alert' }));
  fireEvent.click(show);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change priority count' }));
  expect(screen.getByRole('alert')).toHaveTextContent('3 fixed-hour priority countdowns');
  fireEvent.click(screen.getByRole('button', { name: 'Clear priority alert' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(show);
  expect(screen.getByRole('alert')).toHaveTextContent('2 fixed-hour priority countdowns');
});

it('clears a previously confirmed calendar-SLA alert when its read fails', () => {
  render(<InboxGlobalAlertProvider><Trigger /></InboxGlobalAlertProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Show inbox alert' }));
  expect(screen.getByRole('alert')).toHaveTextContent('2 overdue unassigned conversations');
  fireEvent.click(screen.getByRole('button', { name: 'Report read failure' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show inbox alert' }));
  expect(screen.getByRole('alert')).toHaveTextContent('2 overdue unassigned conversations');
});

it('keeps a global priority alert above route-local SLA changes', () => {
  render(<InboxGlobalAlertProvider><Trigger /></InboxGlobalAlertProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Show inbox alert' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show priority alert' }));
  expect(screen.getByRole('alert')).toHaveTextContent('2 fixed-hour priority countdowns');
  fireEvent.click(screen.getByRole('button', { name: 'Report read failure' }));
  expect(screen.getByRole('alert')).toHaveTextContent('2 fixed-hour priority countdowns');
});

it('does not display a previous operator’s overdue count after identity changes', async () => {
  const requests: Array<(response: Response) => void> = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { requests.push(resolve); })));
  const user = (id: string) => ({ id, tenant_id: `tenant-${id}`, email: `${id}@example.test`, full_name: id, role: 'admin', mfa_enabled: true });
  useAuthStore.getState().setAuth('session-a', user('a'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  function Shell() {
    const identity = useAuthStore(state => `${state.sessionGeneration}:${state.user?.tenant_id}:${state.user?.id}`);
    return <InboxGlobalAlertProvider key={identity}><GlobalPriorityAlertBridge /></InboxGlobalAlertProvider>;
  }
  render(<QueryClientProvider client={client}><Shell /></QueryClientProvider>);
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => { useAuthStore.getState().setAuth('session-b', user('b')); });
  await waitFor(() => expect(requests).toHaveLength(2));
  const reply = (count: number) => new Response(JSON.stringify({ scope: 'standard_queues', counts: {
    all: 20, actionable: 20, mine: 0, unassigned: 20, mentions: 0, drafts: 0, snoozed: 0,
  }, triageOverdueCount: count }), { headers: { 'Content-Type': 'application/json' } });
  await act(async () => { requests[0](reply(9)); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => { requests[1](reply(2)); });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('2 fixed-hour priority countdowns'));
  expect(screen.getByRole('alert')).not.toHaveTextContent('9 fixed-hour');
  client.clear();
});
