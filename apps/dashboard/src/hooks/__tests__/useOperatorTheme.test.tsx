import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';

vi.mock('../../store/authStore', () => {
  let state: any = { token: null, user: null, mfaRequired: false, sessionGeneration: 0 }; const listeners = new Set<() => void>();
  const hook = (selector: (value: any) => unknown) => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => selector(state));
  (hook as any).subscribe = (listener: (current: any, previous: any) => void) => { const wrapped = () => listener(state, state); listeners.add(wrapped); return () => listeners.delete(wrapped); };
  (hook as any).getState = () => ({ ...state, setAuth: (token: string, user: unknown) => { state = { ...state, token, user, sessionGeneration: state.sessionGeneration + 1 }; listeners.forEach(listener => listener()); }, logout: () => { state = { ...state, token: null, user: null, sessionGeneration: state.sessionGeneration + 1 }; listeners.forEach(listener => listener()); } });
  (hook as any).setState = (next: any) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  return { useAuthStore: hook };
});
import { useOperatorTheme } from '../useOperatorTheme';
import { useAuthStore } from '../../store/authStore';

const user = (id = 'operator', tenant_id = 'tenant-a') => ({ id, tenant_id, email: `${id}@example.invalid`, full_name: id, role: 'admin', mfa_enabled: true });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tenant = { version: '1', light: {}, dark: {}, fallback: false };
let value!: ReturnType<typeof useOperatorTheme>;
function Harness() { value = useOperatorTheme(); return <output data-testid="theme">{JSON.stringify({ mode: value.mode, resolved: value.resolvedMode, status: value.status, error: value.error, revision: value.revision })}</output>; }
function current() { return JSON.parse(screen.getByTestId('theme').textContent || '{}'); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }; vi.stubGlobal('localStorage', storage); useAuthStore.setState({ token: null, user: null, mfaRequired: false, sessionGeneration: 0 }); useAuthStore.getState().setAuth('session-a', user()); });
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('restores system mode and resolves validated light palette', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ revision: 0, mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant)));
  render(<Harness />); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', mode: 'system', resolved: 'light', revision: 0 }));
});

it('keeps an explicit mode and palette safe when the stored tenant response is corrupt', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ revision: 4, mode: 'dark', updatedAt: 'now' })).mockResolvedValueOnce(json({ version: 'bad', light: {}, dark: {}, fallback: false })));
  render(<Harness />); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', mode: 'dark', resolved: 'dark' })); expect(current().error).toMatch(/safe default/);
});

it('preserves a selected mode on save failure and exposes retry without claiming saved', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ revision: 2, mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant)).mockResolvedValueOnce(json({ error: 'failure' }, 503)).mockResolvedValueOnce(json({ revision: 3, mode: 'dark', updatedAt: 'now' })));
  render(<Harness />); await waitFor(() => expect(current().status).toBe('restored')); act(() => value.updateMode('dark')); await act(async () => { await value.save(); }); expect(current()).toMatchObject({ status: 'error', mode: 'dark' }); act(() => value.retry()); await waitFor(() => expect(current()).toMatchObject({ status: 'saved', mode: 'dark', revision: 3 }));
});

it('clears stale results when the authenticated tenant changes', async () => {
  let release!: (response: Response) => void; const pending = new Promise<Response>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(pending)); render(<Harness />); act(() => useAuthStore.getState().setAuth('session-b', user('other', 'tenant-b'))); expect(current().revision).toBe(0); release(json({ revision: 9, mode: 'dark', updatedAt: 'stale' })); await new Promise(resolve => setTimeout(resolve, 0)); expect(current().revision).toBe(0);
});

it('keeps an edit made during restore and uses the returned revision for its save', async () => {
  const preference = deferred<Response>();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetch = vi.fn().mockReturnValueOnce(preference.promise).mockResolvedValueOnce(json(tenant)).mockResolvedValueOnce(json({ revision: 8, mode: 'dark', updatedAt: 'saved' }));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  act(() => value.updateMode('dark'));
  preference.resolve(json({ revision: 7, mode: 'system', updatedAt: 'remote' }));
  await waitFor(() => expect(current()).toMatchObject({ status: 'unsaved', mode: 'dark', revision: 7 }));
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', mode: 'dark', revision: 8, resolved: 'dark' });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ expectedRevision: 7, mode: 'dark' });
});

it('does not let an older save response mark a newer choice as saved', async () => {
  const saved = deferred<Response>();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetch = vi.fn().mockResolvedValueOnce(json({ revision: 2, mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant)).mockReturnValueOnce(saved.promise).mockResolvedValueOnce(json({ revision: 4, mode: 'light', updatedAt: 'newer' }));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.updateMode('dark'));
  const firstSave = value.save();
  act(() => value.updateMode('light'));
  saved.resolve(json({ revision: 3, mode: 'dark', updatedAt: 'older' }));
  await act(async () => { await firstSave; });
  expect(current()).toMatchObject({ status: 'unsaved', mode: 'light', resolved: 'light', revision: 3 });
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', mode: 'light', revision: 4 });
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ expectedRevision: 3, mode: 'light' });
});

