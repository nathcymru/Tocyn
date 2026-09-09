import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { useAuthStore } from '../store/authStore';

// Exercise the real client, auth bootstrap and router; only the destination is a leaf.
vi.mock('../pages/TicketListPage', () => ({ TicketListPage: () => <h1>Tickets ready</h1> }));
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true, authGeneration: 0 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAuthStore.getState().logout(); });

it('retains the real verification form after wrong OTP and accepts a corrected code', async () => {
  window.history.replaceState({ usr: { email: 'customer@example.invalid', challengeId: 'synthetic-challenge' } }, '', '/verify');
  let verifications = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/auth/me')) return Response.json({}, { status: 401 });
    if (url.endsWith('/auth/verify')) {
      expect(JSON.parse(options?.body as string).challengeId).toBe('synthetic-challenge');
      verifications++;
      return verifications === 1 ? Response.json({ error: 'Invalid token' }, { status: 401 })
        : Response.json({ token: 'synthetic-session', user: { id: 'customer', name: 'Customer', email: 'customer@example.invalid' } });
    }
    throw new Error('Unexpected portal request');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
  const code = screen.getByRole('textbox', { name: 'Authentication Code' });
  fireEvent.change(code, { target: { value: '123456' } });
  const submit = screen.getByRole('button', { name: 'Verify Code' });
  submit.focus(); fireEvent.click(submit);
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('Unauthorized');
  expect(code).toHaveAttribute('aria-describedby', error.id);
  expect(code).toHaveValue('123456');
  expect(submit).toHaveFocus();
  expect(window.location.pathname).toBe('/verify');
  fireEvent.change(code, { target: { value: '654321' } });
  fireEvent.click(submit);
  await screen.findByRole('heading', { name: 'Tickets ready' });
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(verifications).toBe(2);
});

it('retains the real request form and its email after a rejected login request', async () => {
  window.history.replaceState({}, '', '/login?key=synthetic-public-key');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/config')) return Response.json({});
    return Response.json({}, { status: 401 });
  }));
  render(<App />);
  await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
  const email = screen.getByRole('textbox', { name: 'Email address' });
  fireEvent.change(email, { target: { value: 'customer@example.invalid' } });
  const submit = screen.getByRole('button', { name: 'Send Magic Link' });
  submit.focus(); fireEvent.click(submit);
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('Unauthorized');
  expect(email).toHaveAttribute('aria-describedby', error.id);
  expect(email).toHaveValue('customer@example.invalid');
  expect(submit).toHaveFocus();
  expect(window.location.pathname).toBe('/login');
});
