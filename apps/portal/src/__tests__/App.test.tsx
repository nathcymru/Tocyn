import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import App from '../App';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn() } }));

describe('portal authentication bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/verify?token=normal-link');
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true, authGeneration: 0 });
  });
  afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

  it('does not let a stale bootstrap denial replace a completed normal verification', async () => {
    let rejectBootstrap: ((reason?: unknown) => void) | undefined;
    vi.mocked(portalApi.get).mockImplementation((path: string) => {
      if (path === '/auth/me') return new Promise((_, reject) => { rejectBootstrap = reject; });
      return Promise.resolve({ data: [] });
    });
    vi.mocked(portalApi.post).mockResolvedValue({
      user: { id: 'verified-customer', name: 'Verified', email: 'customer@example.test' }, token: 'fresh-session',
    });
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/tickets'));
    rejectBootstrap?.(new Error('Earlier bootstrap was unauthorized'));
    await waitFor(() => expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: { id: 'verified-customer' } }));
    expect(window.location.pathname).toBe('/tickets');
  });
});
