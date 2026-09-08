import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { VerifyPage } from '../pages/VerifyPage';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/client', () => ({ portalApi: { post: vi.fn() } }));

function mount(entry: string | { pathname: string; state: { challengeId: string } }) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/tickets" element={<div>Ticket destination</div>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined' && localStorage?.clear) {
    localStorage.clear();
  }
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});
afterEach(cleanup);

describe('verification flows', () => {
  it('uses a magic-link token only once during StrictMode replay', async () => {
    vi.mocked(portalApi.post).mockResolvedValue({
      user: { id: 'synthetic-user', name: 'Test', email: 'test@example.com' },
      token: 'synthetic-session',
    });
    mount('/verify?token=synthetic-link');
    expect(await screen.findByText('Ticket destination')).toBeInTheDocument();
    expect(portalApi.post).toHaveBeenCalledTimes(1);
    expect(portalApi.post).toHaveBeenCalledWith('/auth/verify', { token: 'synthetic-link' });
    expect(localStorage.getItem('lumina_customer_token')).toBe('synthetic-session');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('shows magic-link failure and a way to request a new code', async () => {
    vi.mocked(portalApi.post).mockRejectedValue(new Error('Expired synthetic token'));
    mount('/verify?token=expired');
    expect(await screen.findByText('Expired synthetic token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a new code' })).toBeInTheDocument();
    expect(screen.queryByText('Verifying your login...')).not.toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('restores the OTP challenge from browser history when the router restarts', async () => {
    window.history.replaceState(null, '', '/login');
    vi.mocked(portalApi.post).mockResolvedValue({
      user: { id: 'synthetic-user', name: 'Test', email: 'test@example.com' },
      token: 'synthetic-session',
    });
    function BrowserFlow() {
      return <BrowserRouter><Routes>
        <Route path="/login" element={<Link to="/verify" state={{ email: 'test@example.com', challengeId: 'history-challenge' }}>Continue</Link>} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/tickets" element={<div>Ticket destination</div>} />
      </Routes></BrowserRouter>;
    }
    const first = render(<BrowserFlow />);
    fireEvent.click(screen.getByText('Continue'));
    expect(await screen.findByText('test@example.com')).toBeInTheDocument();
    // A document reload reconstructs the router while preserving the history entry.
    // Use the real BrowserRouter to both write and recover state, not a mocked location.
    first.unmount();
    const restarted = render(<BrowserFlow />);
    try {
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Authentication Code'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
      expect(await screen.findByText('Ticket destination')).toBeInTheDocument();
      expect(portalApi.post).toHaveBeenCalledExactlyOnceWith('/auth/verify', { token: '123456', challengeId: 'history-challenge' });
    } finally {
      restarted.unmount();
      window.history.replaceState(null, '', '/');
    }
  });

  it('verifies a manually entered code only after submission', async () => {
    vi.mocked(portalApi.post).mockResolvedValue({
      user: { id: 'synthetic-user', name: 'Test', email: 'test@example.com' },
      token: 'synthetic-session',
    });
    mount({ pathname: '/verify', state: { challengeId: 'synthetic-challenge' } });
    expect(portalApi.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Authentication Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
    expect(await screen.findByText('Ticket destination')).toBeInTheDocument();
    expect(portalApi.post).toHaveBeenCalledWith('/auth/verify', { token: '123456', challengeId: 'synthetic-challenge' });
  });
});
