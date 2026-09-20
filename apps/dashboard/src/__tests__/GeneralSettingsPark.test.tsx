import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dashboardApi } from '../api/client';
import { SettingsPage } from '../pages/SettingsPage';

vi.mock('../api/client', async () => ({
  ...(await vi.importActual<typeof import('../api/client')>('../api/client')),
  dashboardApi: { get: vi.fn(), put: vi.fn() },
}));

let client: QueryClient;
function renderPage() {
  return render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

it('uses Park cards and controls after loading saved settings', async () => {
  vi.mocked(dashboardApi.get).mockResolvedValue({ COMPANY_NAME: 'Synthetic Co', SYSTEM_TIMEZONE: 'UTC' });
  renderPage();
  expect(screen.getByRole('status', { name: 'Loading general settings' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'General Settings' })).toBeInTheDocument();
  const organization = screen.getByRole('heading', { name: 'Organization Profile' });
  expect(organization).toHaveClass('card__title');
  expect(organization.closest('.card__root')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Company Name' })).toHaveClass('input');
  expect(screen.getByRole('button', { name: 'Save Changes' })).toHaveClass('button');
  expect(screen.getByRole('combobox', { name: 'System Timezone' })).toHaveAttribute('data-scope', 'select');
});

it('keeps writes unavailable after a failed restore and retries before showing the form', async () => {
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce({ COMPANY_NAME: 'Recovered Co', SYSTEM_TIMEZONE: 'UTC' });
  renderPage();
  const empty = await screen.findByRole('region', { name: 'General settings are unavailable' });
  expect(within(empty).getByRole('button', { name: 'Retry settings' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  expect(dashboardApi.put).not.toHaveBeenCalled();
  await userEvent.click(within(empty).getByRole('button', { name: 'Retry settings' }));
  expect(await screen.findByDisplayValue('Recovered Co')).toBeInTheDocument();
});
