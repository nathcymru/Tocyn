import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dashboardApi } from '../api/client';
import { SettingsLayout } from '../components/layout/SettingsLayout';
import { useAuthStore } from '../store/authStore';

vi.mock('../api/client', () => ({ dashboardApi: { get: vi.fn() } }));

function Destination() {
  const location = useLocation();
  return <p>Current route: {location.pathname}</p>;
}

function renderSettings(path = '/settings/general') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/settings" element={<SettingsLayout />}>
      <Route path="*" element={<Destination />} />
    </Route>
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') ? [new DOMRect(0, 0, 100, 44)] : []) as unknown as DOMRectList;
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses Park Menu anatomy for settings sections and navigates to Account', async () => {
  useAuthStore.getState().setAuth('synthetic-session', { id: 'admin', tenant_id: 'synthetic-tenant', email: 'admin@example.invalid', full_name: 'Admin', role: 'admin', mfa_enabled: true });
  renderSettings();
  const trigger = screen.getByRole('button', { name: 'Settings sections, current: General' });
  expect(trigger).toHaveClass('button');
  await userEvent.click(trigger);
  const menu = await screen.findByRole('menu');
  expect(menu).toHaveClass('menu__content');
  const account = within(menu).getByRole('menuitem', { name: 'Account' });
  expect(account).toHaveAttribute('href', '/settings/account');
  expect(within(menu).getByRole('menuitem', { name: 'Agent Permissions' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Channels' })).toHaveAttribute('data-part', 'trigger-item');
  expect(within(menu).queryByRole('menuitem', { name: 'Email' })).not.toBeInTheDocument();
  await userEvent.click(account);
  expect(screen.getByText('Current route: /settings/account')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Settings sections, current: Account' })).toBeInTheDocument();
});

it('opens the nested Park Channels menu with Right, returns with Left, and restores the trigger with Escape', async () => {
  useAuthStore.getState().setAuth('synthetic-session', { id: 'admin', tenant_id: 'synthetic-tenant', email: 'admin@example.invalid', full_name: 'Admin', role: 'admin', mfa_enabled: true });
  renderSettings('/settings/channels/email');
  const trigger = screen.getByRole('button', { name: 'Settings sections, current: Email' });
  const user = userEvent.setup();
  await user.click(trigger);
  const parent = await screen.findByRole('menu');
  const channels = within(parent).getByRole('menuitem', { name: 'Channels' });
  expect(channels).toHaveAttribute('aria-haspopup', 'menu');
  expect(channels).toHaveAttribute('data-current', 'true');
  await waitFor(() => expect(parent).toHaveFocus());
  await user.keyboard('{End}');
  expect(channels).toHaveAttribute('data-highlighted');
  await user.keyboard('{ArrowRight}');
  const submenu = await screen.findByRole('menu', { name: 'Channels' });
  expect(submenu).toHaveClass('menu__content');
  expect(parent.contains(submenu)).toBe(false);
  expect(submenu.className).toContain('max-w_calc(100vw_-_2rem)');
  expect(submenu.closest('[data-part="positioner"]')).toHaveStyle({ position: 'fixed' });
  expect(within(submenu).getByRole('menuitem', { name: 'Email' })).toHaveAttribute('aria-current', 'page');
  await waitFor(() => expect(submenu.contains(document.activeElement)).toBe(true));
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Channels' })).not.toBeInTheDocument());
  await waitFor(() => expect(parent).toHaveFocus());
  expect(parent).toHaveAttribute('aria-activedescendant', channels.id);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('includes only the Channels routes granted to an agent', async () => {
  useAuthStore.getState().setAuth('synthetic-session', { id: 'agent', tenant_id: 'synthetic-tenant', email: 'agent@example.invalid', full_name: 'Agent', role: 'agent', mfa_enabled: true });
  vi.mocked(dashboardApi.get).mockResolvedValueOnce({ channels_email: true });
  renderSettings('/settings/account');
  await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledWith('/permissions'));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Settings sections, current: Account' }));
  await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Channels' }));
  const submenu = await screen.findByRole('menu', { name: 'Channels' });
  expect(within(submenu).getByRole('menuitem', { name: 'Email' })).toBeInTheDocument();
  expect(within(submenu).queryByRole('menuitem', { name: 'Widget' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Users' })).not.toBeInTheDocument();
});

it('navigates from a nested Channels item and updates the current section', async () => {
  useAuthStore.getState().setAuth('synthetic-session', { id: 'admin', tenant_id: 'synthetic-tenant', email: 'admin@example.invalid', full_name: 'Admin', role: 'admin', mfa_enabled: true });
  renderSettings();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Settings sections, current: General' }));
  await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Channels' }));
  const submenu = await screen.findByRole('menu', { name: 'Channels' });
  await user.click(within(submenu).getByRole('menuitem', { name: 'Widget' }));
  expect(screen.getByText('Current route: /settings/channels/widget')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Settings sections, current: Widget' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Channels' })).not.toBeInTheDocument());
});

it('keeps Account available when an agent permission request fails', async () => {
  useAuthStore.getState().setAuth('synthetic-session', { id: 'agent', tenant_id: 'synthetic-tenant', email: 'agent@example.invalid', full_name: 'Agent', role: 'agent', mfa_enabled: true });
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Unavailable'));
  renderSettings('/settings/account');
  expect(await screen.findByRole('status')).toHaveTextContent('Settings sections are unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Settings sections, current: Account' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
  expect(within(menu).queryByRole('menuitem', { name: 'Users' })).not.toBeInTheDocument();
  expect(within(menu).queryByRole('menuitem', { name: 'Agent Permissions' })).not.toBeInTheDocument();
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Settings sections, current: Account' })).toHaveFocus());
  vi.mocked(dashboardApi.get).mockResolvedValueOnce({ users: true });
  await userEvent.click(screen.getByRole('button', { name: 'Retry settings access' }));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Settings sections, current: Account' }));
  expect(await screen.findByRole('menuitem', { name: 'Users' })).toBeInTheDocument();
});
