import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode, useSyncExternalStore } from 'react';

vi.mock('../../store/authStore', () => {
  let state: any = { token: null, user: null, sessionGeneration: 0 }; const listeners = new Set<() => void>();
  const hook = (selector: (value: any) => unknown) => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => selector(state));
  (hook as any).subscribe = () => () => {}; (hook as any).getState = () => ({ ...state, setAuth: (token: string, user: unknown) => { state = { ...state, token, user, sessionGeneration: state.sessionGeneration + 1 }; listeners.forEach(listener => listener()); }, logout: () => { state = { ...state, token: null, user: null, sessionGeneration: state.sessionGeneration + 1 }; listeners.forEach(listener => listener()); } });
  (hook as any).setState = (next: any) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  return { useAuthStore: hook };
});
import { useOperatorPreferences } from '../useOperatorPreferences';
import { useAuthStore } from '../../store/authStore';

const user = { id: 'operator', tenant_id: 'tenant-a', email: 'operator@example.invalid', full_name: 'Operator', role: 'admin', mfa_enabled: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const preference = (revision = 0) => ({ version: 1, revision, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', updatedAt: null });
let value!: ReturnType<typeof useOperatorPreferences>;
function Harness() { value = useOperatorPreferences(); return <output data-testid="preferences">{JSON.stringify({ status: value.status, revision: value.revision, density: value.density, fontScale: value.fontScale, focusMode: value.focusMode, motion: value.motion, error: value.error })}</output>; }
function current() { return JSON.parse(screen.getByTestId('preferences').textContent || '{}'); }
beforeEach(() => { useAuthStore.setState({ token: null, user: null, sessionGeneration: 0 }); useAuthStore.getState().setAuth('session-a', user); });
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('restores only the validated server record and persists an edited choice with its CAS revision', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(preference())).mockResolvedValueOnce(json({ ...preference(1), density: 'compact', updatedAt: 'saved' })); vi.stubGlobal('fetch', fetch);
  render(<Harness />); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 0 }));
  act(() => value.update({ density: 'compact' })); await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', revision: 1, density: 'compact' });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ version: 1, expectedRevision: 0, density: 'compact', fontScale: 'normal', focusMode: false, motion: 'system' });
});

it('persists the explicit reduced-motion choice and exposes it to the workspace without remounting', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(preference())).mockResolvedValueOnce(json({ ...preference(1), motion: 'reduced', updatedAt: 'saved' })); vi.stubGlobal('fetch', fetch);
  render(<Harness />); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', motion: 'system' }));
  act(() => value.update({ motion: 'reduced' }));
  expect(current()).toMatchObject({ status: 'unsaved', motion: 'reduced' });
  expect(document.documentElement.dataset.tocynMotion).toBe('reduced');
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', revision: 1, motion: 'reduced' });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ version: 1, expectedRevision: 0, motion: 'reduced' });
});

it('retains the user choice when the system preference is reduced but the saved mode is explicit', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...preference(), motion: 'full' })));
  render(<Harness />); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', motion: 'full' }));
  expect(document.documentElement.dataset.tocynMotion).toBe('full');
});

it('rejects an old or corrupt server schema and requires recovery before a save', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ version: 99, revision: 3, density: 'compact', fontScale: 'large', focusMode: true, motion: 'reduced', updatedAt: 'old' })));
  render(<Harness />); await waitFor(() => expect(current()).toMatchObject({ status: 'error', revision: 0 }));
  act(() => value.update({ density: 'compact' })); await act(async () => { await value.save(); });
  expect(current().status).toBe('error');
  expect(current().error).toContain('Restore before saving');
});

it('restores after StrictMode effect replay without accepting the obsolete request', async () => {
  let finishFirst!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce(json({ ...preference(3), density: 'compact' }));
  vi.stubGlobal('fetch', fetch);
  render(<StrictMode><Harness /></StrictMode>);
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 3, density: 'compact' }));
  await act(async () => finishFirst(json(preference(1))));
  expect(current()).toMatchObject({ status: 'restored', revision: 3, density: 'compact' });
});

