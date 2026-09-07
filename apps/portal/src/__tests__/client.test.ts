import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let portalApi: typeof import('../api/client').portalApi;

describe('Customer routing contract', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ portalApi } = await import('../api/client'));
    sessionStorage.clear(); localStorage.clear();
    window.history.replaceState({}, '', '/login?key=public-key-A');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({})}));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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

});
