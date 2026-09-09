import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { request } from '../api/client';
import { useAuthStore } from '../store/authStore';

const user = { id: 'synthetic-current', email: 'current@example.invalid', full_name: 'Current', role: 'admin', mfa_enabled: true };
const redirect = vi.fn();

beforeEach(() => {
  useAuthStore.getState().logout();
  redirect.mockClear();
  // Observe navigation intent without JSDOM's unsupported full-page navigation.
  vi.stubGlobal('window', { location: { set href(value: string) { redirect(value); } } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Invalid credentials' }, { status: 401 })));
});
afterEach(() => { vi.unstubAllGlobals(); useAuthStore.getState().logout(); localStorage.clear(); });

it.each([
  ['/tickets', 'GET'],
  ['/auth/mfa/verify', 'POST'],
  ['/auth/login', 'POST'],
])('invalidates an existing rejected session for %s %s', async (path, method) => {
  useAuthStore.getState().setAuth('synthetic-session', user);
  const generation = useAuthStore.getState().sessionGeneration;
  await expect(request(path, { method })).rejects.toMatchObject({ status: 401 });
  expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, sessionGeneration: generation + 1 });
  expect(redirect).toHaveBeenCalledExactlyOnceWith('/login');
});

it.each([
  ['/auth/login', 'GET'],
  ['/auth/login?other=true', 'POST'],
  ['/auth/login/extra', 'POST'],
])('does not exempt a signed-out request outside exact POST login: %s %s', async (path, method) => {
  const generation = useAuthStore.getState().sessionGeneration;
  await expect(request(path, { method })).rejects.toMatchObject({ status: 401 });
  expect(useAuthStore.getState().sessionGeneration).toBe(generation + 1);
  expect(redirect).toHaveBeenCalledExactlyOnceWith('/login');
});

it.each([200, 401])('discards a signed-out login response %s after a replacement session starts', async status => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = request('/auth/login', { method: 'POST' });
  useAuthStore.getState().setAuth('synthetic-replacement', user);
  finish(Response.json({ error: 'Invalid credentials', token: 'obsolete' }, { status }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(useAuthStore.getState().token).toBe('synthetic-replacement');
  expect(redirect).not.toHaveBeenCalled();
});
