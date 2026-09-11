// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { MfaPage } from '../pages/MfaPage';
import { dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/client', () => ({ dashboardApi: { post: vi.fn() } }));
const staff = { id: 'synthetic-staff', email: 'staff@example.invalid', full_name: 'Synthetic staff', role: 'agent', mfa_enabled: true };
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.resetAllMocks(); });
function mount(Page: typeof LoginPage) {
  render(<MemoryRouter><Routes><Route path="/" element={<Page />} /><Route path="/mfa" element={<p>MFA destination</p>} /></Routes></MemoryRouter>);
}

describe('staff login accessibility', () => {
  it('associates fields, announces progress/failure, retains focus and rejects duplicate pending submission', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(dashboardApi.post).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    mount(LoginPage);
    const email = screen.getByLabelText('Email Address');
    const password = screen.getByLabelText('Password');
    fireEvent.change(email, { target: { value: staff.email } });
    fireEvent.change(password, { target: { value: 'synthetic-password' } });
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    const button = screen.getByRole('button', { name: 'Sign In' });
    button.focus(); fireEvent.click(button);
    expect(screen.getByRole('status').textContent).toContain('Signing in');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(dashboardApi.post).toHaveBeenCalledTimes(1);
    reject(new Error('Sign-in unavailable. Try again.'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Sign-in unavailable');
    expect(email.getAttribute('aria-describedby')).toBe(alert.id);
    expect(password.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('false');
  });

  it('preserves the successful password-to-MFA handoff', async () => {
    vi.mocked(dashboardApi.post).mockResolvedValue({ token: 'synthetic-pre-mfa', user: staff, mfa_required: true });
    mount(LoginPage);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: staff.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await screen.findByLabelText('Authentication Code');
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(useAuthStore.getState().mfaRequired).toBe(true);
  });

  it('names the MFA input, connects instructions/error, and retains the code after rejection', async () => {
    useAuthStore.getState().setAuth('synthetic-pre-mfa', staff);
    vi.mocked(dashboardApi.post).mockRejectedValue(new Error('Invalid authentication code'));
    mount(MfaPage);
    const code = screen.getByLabelText('Authentication Code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    const button = screen.getByRole('button', { name: 'Verify Code' });
    fireEvent.click(button); expect(dashboardApi.post).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '123456' } });
    button.focus(); fireEvent.click(button);
    expect(screen.getByRole('status').textContent).toContain('Verifying code');
    const alert = await screen.findByRole('alert');
    expect(code.getAttribute('aria-describedby')).toContain(alert.id);
    expect((code as HTMLInputElement).value).toBe('123456');
    expect(document.activeElement).toBe(button);
    expect(dashboardApi.post).toHaveBeenCalledWith('/auth/mfa/verify', { code: '123456' });
  });

  it('provides a named setup image and readable alternative to scanning it', async () => {
    useAuthStore.getState().setAuth('synthetic-pre-mfa', { ...staff, mfa_enabled: false });
    vi.mocked(dashboardApi.post).mockResolvedValue({ provisioning_uri: 'otpauth://totp/Synthetic?secret=SYNTHETIC' });
    mount(MfaPage);
    await screen.findByRole('img', { name: 'Authenticator setup QR code; a text key follows' });
    expect(screen.getByText(/manually enter this secret key/)).toBeTruthy();
    expect(screen.getByLabelText('Authentication Code').getAttribute('aria-describedby')).toBe('mfa-instructions');
  });
});
