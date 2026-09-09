import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let useAuthStore: typeof import('../store/authStore').useAuthStore;
let portalApi: typeof import('../api/client').portalApi;

describe('Customer routing contract', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ portalApi } = await import('../api/client'));
    ({ useAuthStore } = await import('../store/authStore'));
    sessionStorage.clear(); localStorage.clear();
    window.history.replaceState({}, '', '/login?key=public-key-A');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({})}));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function downloadEffects() {
    const createObjectURL = vi.fn(() => 'blob:synthetic-download');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    return { createObjectURL, revokeObjectURL, click };
  }

  it('carries cookie credentials and the routing key through successful downloads when storage is unavailable', async () => {
    const effects = downloadEffects();
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('synthetic attachment'));
    await portalApi.download('/attachments/fixture/download', 'fixture.txt');
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('X-Widget-Key')).toBe('public-key-A');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(effects.click).toHaveBeenCalledTimes(1);
    expect(effects.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it.each([200, 401])('discards a previous-session download response with status %s without clearing the newer identity', async status => {
    const effects = downloadEffects();
    useAuthStore.getState().login({ id: 'prior', name: 'Prior', email: 'prior@example.invalid' });
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = portalApi.download('/attachments/fixture/download', 'fixture.txt');
    useAuthStore.getState().login({ id: 'current', name: 'Current', email: 'current@example.invalid' });
    finish(new Response('synthetic response', { status }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(useAuthStore.getState().user?.id).toBe('current');
    expect(effects.createObjectURL).not.toHaveBeenCalled();
    expect(effects.click).not.toHaveBeenCalled();
  });

  it('discards a blob that completes after logout without creating or clicking a download', async () => {
    const effects = downloadEffects();
    useAuthStore.getState().login({ id: 'prior', name: 'Prior', email: 'prior@example.invalid' });
    let finish!: (blob: Blob) => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200,
      blob: () => { started(); return new Promise<Blob>(resolve => { finish = resolve; }); },
    } as Response);
    const pending = portalApi.download('/attachments/fixture/download', 'fixture.txt');
    await reading;
    useAuthStore.getState().logout();
    finish(new Blob(['synthetic attachment']));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(effects.createObjectURL).not.toHaveBeenCalled();
    expect(effects.click).not.toHaveBeenCalled();
  });

  it('clears only the current unauthorized download session and does not create an artifact', async () => {
    const effects = downloadEffects();
    useAuthStore.getState().login({ id: 'current', name: 'Current', email: 'current@example.invalid' });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(portalApi.download('/attachments/fixture/download', 'fixture.txt')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(effects.createObjectURL).not.toHaveBeenCalled();
  });

  it.each(['missing', 'throws'])('clears a rejected cookie-only session when optional storage %s', async storageMode => {
    const effects = downloadEffects();
    useAuthStore.getState().login({ id: 'current', name: 'Current', email: 'current@example.invalid' });
    vi.stubGlobal('localStorage', storageMode === 'missing' ? undefined : {
      getItem: () => null, removeItem: () => { throw new Error('Optional storage blocked'); },
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(portalApi.download('/attachments/fixture/download', 'fixture.txt')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(effects.createObjectURL).not.toHaveBeenCalled();
  });

  it('retains the current session on an authorized request denial without creating an artifact', async () => {
    const effects = downloadEffects();
    useAuthStore.getState().login({ id: 'current', name: 'Current', email: 'current@example.invalid' });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(portalApi.download('/attachments/fixture/download', 'fixture.txt')).rejects.toMatchObject({ status: 403 });
    expect(useAuthStore.getState().user?.id).toBe('current');
    expect(effects.createObjectURL).not.toHaveBeenCalled();
  });

  it('carries the public key through config, request, and verification after navigation', async () => {
    await portalApi.get('/config');
    await portalApi.post('/auth/request',{email:'customer@example.test'});
    window.history.replaceState({}, '', '/verify');
    await portalApi.post('/auth/verify',{token:'captured-email-token'});
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(new Headers(call[1]?.headers).get('X-Widget-Key')).toBe('public-key-A');
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('retains the URL routing key through navigation when session storage throws', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    await portalApi.get('/config');
    window.history.replaceState({}, '', '/verify');
    await portalApi.post('/auth/verify', { token: 'captured-email-token' });
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(new Headers(call[1]?.headers).get('X-Widget-Key')).toBe('public-key-A');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uses configured routing and cookie auth when both storage APIs are unavailable', async () => {
    window.history.replaceState({}, '', '/login');
    vi.stubEnv('VITE_WIDGET_KEY', 'configured-key');
    vi.stubGlobal('sessionStorage', undefined);
    vi.stubGlobal('localStorage', undefined);
    await portalApi.get('/config');
    const call = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(call[1]?.headers).get('X-Widget-Key')).toBe('configured-key');
    expect(call[1]?.credentials).toBe('include');
  });

  it('does not let an earlier 401 clear a session established while that request was in flight', async () => {
    let resolveResponse: ((response: { ok: boolean; status: number }) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveResponse = resolve; }) as never);
    const pending = portalApi.get('/auth/me');
    useAuthStore.getState().login({ id: 'new-session', name: 'New session', email: 'customer@example.test' });
    resolveResponse?.({ ok: false, status: 401 });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: { id: 'new-session' } });
  });

});
