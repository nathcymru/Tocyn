import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOperatorDraftIndicators, useOperatorWorkspaceState, type WorkspacePreference } from '../hooks/useOperatorWorkspaceState';
import { useAuthStore } from '../store/authStore';

const user = (id = 'operator', tenant_id = 'tenant-a') => ({ id, tenant_id, email: `${id}@example.invalid`, full_name: id, role: 'admin', mfa_enabled: true });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const stored = (revision = 7, listQuery = 'saved query'): WorkspacePreference => ({
  revision, view: 'mine', sort: 'created_asc', filters: { status: 'pending', groupId: 'group-a' }, listQuery, listAnchor: 'page:3', selectedTicketId: null, panel: 'details', updatedAt: '2026-09-11T00:00:00Z',
});
let workspace!: ReturnType<typeof useOperatorWorkspaceState>;
function Harness() {
  workspace = useOperatorWorkspaceState();
  return <output data-testid="workspace">{JSON.stringify({ status: workspace.status, query: workspace.listQuery, anchor: workspace.listAnchor, view: workspace.view, sort: workspace.sort, filters: workspace.filters, revision: workspace.revision, error: workspace.error })}</output>;
}
function current() { return JSON.parse(screen.getByTestId('workspace').textContent || '{}'); }
function IndicatorHarness() {
  const indicators = useOperatorDraftIndicators();
  return <output data-testid="indicators">{JSON.stringify({ status: indicators.status, ids: [...indicators.ticketIds] })}</output>;
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ token: null, user: null, mfaRequired: false, sessionGeneration: 0 });
  useAuthStore.getState().setAuth('session-a', user());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); useAuthStore.getState().logout(); localStorage.clear(); });

it('restores server preferences, preserves unmodified fields, and serializes later saves', async () => {
  const firstSave = deferred<Response>();
  const first = { ...stored(8, 'updated query'), listAnchor: 'page:4' };
  const second = { ...first, revision: 9, filters: { ...first.filters, filterId: 'filter-a' } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored())).mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(json(second)));
  render(<Harness />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', query: 'saved query', anchor: 'page:3', view: 'mine', sort: 'created_asc' }));
  act(() => workspace.update({ listQuery: 'updated query', listAnchor: 'page:4' }));
  const saving = workspace.saveNow();
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String((vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit).body))).toEqual({
    expectedRevision: 7, view: 'mine', sort: 'created_asc', filters: { status: 'pending', groupId: 'group-a' }, listQuery: 'updated query', listAnchor: 'page:4', selectedTicketId: null, panel: 'details',
  });
  act(() => workspace.update({ filters: { status: 'pending', groupId: 'group-a', filterId: 'filter-a' } }));
  await act(async () => { firstSave.resolve(json(first)); await saving; });
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3));
  expect(JSON.parse(String((vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit).body))).toMatchObject({ expectedRevision: 8, view: 'mine', sort: 'created_asc', listQuery: 'updated query', listAnchor: 'page:4', filters: { status: 'pending', groupId: 'group-a', filterId: 'filter-a' } });
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', revision: 9, query: 'updated query', filters: { filterId: 'filter-a' } }));
});

it('does not write defaults over an unknown failed restore and retries the restore first', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: 'Unavailable' }, 503)).mockResolvedValueOnce(json(stored())));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('error'));
  act(() => workspace.update({ listQuery: 'local during outage' }));
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  act(() => workspace.retrySave());
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(current()).toMatchObject({ status: 'unsaved', query: 'local during outage', view: 'mine' }));
});

it('keeps local state on CAS conflict until an explicit server restore', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored())).mockResolvedValueOnce(json({ error: 'Conflict' }, 409)).mockResolvedValueOnce(json(stored(10, 'other operator'))));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => workspace.update({ listQuery: 'local work' }));
  await act(async () => { await workspace.saveNow(); });
  expect(current()).toMatchObject({ status: 'conflict', query: 'local work' });
  act(() => workspace.restoreServerState());
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', query: 'other operator', revision: 10 }));
});

it('clears the prior authority immediately and fences its late restore', async () => {
  const late = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(late.promise).mockResolvedValueOnce(json(stored(2, 'new authority'))));
  render(<Harness />);
  act(() => useAuthStore.getState().setAuth('session-b', user('replacement', 'tenant-b')));
  expect(current().query).toBe('');
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', query: 'new authority', revision: 2 }));
  await act(async () => { late.resolve(json(stored(7, 'stale authority'))); });
  expect(current().query).toBe('new authority');
});

it('clears scoped state after an authorization denial and waits for a new restore before writing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored())).mockResolvedValueOnce(json({ error: 'Denied' }, 403)).mockResolvedValueOnce(json(stored(8, 'authorized again'))));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => workspace.update({ listQuery: 'sensitive local query' }));
  await act(async () => { await workspace.saveNow(); });
  expect(current()).toMatchObject({ status: 'error', query: '', filters: {}, revision: 0 });
  act(() => workspace.update({ listQuery: 'must not write yet' }));
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  act(() => workspace.retrySave());
  await waitFor(() => expect(current()).toMatchObject({ status: 'unsaved', query: 'must not write yet', view: 'mine', revision: 8 }));
});

it('flushes a pending preference before immediate navigation can unmount the controller', async () => {
  const saved = { ...stored(8, 'before navigation'), listAnchor: 'page:2' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(stored())).mockResolvedValueOnce(json(saved)));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => workspace.update({ listQuery: 'before navigation', listAnchor: 'page:2' }));
  await expect(workspace.flushBeforeNavigation()).resolves.toBe(true);
  expect(JSON.parse(String((vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ expectedRevision: 7, listQuery: 'before navigation', listAnchor: 'page:2' });
  expect(current()).toMatchObject({ status: 'saved', revision: 8 });
});

it('marks draft indicators partial after the bounded four-page query', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const after = new URL(url, 'http://localhost').searchParams.get('after') || 'start';
    return Promise.resolve(json({ items: [{ ticketId: after, updatedAt: '2026-09-11T00:00:00Z' }], next: `${after}-next` }));
  }));
  render(<IndicatorHarness />);
  await waitFor(() => expect(JSON.parse(screen.getByTestId('indicators').textContent || '{}').status).toBe('partial'));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
});
