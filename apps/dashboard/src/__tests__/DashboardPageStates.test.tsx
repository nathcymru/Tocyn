import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardPage } from '../pages/DashboardPage';

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown>, refetch: vi.fn() }));
vi.mock('../hooks/useStats', () => ({ useStats: () => ({ ...state.current, refetch: state.refetch }) }));
afterEach(() => { cleanup(); state.current = {}; state.refetch.mockReset(); });
const show = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);

it('shows the dashboard shape with Park skeletons while metrics load', () => {
  state.current = { isLoading: true, isError: false, isFetching: true };
  show();
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  const loading = screen.getByRole('status', { name: 'Loading dashboard metrics' });
  expect(loading).toHaveAttribute('aria-busy', 'true');
  expect(loading.querySelectorAll('.skeleton')).toHaveLength(14);
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it('shows a retryable Park empty state when metrics fail instead of false zeroes', () => {
  state.current = { isLoading: false, isError: true, isFetching: false };
  show();
  expect(screen.getByRole('alert')).toHaveTextContent('Dashboard metrics unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard metrics' }));
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(screen.queryByText('Total Tickets')).not.toBeInTheDocument();
});

it('retains last loaded metrics and an inline retry after a background refresh fails', () => {
  state.current = { isLoading: false, isError: true, isFetching: false,
    data: { ticketsByStatus: [{ status: 'open', count: 3 }, { status: 'pending', count: 2 }],
      ticketsByPriority: [{ priority: 'high', count: 5 }], totalUsers: 4, totalGroups: 1 } };
  show();
  expect(screen.getByRole('alert')).toHaveTextContent('Showing the last loaded values');
  expect(screen.getByText('Total Tickets').closest('.card__root')).toHaveTextContent('5');
  expect(screen.getByText('Open Tickets').closest('.card__root')).toHaveTextContent('3');
  expect(screen.getByText('Tickets by Priority').closest('.card__root')).toHaveTextContent('high');
  fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard metrics' }));
  expect(state.refetch).toHaveBeenCalledOnce();
});

it('keeps zero-valued metrics but gives an actionable priority empty state', () => {
  state.current = { isLoading: false, isError: false, isFetching: false,
    data: { ticketsByStatus: [], ticketsByPriority: [], totalUsers: 1, totalGroups: 0 } };
  show();
  expect(screen.getByText('No ticket activity yet')).toBeInTheDocument();
  expect(screen.getByText('Total Tickets')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Open Inbox' })).toHaveLength(2);
  expect(screen.queryByText('urgent')).not.toBeInTheDocument();
});
