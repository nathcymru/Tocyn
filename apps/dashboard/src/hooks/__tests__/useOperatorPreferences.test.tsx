import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';

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
  expect(current().status).toBe('unsaved');
});

it('surfaces a CAS conflict until the operator restores the current server record', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(preference(2))).mockResolvedValueOnce(json({ error: 'conflict' }, 409)).mockResolvedValueOnce(json(preference(4))));
  render(<Harness />); await waitFor(() => expect(current().status).toBe('restored'));
  act(() => value.update({ density: 'compact' })); await act(async () => { await value.save(); }); expect(current().status).toBe('conflict');
  act(() => value.restore()); await waitFor(() => expect(current()).toMatchObject({ status: 'restored', revision: 4, density: 'comfortable' }));
});