it('keeps recovery available after editing a malformed restore, then saves against the recovered revision', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ ...preference(), version: 99 }))
    .mockResolvedValueOnce(json(preference(4)))
    .mockResolvedValueOnce(json({ ...preference(5), density: 'compact' }));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('error'));
  act(() => value.update({ density: 'compact' }));
  expect(current()).toMatchObject({ status: 'error', density: 'compact' });
  await act(async () => { await value.save(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => value.retry());
  await waitFor(() => expect(current()).toMatchObject({ status: 'unsaved', revision: 4, density: 'compact' }));
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', revision: 5, density: 'compact' });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ expectedRevision: 4, density: 'compact' });
});

it('surfaces a CAS conflict until the operator restores the current server record', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(preference(2))).mockResolvedValueOnce(json({ error: 'conflict' }, 409)).mockResolvedValueOnce(json(preference(4))));
  render(<Harness />); await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.update({ density: 'compact' })); await act(async () => { await value.save(); }); expect(current().status).toBe('conflict');
  act(() => value.restore()); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 4, density: 'comfortable' }));
});

it('restores a saved preference after remounting instead of relying on in-memory state', async () => {
  let stored = preference();
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options.method === 'PUT') {
      const { expectedRevision, ...changes } = JSON.parse(options.body);
      stored = { ...stored, ...changes, revision: expectedRevision + 1 };
    }
    return json(stored);
  }));
  const view = render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.update({ motion: 'reduced', fontScale: 'larger', focusMode: true }));
  await act(async () => { await value.save(); });
  view.unmount();
  expect(document.documentElement.dataset.tocynMotion).toBeUndefined();
  expect(document.documentElement.dataset.tocynFontScale).toBeUndefined();
  render(<Harness />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 1, motion: 'reduced', fontScale: 'larger', focusMode: true }));
});

it('resets the old user text scale while the next identity restores its preferences', async () => {
  let finishRestore!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ...preference(1), fontScale: 'larger' }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishRestore = resolve; })));
  render(<Harness />);
  await waitFor(() => expect(document.documentElement.dataset.tocynFontScale).toBe('larger'));
  act(() => useAuthStore.getState().setAuth('session-b', { ...user, id: 'second-operator' }));
  expect(document.documentElement.dataset.tocynFontScale).toBe('normal');
  await act(async () => finishRestore(json({ ...preference(2), fontScale: 'large' })));
  expect(document.documentElement.dataset.tocynFontScale).toBe('large');
});

it.each([
  { id: 'second-operator', tenant_id: 'tenant-a' },
  { id: 'operator', tenant_id: 'tenant-b' },
])('discards the old restore when identity changes to $tenant_id/$id', async nextUser => {
  let finishOld!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(json({ ...preference(2), motion: 'reduced' })));
  render(<Harness />);
  act(() => useAuthStore.getState().setAuth('session-b', { ...user, ...nextUser }));
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 2, motion: 'reduced' }));
  await act(async () => finishOld(json({ ...preference(7), density: 'compact', motion: 'full' })));
  expect(current()).toMatchObject({ status: 'restored', revision: 2, density: 'comfortable', motion: 'reduced' });
});

it.each([
  { label: 'user', id: 'second-operator', tenant_id: 'tenant-a' },
  { label: 'tenant', id: 'operator', tenant_id: 'tenant-b' },
  { label: 'session', id: 'operator', tenant_id: 'tenant-a' },
])('discards an obsolete saved response after $label replacement', async nextUser => {
  let finishSave!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(preference(1)))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishSave = resolve; }))
    .mockResolvedValueOnce(json({ ...preference(3), motion: 'reduced' })));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.update({ density: 'compact', fontScale: 'larger' }));
  let pending!: Promise<void>;
  act(() => { pending = value.save(); });
  await waitFor(() => expect(current().status).toBe('saving'));
  act(() => useAuthStore.getState().setAuth('session-b', { ...user, id: nextUser.id, tenant_id: nextUser.tenant_id }));
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 3, motion: 'reduced' }));
  await act(async () => { finishSave(json({ ...preference(9), density: 'compact', fontScale: 'larger' })); await pending; });
  expect(current()).toMatchObject({ status: 'restored', revision: 3, density: 'comfortable', fontScale: 'normal', motion: 'reduced', error: null });
  expect(document.documentElement.dataset.tocynFontScale).toBe('normal');
  expect(document.documentElement.dataset.tocynMotion).toBe('reduced');
});
