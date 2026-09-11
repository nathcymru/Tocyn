import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../pages/LoginPage';
import { MemoryRouter } from 'react-router-dom';
import { portalApi } from '../api/client';

// Mock the API client
vi.mock('../api/client', () => ({
  portalApi: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(portalApi.get).mockResolvedValue({});
  });

  it('renders login form correctly', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Sign in to Support')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByText('Send Magic Link')).toBeInTheDocument();
  });

  it('handles email input and submission via magic link', async () => {
    vi.mocked(portalApi.post).mockResolvedValueOnce({});

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    const emailInput = await screen.findByLabelText('Email address');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    
    const submitButton = screen.getByRole('button', { name: /Send Magic Link/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(portalApi.post).toHaveBeenCalledWith('/auth/request', {
        email: 'test@example.com',
        type: 'magic_link',
        turnstileToken: null,
        baseUrl: 'http://localhost:3000', // JSDOM default origin
      });
    });

    expect(screen.getByText('Check your email')).toBeInTheDocument();
  });
});

it('keeps OTP verification in the login page, retains the challenge and permits retry', async () => {
  vi.mocked(portalApi.get).mockResolvedValue({});
  vi.mocked(portalApi.post).mockResolvedValueOnce({ challengeId: 'synthetic-challenge' })
    .mockRejectedValueOnce(new Error('Wrong code'));
  render(<MemoryRouter initialEntries={['/login']}><LoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Code (OTP)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send Code' }));
  const input = await screen.findByLabelText('Authentication Code');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Wrong code');
  expect(portalApi.post).toHaveBeenLastCalledWith('/auth/verify', { token: '123456', challengeId: 'synthetic-challenge' });
  fireEvent.click(screen.getByRole('button', { name: 'Request a new code' }));
  expect(await screen.findByLabelText('Email address')).toHaveValue('test@example.invalid');
});

it('restores an OTP challenge from login history after reload', async () => {
  vi.mocked(portalApi.get).mockResolvedValue({});
  vi.mocked(portalApi.post).mockRejectedValueOnce(new Error('Retry code'));
  render(<MemoryRouter initialEntries={[{ pathname: '/login', search: '?key=synthetic-public-key', state: {
    authStep: 'verify', challenge: { email: 'test@example.invalid', challengeId: 'restored-challenge' }
  } }]}><LoginPage /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Authentication Code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify Code' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry code');
  expect(portalApi.post).toHaveBeenLastCalledWith('/auth/verify', { token: '123456', challengeId: 'restored-challenge' });
});
