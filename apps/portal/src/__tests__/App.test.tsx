import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resolveTocynTheme } from '@luminatick/shared/ui-theme';
import App from '../App';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../api/client')>(), portalApi: { get: vi.fn(), post: vi.fn() } }));

describe('portal authentication bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-tocyn-theme-mode');
    document.documentElement.classList.remove('dark');
    window.history.replaceState(null, '', '/verify?token=normal-link');
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true, authGeneration: 0 });
  });
  afterEach(() => {
    cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-tocyn-theme-mode');
    document.documentElement.classList.remove('dark');
    window.history.replaceState(null, '', '/');
  });

  it('shows a Park skeleton and announced status while the protected session restores', () => {
    vi.mocked(portalApi.get).mockImplementation(() => new Promise(() => {}));
    window.history.replaceState(null, '', '/tickets');
    render(<App />);
    const loading = screen.getByRole('status', { name: 'Loading portal…' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(screen.queryByText('Loading tickets…')).not.toBeInTheDocument();
  });

  it('offers retry after a hung identity request and ignores its late response', async () => {
    let resolveFirst: ((value: { user: { id: string; name: string; email: string } }) => void) | undefined;
    let resolveRetry: ((value: { user: { id: string; name: string; email: string } }) => void) | undefined;
    vi.mocked(portalApi.get).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRetry = resolve; }));
    window.history.replaceState(null, '', '/tickets');
    vi.useFakeTimers();
    render(<App />);

    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByRole('alert', { name: 'Portal could not be loaded' })).toBeInTheDocument();
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isLoading: true, authGeneration: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading portal' }));
    expect(screen.getByRole('status', { name: 'Loading portal…' })).toBeInTheDocument();
    await act(async () => { resolveFirst?.({ user: { id: 'stale', name: 'Stale', email: 'stale@example.test' } }); });
    expect(useAuthStore.getState().user).toBeNull();
    await act(async () => { resolveRetry?.({ user: { id: 'current', name: 'Current', email: 'current@example.test' } }); });
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: { id: 'current' } });
  });

  it('puts the selected dark mode on html so Park outline tokens match the auth shell', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    vi.mocked(portalApi.get).mockResolvedValue({});
    window.history.replaceState(null, '', '/login');
    render(<App />);
    const method = await screen.findByRole('radio', { name: 'Code (OTP)' });
    expect(method.closest('.radio-group__item')).toBeInTheDocument();
    expect(method.closest('[data-auth-mode]')).toHaveAttribute('data-auth-mode', 'dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(method.closest('.radio-group__item')).not.toHaveAttribute('style');
  });

  it('keeps an explicit light theme when the operating system prefers dark', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    document.documentElement.setAttribute('data-tocyn-theme-mode', 'light');
    vi.mocked(portalApi.get).mockResolvedValue({});
    window.history.replaceState(null, '', '/login');
    render(<App />);
    const method = await screen.findByRole('radio', { name: 'Code (OTP)' });
    expect(method.closest('[data-auth-mode]')).toHaveAttribute('data-auth-mode', 'light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('retains readable text contrast in the dark theme applied at the document boundary', () => {
    const tokens = resolveTocynTheme({ mode: 'dark' }).tokens;
    const luminance = (color: string) => {
      const channels = color.match(/[0-9a-f]{2}/gi)?.map(channel => parseInt(channel, 16) / 255) ?? [];
      const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const foreground = luminance(tokens.colorText);
    const background = luminance(tokens.colorSurface);
    expect((foreground + 0.05) / (background + 0.05)).toBeGreaterThanOrEqual(7);
  });

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
