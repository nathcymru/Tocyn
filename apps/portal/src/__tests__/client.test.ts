import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portalApi } from '../api/client';

describe('Customer routing contract', () => {
  beforeEach(() => {
    sessionStorage.clear(); localStorage.clear();
    window.history.replaceState({}, '', '/login?key=public-key-A');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({})}));
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
});
