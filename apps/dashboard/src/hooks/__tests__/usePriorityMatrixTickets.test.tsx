import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardApi } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { parsePriorityMatrixPage, usePriorityMatrixTickets, type PriorityMatrixSort, type PriorityMatrixTicketQueryPage } from '../usePriorityMatrixTickets';
import { useTickets } from '../useTickets';

vi.mock('../../api/client', async () => ({ ...await vi.importActual<typeof import('../../api/client')>('../../api/client'),
  dashboardApi: { get: vi.fn() } }));

const operator = (tenant = 'tenant-a') => ({ id: 'operator', tenant_id: tenant, role: 'admin' as const,
  email: 'synthetic@example.invalid', full_name: 'Synthetic', mfa_enabled: true });
const unavailableSla = {
  response: { state: 'unavailable', phase: 'unavailable', completedAt: null, dueAt: null, remainingWorkingMilliseconds: null, targetWorkingMilliseconds: null },
  resolution: { state: 'unavailable', phase: 'unavailable', completedAt: null, dueAt: null, remainingWorkingMilliseconds: null, targetWorkingMilliseconds: null },
  handlerName: null,
};
const asOf = new Date().toISOString();
function page(number: number, snapshot = asOf, next: string | null = number === 1 ? 'signed-page-two' : null) {
  const id = `ticket-${number}`;
  return { data: [{ id, status: 'open', contract_sla_tier: 'alpha', criticality_tier: 4 }],
    meta: { page: number, limit: 1, total: 2, total_pages: 2 },
    sla: { [id]: unavailableSla },
    priorityClocks: { [id]: { remainingHours: number === 1 ? -0.25 : 0.5, paused: false, asOf: snapshot } },
    triageOverdueCount: 2, asOf: snapshot, next };
}

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.getState().setAuth('synthetic-session', operator());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().logout(); });

