import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSettingsPage } from '../pages/AccountSettingsPage';
import { useAuthStore } from '../store/authStore';

vi.mock('../components/theme/OperatorThemeProvider', () => ({
  OperatorThemeControl: () => <h3>Appearance</h3>,
  OperatorPreferencesControl: () => <h3>Workspace preferences</h3>,
}));
vi.mock('../components/capacity/OperatorCapacityPanel', () => ({
  OperatorCapacityPanel: () => <p>Current work data</p>,
}));

beforeEach(() => {
  useAuthStore.getState().setAuth('synthetic', {
    id: 'operator', tenant_id: 'tenant-a', role: 'admin', full_name: 'Synthetic Operator',
    email: 'very.long.synthetic.operator.name@example.test', mfa_enabled: true,
  });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

it('keeps account sections readable and reaches the security profile', async () => {
  const router = createMemoryRouter([
    { path: '/settings/account', element: <AccountSettingsPage /> },
    { path: '/profile/security', element: <h1>Security profile destination</h1> },
  ], { initialEntries: ['/settings/account'] });
  render(<RouterProvider router={router} />);

  expect(screen.getByRole('heading', { level: 1, name: 'Account settings' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Your identity' }).closest('.card__root')).toBeInTheDocument();
  expect(screen.getByText('very.long.synthetic.operator.name@example.test')).toBeVisible();
  expect(screen.getByRole('heading', { level: 2, name: 'Current work' })).toBeInTheDocument();
  const securityLink = screen.getByRole('link', { name: 'Security profile' });
  expect(securityLink).toHaveAttribute('href', '/profile/security');
  await userEvent.click(securityLink);
  expect(await screen.findByRole('heading', { name: 'Security profile destination' })).toBeInTheDocument();
});

it('shows a recoverable Park empty state when the session has no operator identity', () => {
  useAuthStore.setState({ user: null });
  const router = createMemoryRouter([
    { path: '/settings/account', element: <AccountSettingsPage /> },
  ], { initialEntries: ['/settings/account'] });
  render(<RouterProvider router={router} />);

  const unavailable = screen.getByRole('status', { name: 'Account details unavailable' });
  expect(unavailable).toHaveClass('emptyState__root');
  expect(screen.getByRole('button', { name: 'Reload account' })).toBeInTheDocument();
  expect(screen.queryByText('No email available')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Current work' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Security profile' })).not.toBeInTheDocument();
});
