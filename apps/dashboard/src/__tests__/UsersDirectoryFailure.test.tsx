import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { UsersPage } from '../pages/UsersPage';
import { dashboardApi } from '../api/client';

vi.mock('../api/client', () => ({ dashboardApi: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows a durable load error without a false empty team and retries the real directory query', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Directory temporarily unavailable'))
    .mockResolvedValueOnce({ users: [{ id: 'operator', full_name: 'Synthetic operator', email: 'operator@example.test', role: 'agent' }], page: 1, limit: 20 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UsersPage /></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory temporarily unavailable');
  expect(screen.queryByText('No team members found')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry team members' }));
  expect(await screen.findByText('Synthetic operator')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(dashboardApi.get).toHaveBeenCalledTimes(2);
  expect(dashboardApi.get).toHaveBeenLastCalledWith('/users');
  client.clear();
});

it('retains confirmed user cards and offers a Park retry alert after a refresh failure', async () => {
  const directory = { users: [{ id: 'operator', full_name: 'Synthetic operator', email: 'operator@example.test', role: 'agent', mfa_enabled: true, created_at: '2026-09-10T00:00:00Z' }], page: 1, limit: 20 };
  vi.mocked(dashboardApi.get).mockResolvedValueOnce(directory)
    .mockRejectedValueOnce(new Error('Temporary directory refresh failure'))
    .mockResolvedValueOnce(directory);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UsersPage /></QueryClientProvider>);
  const userName = await screen.findByText('Synthetic operator');
  const card = userName.closest('.card__root');
  await act(async () => { await client.invalidateQueries({ queryKey: ['users'] }); });
  const refreshError = await screen.findByRole('alert');
  expect(refreshError).toHaveClass('alert__root');
  expect(refreshError).toHaveTextContent('Team members could not be refreshed');
  expect(card).toBeInTheDocument();
  expect(userName).toBeInTheDocument();
  expect(screen.queryByText('Team members are unavailable')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry team members' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByText('Synthetic operator')).toBe(userName);
  expect(dashboardApi.get).toHaveBeenCalledTimes(3);
  client.clear();
});
