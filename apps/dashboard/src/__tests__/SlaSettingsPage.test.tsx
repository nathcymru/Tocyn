import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SlaSettingsPage } from '../pages/SlaSettingsPage';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutateAsync: vi.fn(), refetch: vi.fn() }));
vi.mock('../hooks/useSlaPolicy', () => ({
  useSlaPolicy: mocks.query,
  useUpdateSlaPolicy: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

const policy = {
  revision: 4,
  calendar: { timeZone: 'UTC', weekly: {}, exceptions: [], dst: { ambiguousLocalTime: 'earlier', nonexistentLocalTime: 'next-valid' } },
  responseTargetMs: 3_600_000,
  resolutionTargetMs: null,
  reopenPolicy: { response: 'continue', resolution: 'restart' },
};

beforeEach(() => {
  mocks.query.mockReturnValue({ data: policy, isLoading: false, error: null, refetch: mocks.refetch });
  mocks.mutateAsync.mockResolvedValue(policy);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('renders the SLA editor with Park cards and preserves the policy payload', async () => {
  render(<SlaSettingsPage />);
  const calendar = screen.getByRole('heading', { name: 'Working calendar' }).closest('[class*="card__root"]');
  expect(calendar).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Reopened conversations' })).toBeInTheDocument();
  for (const label of ['Calendar JSON', 'Response target (minutes, optional)', 'Resolution target (minutes, optional)']) {
    const input = screen.getByRole('textbox', { name: label });
    const field = input.closest('[data-scope="field"][data-part="root"]');
    expect(field).toHaveClass('field__root');
    expect(field?.querySelector('[data-scope="field"][data-part="label"]')).toHaveTextContent(label);
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveClass('field__helperText');
  }
  for (const label of ['Response after reopen', 'Resolution after reopen']) {
    const trigger = screen.getByRole('combobox', { name: label });
    const select = trigger.closest('[data-scope="select"][data-part="root"]');
    expect(select).toHaveClass('select__root');
    expect(select?.querySelector('[data-scope="select"][data-part="label"]')).toHaveTextContent(label);
  }
  await userEvent.click(screen.getByRole('combobox', { name: 'Response after reopen' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Restart clock' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Response target (minutes, optional)' }), { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save SLA policy' }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4, responseTargetMs: 5_400_000, resolutionTargetMs: null, reopenPolicy: { response: 'restart', resolution: 'restart' } })));
  const saved = await screen.findByRole('status');
  expect(saved).toHaveClass('alert__root');
  expect(saved).toHaveTextContent('This policy applies only to clocks started after this revision.');
});

it('shows a skeleton during initial load and a retryable empty state on failure', () => {
  mocks.query.mockReturnValueOnce({ data: undefined, isLoading: true, error: null, refetch: mocks.refetch });
  const { rerender } = render(<SlaSettingsPage />);
  expect(screen.getByRole('status', { name: 'Loading SLA policy' })).toHaveAttribute('aria-busy', 'true');
  mocks.query.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Unavailable'), refetch: mocks.refetch });
  rerender(<SlaSettingsPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('SLA policy could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it('keeps the cached policy and unsaved inputs visible when a background refresh fails', () => {
  const { rerender } = render(<SlaSettingsPage />);
  const response = screen.getByRole('textbox', { name: 'Response target (minutes, optional)' });
  fireEvent.change(response, { target: { value: '90' } });
  mocks.query.mockReturnValue({ data: policy, isLoading: false, isFetching: false, error: new Error('Temporary refresh failure'), refetch: mocks.refetch });
  rerender(<SlaSettingsPage />);
  expect(response).toBeInTheDocument();
  expect(response).toHaveValue('90');
  expect(screen.getByRole('heading', { name: 'Working calendar' })).toBeInTheDocument();
  const refreshError = screen.getByRole('alert');
  expect(refreshError).toHaveClass('alert__root');
  expect(refreshError).toHaveTextContent('SLA policy could not be refreshed');
  expect(screen.getByRole('button', { name: 'Save SLA policy' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry SLA policy' }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(response).toHaveValue('90');
  expect(screen.queryByText('SLA policy could not be loaded.')).not.toBeInTheDocument();
});

it('retains unsaved edits after retry and requires review before using a newer policy revision', async () => {
  const { rerender } = render(<SlaSettingsPage />);
  const response = screen.getByRole('textbox', { name: 'Response target (minutes, optional)' });
  fireEvent.change(response, { target: { value: '90' } });
  mocks.query.mockReturnValue({ data: policy, isLoading: false, error: new Error('Refresh failed'), refetch: mocks.refetch });
  rerender(<SlaSettingsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry SLA policy' }));
  mocks.query.mockReturnValue({ data: { ...policy }, isLoading: false, error: null, refetch: mocks.refetch });
  rerender(<SlaSettingsPage />);
  expect(response).toHaveValue('90');
  expect(screen.getByRole('button', { name: 'Save SLA policy' })).toBeEnabled();

  mocks.query.mockReturnValue({ data: { ...policy, revision: 5, responseTargetMs: 1_200_000 }, isLoading: false, error: null, refetch: mocks.refetch });
  rerender(<SlaSettingsPage />);
  expect(response).toHaveValue('90');
  expect(screen.getByRole('alert')).toHaveTextContent('The SLA policy changed elsewhere');
  expect(screen.getByRole('button', { name: 'Save SLA policy' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Use latest revision with my edits' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save SLA policy' }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5, responseTargetMs: 5_400_000 })));
});

it('shows a Park error alert after save failure without clearing the entered policy', async () => {
  mocks.mutateAsync.mockRejectedValueOnce(new Error('Synthetic save failure'));
  render(<SlaSettingsPage />);
  const response = screen.getByRole('textbox', { name: 'Response target (minutes, optional)' });
  fireEvent.change(response, { target: { value: '90' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save SLA policy' }));
  const saveError = await screen.findByRole('alert');
  expect(saveError).toHaveClass('alert__root');
  expect(saveError).toHaveTextContent('Synthetic save failure');
  expect(response).toHaveValue('90');
});

it('rejects fractional target minutes without sending a policy mutation', async () => {
  render(<SlaSettingsPage />);
  const response = screen.getByRole('textbox', { name: 'Response target (minutes, optional)' });
  fireEvent.change(response, { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save SLA policy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Configured targets must be whole minutes');
  expect(response).toHaveValue('1.5');
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});
