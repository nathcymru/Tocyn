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
  await userEvent.click(screen.getByRole('button', { name: 'Security profile' }));
  expect(await screen.findByRole('heading', { name: 'Security profile destination' })).toBeInTheDocument();
});
