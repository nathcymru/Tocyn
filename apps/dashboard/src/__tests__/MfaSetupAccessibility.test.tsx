import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MfaPage } from '../pages/MfaPage';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/client', () => ({ dashboardApi: { post: vi.fn() } }));
const staff = { id: 'setup-operator', email: 'operator@example.invalid', full_name: 'Operator', role: 'agent', mfa_enabled: false };
const setup = { provisioning_uri: 'otpauth://totp/Synthetic?secret=SYNTHETIC' };
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.resetAllMocks(); });
function showSetup() {
  useAuthStore.getState().setAuth('synthetic-setup-session', staff);
  render(<React.StrictMode><MemoryRouter initialEntries={['/mfa']}><Routes>
    <Route path="/mfa" element={<MfaPage />} />
    <Route path="/" element={<h1>Dashboard ready</h1>} />
  </Routes></MemoryRouter></React.StrictMode>);
}

it('shares initial setup across effect replay, retains retry focus and announces setup readiness', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  showSetup();
  expect(dashboardApi.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Preparing authenticator setup');
  await act(async () => { fail(new Error('Setup temporarily unavailable')); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Setup temporarily unavailable');
  let finish!: (value: typeof setup) => void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
  const retry = screen.getByRole('button', { name: 'Retry authenticator setup' });
  retry.focus(); fireEvent.click(retry);
  expect(retry).not.toBeDisabled(); expect(retry).toHaveAttribute('aria-disabled', 'true'); expect(retry).toHaveFocus();
  fireEvent.click(retry); expect(dashboardApi.post).toHaveBeenCalledTimes(2);
  await act(async () => { finish(setup); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Authenticator setup ready');
  expect(screen.getByRole('img', { name: /Authenticator setup QR/ })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Authentication Code' })).toHaveFocus();
});

it('retains the submitted setup code through a pending rejection and preserves authenticated recovery', async () => {
  vi.mocked(dashboardApi.post).mockResolvedValueOnce(setup);
  showSetup(); await screen.findByRole('img', { name: /Authenticator setup QR/ });
  const code = screen.getByRole('textbox', { name: 'Authentication Code' });
  fireEvent.change(code, { target: { value: '123456' } });
  let fail!: (error: Error) => void;
  vi.mocked(dashboardApi.post).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const submit = screen.getByRole('button', { name: 'Verify & Enable' });
  submit.focus(); fireEvent.click(submit);
  expect(code).toHaveAttribute('readonly'); expect(submit).toHaveFocus();
  fireEvent.change(code, { target: { value: '654321' } }); fireEvent.click(submit);
  expect(dashboardApi.post).toHaveBeenCalledTimes(2);
  expect(code).toHaveValue('123456');
  await act(async () => { fail(new Error('Invalid authentication code')); });
  const error = await screen.findByRole('alert');
  expect(code.getAttribute('aria-describedby')).toContain(error.id);
  expect(code).toHaveValue('123456'); expect(submit).toHaveFocus();
  vi.mocked(dashboardApi.post).mockResolvedValueOnce({ token: 'synthetic-authenticated-session', user: { ...staff, mfa_enabled: true } });
  fireEvent.click(submit);
  await screen.findByRole('heading', { name: 'Dashboard ready' });
  await waitFor(() => expect(useAuthStore.getState().mfaRequired).toBe(false));
  expect(dashboardApi.post).toHaveBeenLastCalledWith('/auth/mfa/confirm', { code: '123456' });
  expect(dashboardApi.post).toHaveBeenCalledTimes(3);
});
