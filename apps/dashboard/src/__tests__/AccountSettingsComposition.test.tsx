import { cleanup, render, screen, within } from '@testing-library/react';
import * as sharedUi from '@luminatick/ui';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OperatorThemeProvider } from '../components/theme/OperatorThemeProvider';
import { AccountSettingsPage } from '../pages/AccountSettingsPage';
import { useAuthStore } from '../store/authStore';

vi.mock('../hooks/useOperatorTheme', () => ({
  useOperatorTheme: () => ({
    status: 'idle', mode: 'system', resolvedMode: 'light', theme: { light: {}, dark: {} }, error: '',
    updateMode: vi.fn(), save: vi.fn(), retry: vi.fn(), restore: vi.fn(),
  }),
}));
vi.mock('../hooks/useOperatorPreferences', () => ({
  useOperatorPreferences: () => ({
    status: 'restored', schemaUnavailable: false, error: '',
    density: 'comfortable', fontScale: 'normal', motion: 'system', navigation: 'labelled',
    contextDefault: 'remember', interruptionLevel: 'standard',
    focusMode: false, shortcutsEnabled: true, advanceAfterResolve: false,
    update: vi.fn(), save: vi.fn(), retry: vi.fn(), restore: vi.fn(),
  }),
}));
vi.mock('../hooks/useOperatorCapacity', () => ({
  useOperatorCapacity: (userId: string) => ({
    identity: userId, phase: 'ready', message: null, needsReload: false, canWrite: true,
    data: {
      revision: 1, availability: 'available', assignmentCeiling: 5, currentWork: 2,
      status: 'available', asOf: '2026-09-20T10:00:00.000Z',
    },
    reload: vi.fn(), save: vi.fn(),
  }),
}));

beforeEach(() => {
  useAuthStore.getState().setAuth('synthetic', {
    id: 'operator', tenant_id: 'tenant-a', role: 'admin', full_name: 'Synthetic Operator',
    email: 'operator@example.test', mfa_enabled: true,
  });
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.clearAllMocks(); });

it('composes real Park controls for account appearance, preferences, and capacity', () => {
  const router = createMemoryRouter([
    { path: '/settings/account', element: <OperatorThemeProvider><AccountSettingsPage /></OperatorThemeProvider> },
  ], { initialEntries: ['/settings/account'] });
  const { container } = render(<RouterProvider router={router} />);

  const appearance = screen.getByRole('heading', { name: 'Appearance' }).closest<HTMLElement>('section');
  const preferences = screen.getByRole('heading', { name: 'Workspace preferences' }).closest<HTMLElement>('section');
  const capacity = screen.getByRole('heading', { name: 'Current work' }).closest<HTMLElement>('.card__root');
  expect(appearance).not.toBeNull();
  expect(preferences).not.toBeNull();
  expect(capacity).not.toBeNull();

  const themeModes = within(appearance!).getByRole('radiogroup', { name: 'Theme mode' });
  expect(themeModes).toHaveAttribute('data-scope', 'radio-group');
  expect(themeModes).toHaveAttribute('data-part', 'root');
  expect(within(appearance!).getByRole('radio', { name: 'Use system setting' })).toBeChecked();

  const density = within(preferences!).getByRole('combobox', { name: 'Workspace density' });
  expect(density.closest('[data-scope="select"][data-part="root"]')).toHaveClass('select__root');
  expect(within(preferences!).getAllByRole('combobox')).toHaveLength(6);
  expect(within(preferences!).getByRole('checkbox', { name: 'Focus mode' })).toBeInTheDocument();
  expect(within(preferences!).getByRole('button', { name: 'Save workspace preferences' })).toHaveClass('button');

  expect(within(capacity!).getByText('Current work includes assigned open and pending conversations, including waiting and snoozed work.')).toBeVisible();
  expect(within(capacity!).getByRole('button', { name: 'Refresh current work' })).toHaveClass('button');

  // The installed Ark controls expose their anatomy; native controls must not become visible fallbacks.
  expect(Object.keys(sharedUi).filter(name => /^Tocyn(?:Button|Input|Select|Textarea|Checkbox|Switch|Radio|Dialog|Menu)$/.test(name))).toEqual([]);
  expect(container.querySelector('[data-park]')).toBeNull();
  for (const button of screen.getAllByRole('button')) {
    expect(button.matches('.button, [data-scope]')).toBe(true);
  }
  for (const select of container.querySelectorAll('select')) {
    expect(select.closest('[data-scope="select"][data-part="root"]')).not.toBeNull();
  }
  for (const input of container.querySelectorAll('input')) {
    expect(input.closest('[data-scope="radio-group"], [data-scope="checkbox"]')).not.toBeNull();
  }
});
