import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { TicketSlaStatus } from '../components/TicketSlaStatus';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { TicketSlaProjection } from '../types';

vi.mock('../api/client', () => ({ portalApi: { getTicketSla: vi.fn() } }));

const running = {
  state: 'on-track' as const,
  phase: 'running' as const,
  completedAt: null,
  dueAt: '2026-09-12T10:00:00.000Z',
  remainingWorkingMilliseconds: 60_000,
  targetWorkingMilliseconds: 120_000,
};

const unavailable = {
  state: 'unavailable' as const,
  phase: 'unavailable' as const,
  completedAt: null,
  dueAt: null,
  remainingWorkingMilliseconds: null,
  targetWorkingMilliseconds: null,
};

function projection(
  handlerName: string | null,
  response: TicketSlaProjection['response'] = running,
  resolution: TicketSlaProjection['resolution'] = unavailable,
) {
  return { handlerName, response, resolution };
}

function Deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function RouteStatus() {
  const { id } = useParams<{ id: string }>();
  return <><Link to="/tickets/second">Open second ticket</Link><TicketSlaStatus ticketId={id!} /></>;
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'customer-a', name: 'Customer', email: 'customer@example.test' }, isAuthenticated: true, isLoading: false, authGeneration: 1 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

describe('customer SLA status', () => {
  it('renders only the safe handler name and both target states', async () => {
    vi.mocked(portalApi.getTicketSla).mockResolvedValueOnce({
      ...projection('Avery Morgan', running, { ...running, state: 'breached', phase: 'paused', dueAt: null }),
      pauseReason: 'waiting for private verification',
      nextAction: 'call the customer',
      operatorId: 'operator-private-id',
    } as never);

    render(<TicketSlaStatus ticketId="owned-ticket" />);

    expect(await screen.findByRole('heading', { name: 'Service status' })).toBeInTheDocument();
    expect(screen.getByText('Responsible handler: Avery Morgan')).toBeInTheDocument();
    expect(screen.getByText('Response target')).toBeInTheDocument();
    expect(screen.getByText('Running — on target')).toBeInTheDocument();
    expect(screen.getByText('Resolution target')).toBeInTheDocument();
    expect(screen.getByText('Paused — target exceeded')).toBeInTheDocument();
    expect(screen.queryByText(/private verification|call the customer|operator-private-id/)).toBeNull();
    expect(portalApi.getTicketSla).toHaveBeenCalledWith('owned-ticket');
  });

  it('announces a failed status read and recovers only after an explicit retry', async () => {
    vi.mocked(portalApi.getTicketSla)
      .mockRejectedValueOnce(new Error('private service detail'))
      .mockResolvedValueOnce(projection(null));

    render(<TicketSlaStatus ticketId="owned-ticket" />);

    expect(await screen.findByText('Service status is unavailable. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('private service detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry service status' }));
    await screen.findByText('Response target');
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(portalApi.getTicketSla).toHaveBeenCalledTimes(2);
  });

  it('discards a prior ticket result after route navigation', async () => {
    const first = Deferred<ReturnType<typeof projection>>();
    const completed = { ...running, phase: 'completed' as const, completedAt: '2026-09-12T09:00:00.000Z' };
    vi.mocked(portalApi.getTicketSla).mockImplementation(ticketId => {
      if (ticketId === 'first') return first.promise as never;
      return Promise.resolve(projection('Second handler', completed)) as never;
    });

    render(<MemoryRouter initialEntries={['/tickets/first']}><Routes><Route path="/tickets/:id" element={<RouteStatus />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'Open second ticket' }));
    expect(await screen.findByText('Responsible handler: Second handler')).toBeInTheDocument();
    expect(screen.getByText('Completed — on target')).toBeInTheDocument();
    await act(async () => { first.resolve(projection('First private handler')); });
    expect(screen.queryByText('Responsible handler: First private handler')).toBeNull();
  });

  it('discards a response that finishes after the authenticated scope changes', async () => {
    const priorScope = Deferred<ReturnType<typeof projection>>();
    vi.mocked(portalApi.getTicketSla)
      .mockImplementationOnce(() => priorScope.promise as never)
      .mockResolvedValueOnce(projection('Current handler'));

    render(<TicketSlaStatus ticketId="owned-ticket" />);
    act(() => { useAuthStore.setState({ authGeneration: 2 }); });
    expect(await screen.findByText('Responsible handler: Current handler')).toBeInTheDocument();
    await act(async () => { priorScope.resolve(projection('Prior handler')); });
    await waitFor(() => expect(screen.queryByText('Responsible handler: Prior handler')).toBeNull());
  });

  it('does not refresh more often than the thirty-second customer status interval', async () => {
    vi.useFakeTimers();
    vi.mocked(portalApi.getTicketSla).mockResolvedValue(projection('Handler'));
    render(<TicketSlaStatus ticketId="owned-ticket" />);
    await act(async () => {});
    expect(portalApi.getTicketSla).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(portalApi.getTicketSla).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(portalApi.getTicketSla).toHaveBeenCalledTimes(2);
  });
});
