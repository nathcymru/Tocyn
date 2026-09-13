import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, dashboardApi } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useTicketAssignment } from '../useTicketAssignment';
import { useTicket, useTickets } from '../useTickets';
vi.mock('../../api/client', async () => ({ ...await vi.importActual<typeof import('../../api/client')>('../../api/client'),
  dashboardApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const user = (tenant = 'a') => ({ id: 'admin', tenant_id: tenant, role: 'admin' as const, email: 'synthetic@example.test', full_name: 'Synthetic', mfa_enabled: true });
const auth = () => useAuthStore.getState().setAuth('synthetic', user());
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { vi.resetAllMocks(); auth(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().logout(); });
const outcome = { outcome: 'assigned', ownerId: 'operator', replayed: false };

it('reuses the exact same key/body for an uncertain action and refreshes after acknowledged replay', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(dashboardApi.post).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ ...outcome, replayed: true });
  const { result } = renderHook(() => useTicketAssignment('ticket', refresh), { wrapper });
  act(() => result.current.balance());
  await waitFor(() => expect(result.current.phase).toBe('uncertain'));
  act(() => result.current.balance()); expect(dashboardApi.post).toHaveBeenCalledTimes(1);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.phase).toBe('idle'));
  expect(vi.mocked(dashboardApi.post).mock.calls[1]).toEqual(vi.mocked(dashboardApi.post).mock.calls[0]);
  expect(refresh).toHaveBeenCalledOnce(); expect(result.current.message).toMatch(/Previous routing result/);
});

it('offers only refresh after an acknowledged action when ownership reload fails', async () => {
  const refresh = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue(undefined);
  vi.mocked(dashboardApi.post).mockResolvedValue({ outcome: 'no_capacity', ownerId: null, replayed: false });
  const { result } = renderHook(() => useTicketAssignment('ticket', refresh), { wrapper });
  act(() => result.current.balance()); await waitFor(() => expect(result.current.phase).toBe('refresh-error'));
  act(() => { result.current.retry(); result.current.balance(); }); expect(dashboardApi.post).toHaveBeenCalledOnce();
  act(() => result.current.refresh()); await waitFor(() => expect(result.current.phase).toBe('idle'));
  expect(result.current.message).toMatch(/at this attempt/); expect(refresh).toHaveBeenCalledTimes(2);
});

for (const boundary of ['ticket', 'tenant', 'generation'] as const) it(`discards late mutations across the ${boundary} boundary without cache or refresh effects`, async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refresh = vi.fn().mockResolvedValue(undefined), invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result, rerender } = renderHook(({ id }) => useTicketAssignment(id, refresh), { wrapper, initialProps: { id: 'one' } });
  act(() => result.current.balance());
  if (boundary === 'ticket') rerender({ id: 'two' });
  else act(() => boundary === 'tenant' ? useAuthStore.setState({ user: user('b') }) : auth());
  await act(async () => finish(outcome));
  expect(result.current.phase).toBe('idle'); expect(result.current.message).toBe('');
  expect(refresh).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
});

it('keeps override fields exact on uncertain retry, then requires explicit new CAS after conflict', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(dashboardApi.patch).mockRejectedValueOnce(new Error('uncertain')).mockRejectedValueOnce(new ApiError('changed', 409));
  const { result } = renderHook(() => useTicketAssignment('ticket', refresh), { wrapper });
  act(() => result.current.override('owner', null, 'Approved exception'));
  await waitFor(() => expect(result.current.phase).toBe('uncertain'));
  act(() => result.current.retry()); await waitFor(() => expect(result.current.phase).toBe('idle'));
  expect(vi.mocked(dashboardApi.patch).mock.calls[1]).toEqual(vi.mocked(dashboardApi.patch).mock.calls[0]);
  expect(refresh).toHaveBeenCalledOnce(); expect(result.current.message).toMatch(/entered values are retained/);
  vi.mocked(dashboardApi.patch).mockResolvedValue({ success: true, responsibleOwnerId: 'owner' });
  act(() => result.current.override('owner', 'current-owner', 'Approved exception'));
  await waitFor(() => expect(result.current.phase).toBe('idle'));
  expect(vi.mocked(dashboardApi.patch).mock.calls[2][1]).toEqual({ ownerId: 'owner', expectedOwnerId: 'current-owner', capacityOverride: { reason: 'Approved exception' } });
  expect(vi.mocked(dashboardApi.patch).mock.calls[2][2]).not.toEqual(vi.mocked(dashboardApi.patch).mock.calls[0][2]);
});

it('separates same-ID detail data by tenant and fences the old response even without generation change', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(dashboardApi.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ id: 'same', subject: 'New tenant', articles: [] });
  const { result } = renderHook(() => useTicket('same'), { wrapper });
  act(() => useAuthStore.setState({ user: user('b') }));
  await waitFor(() => expect(result.current.data?.subject).toBe('New tenant'));
  await act(async () => finish({ id: 'same', subject: 'Old tenant', articles: [] }));
  expect(result.current.data?.subject).toBe('New tenant');
  expect(client.getQueryData(['ticket', 'same', 'a', 'admin', 'admin', useAuthStore.getState().sessionGeneration])).toBeUndefined();
});


it('refetches an active queue after acknowledged assignment without repeating the mutation', async () => {
  vi.mocked(dashboardApi.get).mockResolvedValueOnce({ data: [{ id: 'ticket' }] }).mockResolvedValueOnce({ data: [] });
  vi.mocked(dashboardApi.post).mockResolvedValue(outcome);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => ({ queue: useTickets({ queue: 'unassigned' }), action: useTicketAssignment('ticket', refresh) }), { wrapper });
  await waitFor(() => expect(result.current.queue.data?.data).toHaveLength(1));
  act(() => result.current.action.balance());
  await waitFor(() => expect(result.current.action.phase).toBe('idle'));
  expect(result.current.queue.data?.data).toHaveLength(0);
  expect(dashboardApi.get).toHaveBeenCalledTimes(2); expect(dashboardApi.post).toHaveBeenCalledOnce();
});

it('does not reuse cached administrator detail after a direct same-generation role change', async () => {
  const generation = useAuthStore.getState().sessionGeneration;
  client.setQueryData(['ticket', 'same', 'a', 'admin', 'admin', generation], {
    pages: [{ id: 'same', subject: 'Cached admin detail', articles: [] }], pageParams: [undefined],
  });
  let finish!: (value: unknown) => void;
  vi.mocked(dashboardApi.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ id: 'same', subject: 'Current agent detail', articles: [] });
  const { result } = renderHook(() => useTicket('same'), { wrapper });
  expect(result.current.data?.subject).toBe('Cached admin detail');
  act(() => useAuthStore.setState(state => ({ user: { ...state.user!, role: 'agent' } })));
  expect(result.current.data?.subject).not.toBe('Cached admin detail');
  await waitFor(() => expect(result.current.data?.subject).toBe('Current agent detail'));
  await act(async () => finish({ id: 'same', subject: 'Late admin detail', articles: [] }));
  expect(result.current.data?.subject).toBe('Current agent detail');
});
