import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useAuthStore } from '../store/authStore';
import { portalApi } from '../api/client';

vi.mock('../api/client', () => ({ portalApi: { post: vi.fn() } }));

describe('logout completion', () => {
  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn());
    useAuthStore.getState().login({ id: 'synthetic', name: 'Customer', email: 'c@example.test' });
    localStorage.setItem('lumina_customer_token', 'synthetic-token');
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([true, false])('clears local credentials and navigates away when server confirmation is %s', async confirmed => {
    if (confirmed) vi.mocked(portalApi.post).mockResolvedValue({ success: true });
    else vi.mocked(portalApi.post).mockRejectedValue(new Error('Network unavailable'));
    render(<MemoryRouter initialEntries={['/tickets']}><Routes>
      <Route path='/tickets' element={<Layout />} />
      <Route path='/login' element={<p>Signed out screen</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of all sessions' }));
    await screen.findByText('Signed out screen');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('lumina_customer_token')).toBeNull();
    expect(portalApi.post).toHaveBeenCalledWith('/auth/logout');
    await waitFor(() => {
      if (confirmed) expect(window.alert).not.toHaveBeenCalled();
      else expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Server sign-out could not be confirmed'));
    });
  });
});
