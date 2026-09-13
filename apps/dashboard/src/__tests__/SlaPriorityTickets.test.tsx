import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useSlaPriorityTickets } from '../hooks/useSlaPriorityTickets';

const operator = { id: 'operator', tenant_id: 'tenant-a', email: 'operator@example.invalid', full_name: 'Operator', role: 'admin', mfa_enabled: true };
let client: QueryClient;
let asOf: string;
function response(page = 1) {
  return { data: [{ id: `ticket-${page}`, subject: 'Synthetic queue row' }],
    meta: { page, limit: 1, total: 3, total_pages: 3 }, sla: { [`ticket-${page}`]: null }, asOf,
    next: page < 3 ? `signed-next-${page + 1}` : null };
}
function wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.getState().setAuth('synthetic-session', operator);
  asOf = new Date().toISOString();
});
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().logout(); vi.restoreAllMocks(); localStorage.clear(); });

it('uses the signed cursor, preserves cached previous pages, and refuses expired forward navigation', async () => {
  const get = vi.spyOn(dashboardApi, 'get').mockImplementation(async path => response(path.includes('signed-next-2') ? 2 : 1) as never);
  const { result, rerender } = renderHook(({ page }) => useSlaPriorityTickets({ page, limit: '1' }, true), { initialProps: { page: '1' }, wrapper });
  await waitFor(() => expect(result.current.data?.meta.page).toBe(1));
  rerender({ page: '2' });
  await waitFor(() => expect(result.current.data?.meta.page).toBe(2));
  expect(get.mock.calls[1][0]).toContain('cursor=signed-next-2');
  expect(get.mock.calls[1][0]).not.toContain('page=');
  rerender({ page: '1' });
  await waitFor(() => expect(result.current.data?.meta.page).toBe(1));
  expect(get).toHaveBeenCalledTimes(2);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(asOf) + 31_000);
  rerender({ page: '3' });
  await waitFor(() => expect(result.current.error).toMatchObject({ code: 'sla_sort_restart' }));
  expect(result.current.data).toBeUndefined();
  expect(get).toHaveBeenCalledTimes(2);
});

it('requires explicit restart for a restored page without a cursor, then reads page one', async () => {
  const get = vi.spyOn(dashboardApi, 'get').mockResolvedValue(response() as never);
  const { result, rerender } = renderHook(({ page }) => useSlaPriorityTickets({ page }, true), { initialProps: { page: '2' }, wrapper });
  expect(result.current.error).toMatchObject({ code: 'sla_sort_restart' });
  expect(get).not.toHaveBeenCalled();
  act(() => { result.current.restartSla(); rerender({ page: '1' }); });
  await waitFor(() => expect(result.current.data?.meta.page).toBe(1));
  expect(get).toHaveBeenCalledOnce();
});

it('does not reuse a cursor after the current-view filter changes', async () => {
  const get = vi.spyOn(dashboardApi, 'get').mockResolvedValue(response() as never);
  const { result, rerender } = renderHook(({ page, search }) => useSlaPriorityTickets({ page, search }, true), { initialProps: { page: '1', search: 'first' }, wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  rerender({ page: '2', search: 'different' });
  expect(result.current.error).toMatchObject({ code: 'sla_sort_restart' });
  expect(result.current.data).toBeUndefined();
  expect(get).toHaveBeenCalledOnce();
});

it('discards a late identity response and keeps the new identity result', async () => {
  let release!: (value: unknown) => void;
  const get = vi.spyOn(dashboardApi, 'get').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }) as never)
    .mockResolvedValue({ ...response(), data: [{ id: 'new-identity' }], sla: { 'new-identity': null } } as never);
  const { result } = renderHook(() => useSlaPriorityTickets({ page: '1' }, true), { wrapper });
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  act(() => useAuthStore.getState().setAuth('other-session', { ...operator, tenant_id: 'tenant-b' }));
  await waitFor(() => expect(result.current.data?.data[0].id).toBe('new-identity'));
  await act(async () => { release(response()); });
  expect(result.current.data?.data[0].id).toBe('new-identity');
  expect(client.getQueryCache().getAll().some(query => (query.state.data as any)?.data?.[0]?.id === 'ticket-1')).toBe(false);
});

it('rejects a page missing the matching same-asOf SLA projection', async () => {
  vi.spyOn(dashboardApi, 'get').mockResolvedValue({ ...response(), sla: {} } as never);
  const { result } = renderHook(() => useSlaPriorityTickets({ page: '1' }, true), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});

it('uses a fresh page-two cache key after an explicit first-page refresh', async () => {
  const get = vi.spyOn(dashboardApi, 'get').mockImplementation(async path => response(path.includes('cursor=') ? 2 : 1) as never);
  const { result, rerender } = renderHook(({ page }) => useSlaPriorityTickets({ page }, true), { initialProps: { page: '1' }, wrapper });
  await waitFor(() => expect(result.current.data?.meta.page).toBe(1));
  rerender({ page: '2' });
  await waitFor(() => expect(result.current.data?.meta.page).toBe(2));
  rerender({ page: '1' });
  asOf = new Date(Date.parse(asOf) + 1000).toISOString();
  await act(async () => { await result.current.refetch(); });
  rerender({ page: '2' });
  await waitFor(() => expect(result.current.data?.asOf).toBe(asOf));
  expect(get).toHaveBeenCalledTimes(4);
});

it('accepts an empty complete queue without inventing a page or projection', async () => {
  vi.spyOn(dashboardApi, 'get').mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, total_pages: 0 }, sla: {}, asOf, next: null } as never);
  const { result } = renderHook(() => useSlaPriorityTickets({ page: '1' }, true), { wrapper });
  await waitFor(() => expect(result.current.data?.meta.total).toBe(0));
  expect(result.current.error).toBeNull();
  expect(result.current.data?.data).toEqual([]);
});
