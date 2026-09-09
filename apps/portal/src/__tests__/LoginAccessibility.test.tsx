import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { VerifyPage } from '../pages/VerifyPage';
import { portalApi } from '../api/client';
vi.mock('../api/client', () => ({ portalApi: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(Page: typeof LoginPage, path = '/') {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<Page />} /></Routes></MemoryRouter>);
}

describe('customer login accessibility', () => {
  it('names the login-method group and exposes which native button is selected', () => {
    vi.mocked(portalApi.get).mockResolvedValue({});
    mount(LoginPage);
    expect(screen.getByRole('group', { name: 'Login method' })).toBeTruthy();
    const magic = screen.getByRole('button', { name: 'Magic Link' });
    const code = screen.getByRole('button', { name: 'Code (OTP)' });
    expect(magic.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(code);
    expect(magic.getAttribute('aria-pressed')).toBe('false');
    expect(code.getAttribute('aria-pressed')).toBe('true');
  });

  it('announces sending/failure and preserves a focusable submit control with no repeated request', async () => {
    vi.mocked(portalApi.get).mockResolvedValue({});
    let reject!: (error: Error) => void;
    vi.mocked(portalApi.post).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    mount(LoginPage);
    const email = screen.getByLabelText('Email address');
    fireEvent.change(email, { target: { value: 'customer@example.invalid' } });
    const button = screen.getByRole('button', { name: 'Send Magic Link' });
    button.focus(); fireEvent.click(button);
    expect(screen.getByRole('status').textContent).toContain('Sending login instructions');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button); expect(portalApi.post).toHaveBeenCalledTimes(1);
    reject(new Error('Login instructions unavailable'));
    const alert = await screen.findByRole('alert');
    expect(email.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(button);
  });

  it('retains the submitted identity and method despite attempted changes while pending', async () => {
    vi.mocked(portalApi.get).mockResolvedValue({});
    let resolveRequest!: (result: object) => void;
    vi.mocked(portalApi.post).mockImplementation(() => new Promise(resolve => { resolveRequest = resolve; }));
    mount(LoginPage);
    const email = screen.getByLabelText('Email address') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'submitted@example.invalid' } });
    const submit = screen.getByRole('button', { name: 'Send Magic Link' });
    submit.focus(); fireEvent.click(submit);
    const otp = screen.getByRole('button', { name: 'Code (OTP)' });
    expect(email.readOnly).toBe(true);
    expect(email.disabled).toBe(false);
    expect(otp.hasAttribute('disabled')).toBe(false);
    expect(otp.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(otp);
    fireEvent.change(email, { target: { value: 'attempted-change@example.invalid' } });
    expect(email.value).toBe('submitted@example.invalid');
    expect(screen.getByRole('button', { name: 'Magic Link' }).getAttribute('aria-pressed')).toBe('true');
    expect(portalApi.post).toHaveBeenCalledExactlyOnceWith('/auth/request', expect.objectContaining({
      email: 'submitted@example.invalid', type: 'magic_link',
    }));
    resolveRequest({});
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBe(document.activeElement);
    expect(screen.getByText('submitted@example.invalid')).toBeTruthy();
    expect(screen.queryByText(/OTP sent/)).toBeNull();
  });

  it('moves focus to the success heading when the request form is replaced', async () => {
    vi.mocked(portalApi.get).mockResolvedValue({});
    vi.mocked(portalApi.post).mockResolvedValue({});
    mount(LoginPage);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'customer@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Magic Link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBe(document.activeElement);
  });

  it('exposes pending magic-link verification as status while retaining the heading', () => {
    vi.mocked(portalApi.post).mockImplementation(() => new Promise(() => {}));
    mount(VerifyPage, '/verify?token=synthetic-link');
    expect(screen.getByRole('status').textContent).toContain('Verifying your login');
    expect(screen.getByRole('heading', { name: 'Verifying your login...' })).toBeTruthy();
    expect(portalApi.post).toHaveBeenCalledTimes(1);
  });

  it('announces verification failure, describes the code field, and keeps retry keyboard reachable', async () => {
    vi.mocked(portalApi.post).mockRejectedValue(new Error('Code expired. Request a new code.'));
    mount(VerifyPage);
    const code = screen.getByLabelText('Authentication Code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(code, { target: { value: '123456' } });
    const button = screen.getByRole('button', { name: 'Verify Code' });
    button.focus(); fireEvent.click(button);
    expect(screen.getByRole('status').textContent).toContain('Verifying code');
    const alert = await screen.findByRole('alert');
    expect(code.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('button', { name: 'Request a new code' }).hasAttribute('disabled')).toBe(false);
    expect(portalApi.post).toHaveBeenCalledTimes(1);
  });
});