it('requires a restore after a compare-and-swap conflict', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ revision: 2, mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant))
    .mockResolvedValueOnce(json({ error: 'conflict' }, 409)).mockResolvedValueOnce(json({ revision: 5, mode: 'system', updatedAt: 'remote' })).mockResolvedValueOnce(json(tenant))
    .mockResolvedValueOnce(json({ revision: 6, mode: 'light', updatedAt: 'saved' })));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.updateMode('dark'));
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'conflict', mode: 'dark' });
  act(() => value.updateMode('light'));
  expect(current()).toMatchObject({ status: 'conflict', mode: 'dark' });
  act(() => value.restore());
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', mode: 'system', revision: 5 }));
  act(() => value.updateMode('light'));
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', mode: 'light', revision: 6 });
});

it('clears prior state after permission denial and does not retry blindly', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetch = vi.fn().mockResolvedValueOnce(json({ revision: 4, mode: 'dark', updatedAt: 'previous' })).mockResolvedValueOnce(json(tenant)).mockResolvedValueOnce(json({ error: 'revoked' }, 403));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', mode: 'dark', revision: 4 }));
  act(() => value.updateMode('light'));
  await act(async () => { await value.save(); });
  await waitFor(() => expect(current()).toMatchObject({ status: 'error', mode: 'system', revision: 0, resolved: 'dark' }));
  expect(current().error).toMatch(/no longer available/);
  act(() => value.retry());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects malformed preferences instead of treating them as an authoritative revision zero', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetch = vi.fn().mockResolvedValueOnce(json({ revision: '0', mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'error', revision: 0 }));
  act(() => value.updateMode('dark'));
  await act(async () => { await value.save(); });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not save while a known revision is being refreshed, then saves the retained edit against the refresh revision', async () => {
  const refreshedPreference = deferred<Response>();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetch = vi.fn().mockResolvedValueOnce(json({ revision: 2, mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant))
    .mockReturnValueOnce(refreshedPreference.promise).mockResolvedValueOnce(json(tenant)).mockResolvedValueOnce(json({ revision: 4, mode: 'dark', updatedAt: 'saved' }));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 2 }));
  act(() => value.restore());
  act(() => value.updateMode('dark'));
  await act(async () => { await value.save(); });
  expect(fetch).toHaveBeenCalledTimes(4);
  refreshedPreference.resolve(json({ revision: 3, mode: 'system', updatedAt: 'refreshed' }));
  await waitFor(() => expect(current()).toMatchObject({ status: 'saved', mode: 'dark', revision: 4 }));
  expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ expectedRevision: 3, mode: 'dark' });
});

it('invalidates an older revision after a malformed refresh and preserves the local choice through retry recovery', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetch = vi.fn().mockResolvedValueOnce(json({ revision: 2, mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant))
    .mockResolvedValueOnce(json({ revision: 'bad', mode: 'system', updatedAt: null })).mockResolvedValueOnce(json(tenant))
    .mockResolvedValueOnce(json({ revision: 3, mode: 'system', updatedAt: 'recovered' })).mockResolvedValueOnce(json(tenant))
    .mockResolvedValueOnce(json({ revision: 4, mode: 'dark', updatedAt: 'saved' }));
  vi.stubGlobal('fetch', fetch);
  render(<Harness />);
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 2 }));
  act(() => value.restore());
  await waitFor(() => expect(current().status).toBe('error'));
  act(() => value.updateMode('dark'));
  await act(async () => { await value.save(); });
  expect(fetch).toHaveBeenCalledTimes(4);
  act(() => value.retry());
  await waitFor(() => expect(current()).toMatchObject({ status: 'unsaved', mode: 'dark', revision: 3 }));
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', mode: 'dark', revision: 4 });
});

it('uses the API client 401 path to clear the authenticated controller', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: 'expired' }, 401)).mockResolvedValueOnce(json(tenant)));
  render(<Harness />);
  await waitFor(() => expect(useAuthStore.getState().user).toBeNull());
  await waitFor(() => expect(current()).toMatchObject({ status: 'idle', revision: 0, mode: 'system' }));
});

it('coalesces repeated restores while one response is still pending', async () => {
  const preference = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(preference.promise).mockResolvedValueOnce(json(tenant)));
  render(<Harness />);
  act(() => { value.restore(); value.restore(); });
  expect(fetch).toHaveBeenCalledTimes(2);
  preference.resolve(json({ revision: 1, mode: 'system', updatedAt: null }));
  await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 1 }));
});

it('keeps system resolution consistent after save and operating-system changes', async () => {
  let listener!: (event: MediaQueryListEvent) => void;
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn((_: string, next: (event: MediaQueryListEvent) => void) => { listener = next; }), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ revision: 2, mode: 'dark', updatedAt: null })).mockResolvedValueOnce(json(tenant))
    .mockResolvedValueOnce(json({ revision: 3, mode: 'system', updatedAt: 'saved' })));
  render(<Harness />);
  await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.updateMode('system'));
  await act(async () => { await value.save(); });
  expect(current()).toMatchObject({ status: 'saved', mode: 'system', resolved: 'light', revision: 3 });
  act(() => listener({ matches: true } as MediaQueryListEvent));
  expect(current()).toMatchObject({ mode: 'system', resolved: 'dark', revision: 3 });
});
