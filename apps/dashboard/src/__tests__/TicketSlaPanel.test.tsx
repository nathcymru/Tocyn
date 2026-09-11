import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketSlaPanel } from '../components/TicketSlaPanel';
import { TicketSlaActionBar } from '../components/TicketSlaActionBar';
import { ConversationSlaStatus } from '../components/ConversationSlaStatus';
import { fetchTicketSlaBatch, parseTicketSla, type SlaTarget, type TicketSla } from '../hooks/useTicketSla';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({ dashboardApi: { get: mocks.get, post: mocks.post } }));
afterEach(() => { cleanup(); mocks.get.mockReset(); mocks.post.mockReset(); });
function show(component = <TicketSlaPanel ticketId="synthetic-ticket"/>) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{component}</QueryClientProvider>);
}
const unavailable: SlaTarget = { state: 'unavailable', phase: 'unavailable', completedAt: null, dueAt: null, remainingWorkingMilliseconds: null, targetWorkingMilliseconds: null };
const running: SlaTarget = { state: 'on-track', phase: 'running', completedAt: null, dueAt: '2026-09-11T10:00:00.000Z', remainingWorkingMilliseconds: 60000, targetWorkingMilliseconds: 3600000 };

describe('SLA surfaces', () => {
  it('renders unavailable configuration and a breached deadline without private facts', async () => {
    mocks.get.mockResolvedValue({ response: unavailable, resolution: { ...running, state: 'breached', remainingWorkingMilliseconds: 0 }, handlerName: 'Case owner' });
    show();
    await waitFor(() => expect(screen.getByText('Not configured')).toBeTruthy());
    expect(screen.getByText(/Breached · deadline was/)).toBeTruthy();
    expect(screen.getByText('Handler: Case owner')).toBeTruthy();
    expect(document.body.textContent).not.toContain('waiting reason');
  });

  it('shows a completed response and frozen paused resolution instead of live due dates', async () => {
    mocks.get.mockResolvedValue({ response: { ...running, phase: 'completed', completedAt: '2026-09-11T09:00:00.000Z' },
      resolution: { ...running, phase: 'paused', dueAt: null, remainingWorkingMilliseconds: 90000 }, handlerName: null });
    show(<TicketSlaActionBar ticketId="synthetic-ticket"/>);
    await waitFor(() => expect(screen.getByText(/Completed on time/)).toBeTruthy());
    expect(screen.getByText('Paused · 2 working minutes remaining')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Due ');
    expect(screen.getByLabelText('SLA status')).toBeTruthy();
  });

  it('shows resolution due even when first response is not configured', () => {
    render(<ConversationSlaStatus sla={{ response: unavailable, resolution: running, handlerName: null }}/>);
    expect(screen.getByText(/^Due /)).toBeTruthy();
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('keeps a completed breach and missing projection visible through text', () => {
    const view = render(<ConversationSlaStatus sla={{ response: { ...running, state: 'breached', phase: 'completed', completedAt: '2026-09-11T11:00:00.000Z' }, resolution: unavailable, handlerName: null }}/>);
    expect(screen.getByText(/Completed after deadline/)).toBeTruthy();
    view.rerender(<ConversationSlaStatus sla={undefined}/>);
    expect(screen.getByText('Service level unavailable')).toBeTruthy();
  });

  it('treats malformed detail data as a query failure and recovers only after an explicit retry', async () => {
    mocks.get.mockResolvedValueOnce({ response: unavailable, handlerName: null }).mockResolvedValueOnce({ response: unavailable, resolution: running, handlerName: null });
    show();
    expect(await screen.findByText('Service level is unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/^Due /)).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

describe('SLA list coverage', () => {
  it('covers a full 50-row page with two bounded requests and de-duplicates IDs', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `ticket-${i}`);
    const sla: TicketSla = { response: unavailable, resolution: running, handlerName: null };
    mocks.post.mockImplementation(async (_path: string, body: { ticketIds: string[] }) => Object.fromEntries(body.ticketIds.map(id => [id, sla])));
    const result = await fetchTicketSlaBatch([...ids, ids[0]]);
    expect(Object.keys(result)).toEqual(ids);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls.map(call => call[1].ticketIds.length)).toEqual([25, 25]);
    expect(result['ticket-49']).toEqual(sla);
  });

  it('rejects a partial refresh if a later chunk fails, then recovers on retry', async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `ticket-${i}`);
    const sla: TicketSla = { response: unavailable, resolution: unavailable, handlerName: null };
    mocks.post.mockResolvedValueOnce({ 'ticket-0': sla }).mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(fetchTicketSlaBatch(ids)).rejects.toThrow('synthetic failure');
    mocks.post.mockImplementation(async (_path: string, body: { ticketIds: string[] }) => Object.fromEntries(body.ticketIds.map(id => [id, sla])));
    expect(Object.keys(await fetchTicketSlaBatch(ids))).toHaveLength(26);
  });

  it('rejects malformed projections instead of caching an invented SLA target', async () => {
    mocks.post.mockResolvedValue({ 'synthetic-ticket': { response: unavailable, resolution: { ...running, dueAt: 0 }, handlerName: null } });
    await expect(fetchTicketSlaBatch(['synthetic-ticket'])).rejects.toThrow('Malformed service level response');
    expect(() => parseTicketSla({ response: unavailable, resolution: { ...running, dueAt: 0 }, handlerName: null })).toThrow('Malformed service level response');
  });
});
