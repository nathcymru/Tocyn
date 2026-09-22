import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { LoginPage } from '../pages/LoginPage';
import { useAuthStore } from '../store/authStore';
import { portalApi } from '../api/client';

vi.mock('../api/client', () => ({ portalApi: { post: vi.fn(), get: vi.fn() } }));

function LoginWithStateProbe() {
  const location = useLocation();
  return <><LoginPage /><output data-testid="logout-route-state">{location.state?.logoutWarning ? 'pending' : 'consumed'}</output></>;
}

describe('logout completion', () => {
  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn());
    vi.mocked(portalApi.get).mockResolvedValue({});
    useAuthStore.getState().login({ id: 'synthetic', name: 'Customer', email: 'c@example.test' });
    localStorage.setItem('lumina_customer_token', 'synthetic-token');
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([true, false])('clears local credentials and navigates away when server confirmation is %s', async confirmed => {
    if (confirmed) vi.mocked(portalApi.post).mockResolvedValue({ success: true });
    else vi.mocked(portalApi.post).mockRejectedValue(new Error('Network unavailable'));
    render(<MemoryRouter initialEntries={['/tickets']}><Routes>
      <Route path='/tickets' element={<Layout />} />
      <Route path='/login' element={<LoginWithStateProbe />} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
    await screen.findByRole('heading', { name: 'Sign in to Support' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('lumina_customer_token')).toBeNull();
    expect(portalApi.post).toHaveBeenCalledWith('/auth/logout');
    if (confirmed) expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    else expect(screen.getByRole('alert')).toHaveTextContent('Server sign-out could not be confirmed. Local sign-in data was cleared.');
    await waitFor(() => {
      expect(screen.getByTestId('logout-route-state')).toHaveTextContent('consumed');
      expect(window.alert).not.toHaveBeenCalled();
    });
  });
});