describe('priority matrix snapshot hook', () => {
  it('routes all three sort keys through the dedicated snapshot hook with authoritative clocks', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(page(1));
    for (const sort of ['priority_focus', 'priority_criticality', 'priority_commitment'] as PriorityMatrixSort[]) {
      const { result, unmount } = renderHook(() => useTickets({ sort, page: '1', customer_email: 'synthetic@example.invalid' }), { wrapper });
      await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
      const data = result.current.data as PriorityMatrixTicketQueryPage | undefined;
      expect(data?.priorityClocks['ticket-1']).toMatchObject({ remainingHours: -0.25, paused: false, asOf });
      expect(data?.triageOverdueCount).toBe(2);
      unmount();
    }
    expect(vi.mocked(dashboardApi.get).mock.calls.map(([path]) => new URLSearchParams(String(path).split('?')[1]).get('sort')))
      .toEqual(['priority_focus', 'priority_criticality', 'priority_commitment']);
  });

  it('uses a signed cursor for page two and rejects a changed snapshot', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(2, asOf));
    const { result, rerender } = renderHook(({ pageNumber }) => usePriorityMatrixTickets({ sort: 'priority_focus', page: pageNumber }, true),
      { wrapper, initialProps: { pageNumber: '1' } });
    await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
    rerender({ pageNumber: '2' });
    await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-2'));
    expect(vi.mocked(dashboardApi.get).mock.calls[1][0]).toContain('cursor=signed-page-two');

    vi.mocked(dashboardApi.get).mockResolvedValueOnce(page(2, new Date(Date.parse(asOf) + 1000).toISOString()));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 409, code: 'priority_sort_restart' });
    expect(result.current.data).toBeUndefined();
  });

  it('reads a fresh first page after remount before allowing its signed page-two cursor', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValueOnce(page(1, asOf, 'old-cursor'))
      .mockResolvedValueOnce(page(1, asOf, 'new-cursor')).mockResolvedValueOnce(page(2));
    const first = renderHook(() => usePriorityMatrixTickets({ sort: 'priority_focus', page: '1' }, true), { wrapper });
    await waitFor(() => expect(first.result.current.data?.data[0]?.id).toBe('ticket-1'));
    first.unmount();

    const second = renderHook(({ pageNumber }) => usePriorityMatrixTickets({ sort: 'priority_focus', page: pageNumber }, true),
      { wrapper, initialProps: { pageNumber: '1' } });
    await waitFor(() => expect(vi.mocked(dashboardApi.get)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.data?.data[0]?.id).toBe('ticket-1'));
    second.rerender({ pageNumber: '2' });
    await waitFor(() => expect(second.result.current.data?.data[0]?.id).toBe('ticket-2'));
    expect(vi.mocked(dashboardApi.get).mock.calls[2][0]).toContain('cursor=new-cursor');
  });

  it('does not reuse an earlier sort ledger when returning to that sort', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValueOnce(page(1, asOf, 'old-focus'))
      .mockResolvedValueOnce(page(1, asOf, 'criticality'))
      .mockResolvedValueOnce(page(1, asOf, 'new-focus')).mockResolvedValueOnce(page(2));
    const { result, rerender } = renderHook(({ sort, pageNumber }) => usePriorityMatrixTickets({ sort, page: pageNumber }, true),
      { wrapper, initialProps: { sort: 'priority_focus', pageNumber: '1' } });
    await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
    rerender({ sort: 'priority_criticality', pageNumber: '1' });
    await waitFor(() => expect(vi.mocked(dashboardApi.get)).toHaveBeenCalledTimes(2));
    rerender({ sort: 'priority_focus', pageNumber: '1' });
    await waitFor(() => expect(vi.mocked(dashboardApi.get)).toHaveBeenCalledTimes(3));
    rerender({ sort: 'priority_focus', pageNumber: '2' });
    await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-2'));
    expect(vi.mocked(dashboardApi.get).mock.calls[3][0]).toContain('cursor=new-focus');
  });

  it('schedules the next refresh from the snapshot time even after paging', async () => {
    const now = Date.now();
    const sampledAt = new Date(now - 25_000).toISOString();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    const intervals = vi.spyOn(window, 'setInterval');
    try {
      vi.mocked(dashboardApi.get).mockResolvedValueOnce(page(1, sampledAt)).mockResolvedValueOnce(page(2, sampledAt));
      const { result, rerender } = renderHook(({ pageNumber }) => usePriorityMatrixTickets({ sort: 'priority_focus', page: pageNumber }, true, () => {}),
        { wrapper, initialProps: { pageNumber: '1' } });
      await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
      expect(intervals.mock.calls.at(-1)?.[1]).toBe(5_000);
      rerender({ pageNumber: '2' });
      await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-2'));
      expect(intervals.mock.calls.at(-1)?.[1]).toBe(5_000);
    } finally {
      intervals.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('waits while hidden and makes one refresh when an expired snapshot becomes visible', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const dateNow = vi.spyOn(Date, 'now');
    try {
      const sampledAt = new Date().toISOString();
      vi.mocked(dashboardApi.get).mockResolvedValue(page(1, sampledAt));
      const { result } = renderHook(() => usePriorityMatrixTickets({ sort: 'priority_focus', page: '1' }, true), { wrapper });
      await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
      expect(dashboardApi.get).toHaveBeenCalledTimes(1);

      dateNow.mockReturnValue(Date.parse(sampledAt) + 31_000);
      visibility = 'hidden';
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(dashboardApi.get).toHaveBeenCalledTimes(1);
      visibility = 'visible';
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));
      expect(dashboardApi.get).toHaveBeenCalledTimes(2);
    } finally {
      dateNow.mockRestore();
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
      else Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('never reconstructs a page-two cursor from a restored page or another sort', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(page(1));
    const { result, rerender } = renderHook(({ sort, pageNumber }) => usePriorityMatrixTickets({ sort, page: pageNumber }, true),
      { wrapper, initialProps: { sort: 'priority_focus', pageNumber: '2' } });
    expect(result.current.error).toMatchObject({ code: 'priority_sort_restart' });
    expect(dashboardApi.get).not.toHaveBeenCalled();

    rerender({ sort: 'priority_focus', pageNumber: '1' });
    await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
    rerender({ sort: 'priority_criticality', pageNumber: '2' });
    expect(result.current.error).toMatchObject({ code: 'priority_sort_restart' });
    expect(dashboardApi.get).toHaveBeenCalledTimes(1);
  });

  it('rejects expired cursors before a second network request', async () => {
    vi.mocked(dashboardApi.get).mockResolvedValue(page(1, new Date(Date.now() - 31_000).toISOString()));
    const { result, rerender } = renderHook(({ pageNumber }) => usePriorityMatrixTickets({ sort: 'priority_focus', page: pageNumber }, true),
      { wrapper, initialProps: { pageNumber: '1' } });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    rerender({ pageNumber: '2' });
    await waitFor(() => expect(result.current.error).toMatchObject({ code: 'priority_sort_restart' }));
    expect(dashboardApi.get).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, partial and malformed clock maps without caching an invented value', () => {
    expect(() => parsePriorityMatrixPage({ ...page(1), priorityClocks: {} }, 1)).toThrow('Malformed priority queue row');
    expect(() => parsePriorityMatrixPage({ ...page(1), priorityClocks: { 'ticket-1': { remainingHours: NaN, paused: false, asOf } } }, 1))
      .toThrow('Malformed priority clock projection');
    expect(() => parsePriorityMatrixPage({ ...page(1), triageOverdueCount: -1 }, 1)).toThrow('Malformed priority queue response');
    expect(parsePriorityMatrixPage({ ...page(1), priorityClocks: { 'ticket-1': null } }, 1).priorityClocks['ticket-1']).toBeNull();
  });

  it('fences a late response after the tenant identity changes', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(dashboardApi.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(page(1));
    const { result } = renderHook(() => usePriorityMatrixTickets({ sort: 'priority_focus', page: '1' }, true), { wrapper });
    act(() => useAuthStore.setState({ user: operator('tenant-b') }));
    await waitFor(() => expect(result.current.data?.data[0]?.id).toBe('ticket-1'));
    await act(async () => finish(page(1, new Date(Date.parse(asOf) - 1000).toISOString())));
    expect(result.current.data?.asOf).toBe(asOf);
  });
});
