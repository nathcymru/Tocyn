import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, dashboardApi } from '../api/client';
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

it('portals the timezone menu outside the clipped card while retaining selection', async () => {
  vi.mocked(dashboardApi.get).mockResolvedValue({ COMPANY_NAME: 'Synthetic Co', SYSTEM_TIMEZONE: 'UTC' });
  renderPage();
  const timezone = await screen.findByRole('combobox', { name: 'System Timezone' });
  expect(timezone).toHaveAttribute('id', 'SYSTEM_TIMEZONE');
  await userEvent.click(timezone);
  const london = await screen.findByRole('option', { name: 'London (GMT)' });
  const positioner = london.closest('[data-scope="select"][data-part="positioner"]');
  expect(positioner).toBeInTheDocument();
  expect(positioner?.closest('.card__root')).toBeNull();
  expect(document.body).toContainElement(positioner as HTMLElement);
  await waitFor(() => {
    expect((positioner as HTMLElement).style.getPropertyValue('--x')).toMatch(/px$/);
    expect((positioner as HTMLElement).style.getPropertyValue('--y')).toMatch(/px$/);
  });
  await userEvent.click(london);
  expect(timezone).toHaveTextContent('London (GMT)');
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

it('keeps cached settings and an explicit retry after background refresh fails', async () => {
  client.setQueryData(['settings'], { COMPANY_NAME: 'Cached Co', SYSTEM_TIMEZONE: 'UTC' });
  vi.mocked(dashboardApi.get).mockRejectedValueOnce(new Error('Synthetic refresh failure'))
    .mockRejectedValueOnce(new Error('Synthetic retry failure'))
    .mockResolvedValueOnce({ COMPANY_NAME: 'Current Co', SYSTEM_TIMEZONE: 'UTC' });
  renderPage();
  const company = await screen.findByRole('textbox', { name: 'Company Name' });
  expect(company).toHaveValue('Cached Co');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('General settings could not be refreshed');
  expect(alert).toHaveTextContent('may have changed elsewhere');
  await userEvent.clear(company);
  await userEvent.type(company, 'Unsaved edit');
  await userEvent.click(within(alert).getByRole('button', { name: 'Retry settings refresh' }));
  await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('alert')).toHaveTextContent('General settings could not be refreshed');
  expect(company).toHaveValue('Unsaved edit');
  await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry settings refresh' }));
  await waitFor(() => expect(company).toHaveValue('Current Co'));
  expect(screen.queryByText('General settings could not be refreshed')).not.toBeInTheDocument();
  expect(dashboardApi.get).toHaveBeenCalledTimes(3);
});

it('preserves the master-key security treatment on a cached refresh failure', async () => {
  client.setQueryData(['settings'], { COMPANY_NAME: 'Cached Co', SYSTEM_TIMEZONE: 'UTC' });
  vi.mocked(dashboardApi.get).mockRejectedValue(new ApiError('APP_MASTER_KEY is missing', 503));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Critical: Missing Encryption Key');
  expect(screen.getByRole('textbox', { name: 'Company Name' })).toHaveValue('Cached Co');
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Retry settings refresh' })).not.toBeInTheDocument();
});

it('keeps edited values and an actionable error after a failed save', async () => {
  vi.mocked(dashboardApi.get).mockResolvedValue({ COMPANY_NAME: 'Synthetic Co', SYSTEM_TIMEZONE: 'UTC' });
  vi.mocked(dashboardApi.put).mockRejectedValueOnce(new Error('Synthetic save failure')).mockResolvedValueOnce({});
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    renderPage();
    const company = await screen.findByRole('textbox', { name: 'Company Name' });
    await userEvent.clear(company);
    await userEvent.type(company, 'Updated Co');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still in the form; try again.');
    expect(company).toHaveValue('Updated Co');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(dashboardApi.put).toHaveBeenCalledTimes(2);
  } finally {
    consoleError.mockRestore();
  }
});

it('shows saved values read-only after the local beta permanently rejects settings changes', async () => {
  vi.mocked(dashboardApi.get).mockResolvedValue({ COMPANY_NAME: 'Synthetic Co', SYSTEM_TIMEZONE: 'UTC' });
  vi.mocked(dashboardApi.put).mockRejectedValue(new ApiError('This feature is disabled in the local beta.', 503, 'feature_disabled'));
  renderPage();
  const company = await screen.findByRole('textbox', { name: 'Company Name' });
  await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(await screen.findByRole('status')).toHaveTextContent('General settings changes are unavailable in this local review');
  expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  expect(company).toHaveValue('Synthetic Co');
  expect(company).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'System Timezone' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Default Email Signature' })).toBeDisabled();
  expect(dashboardApi.put).toHaveBeenCalledTimes(1);
});
