import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperatorPreferencesControl, OperatorThemeControl, OperatorThemeProvider } from '../components/theme/OperatorThemeProvider';

const state = vi.hoisted(() => ({
  status: 'restored',
  error: '',
  themeStatus: 'idle',
  themeError: '',
  update: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('../hooks/useOperatorTheme', () => ({
  useOperatorTheme: () => ({ status: state.themeStatus, mode: 'system', resolvedMode: 'light', theme: { light: {}, dark: {} }, error: state.themeError, retry: state.retry, restore: state.restore, updateMode: state.update, save: state.save }),
}));
vi.mock('../hooks/useOperatorPreferences', () => ({
  useOperatorPreferences: () => ({
    status: state.status,
    schemaUnavailable: false,
    density: 'comfortable', fontScale: 'normal', motion: 'system', navigation: 'labelled',
    contextDefault: 'remember', interruptionLevel: 'standard',
    focusMode: false, shortcutsEnabled: true, advanceAfterResolve: false,
    update: state.update, save: state.save, retry: state.retry, restore: state.restore, error: state.error,
  }),
}));

afterEach(() => { cleanup(); state.status = 'restored'; state.error = ''; state.themeStatus = 'idle'; state.themeError = ''; vi.clearAllMocks(); });

it('renders all workspace selectors with official Park Select label anatomy and stable accessible names', () => {
  render(<OperatorThemeProvider><OperatorPreferencesControl /></OperatorThemeProvider>);
  const labels = [
    'Workspace density',
    'Workspace text size',
    'Workspace motion',
    'Navigation labels',
    'Context panel default',
    'Activity interruption level',
  ];
  for (const label of labels) {
    const trigger = screen.getByRole('combobox', { name: label });
    const select = trigger.closest('[data-scope="select"][data-part="root"]');
    expect(select).toHaveClass('select__root');
    expect(select?.querySelector('[data-scope="select"][data-part="label"]')).toHaveTextContent(label);
  }
  expect(screen.getAllByRole('combobox')).toHaveLength(6);
});

it('keeps preference controls disabled while a save is pending', () => {
  state.status = 'saving';
  render(<OperatorThemeProvider><OperatorPreferencesControl /></OperatorThemeProvider>);
  for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save workspace preferences' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving workspace preferences');
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

it('shows Park progress during restore and a retryable Park error without hiding controls', () => {
  state.status = 'loading';
  const view = render(<OperatorThemeProvider><OperatorPreferencesControl /></OperatorThemeProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Restoring workspace preferences');
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  state.status = 'error'; state.error = 'Workspace preferences could not be restored. Retry.';
  view.rerender(<OperatorThemeProvider><OperatorPreferencesControl /></OperatorThemeProvider>);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveClass('alert__root', 'alert__root--status_error');
  expect(screen.getByRole('button', { name: 'Retry workspace preferences' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Workspace density' })).toBeInTheDocument();
});

it('uses one provider alert for appearance errors and Park feedback for a saved choice', () => {
  state.themeStatus = 'error'; state.themeError = 'Theme preferences could not be restored. Retry.';
  const view = render(<OperatorThemeProvider><OperatorThemeControl /></OperatorThemeProvider>);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore server appearance' })).not.toBeInTheDocument();
  state.themeStatus = 'saved'; state.themeError = '';
  view.rerender(<OperatorThemeProvider><OperatorThemeControl /></OperatorThemeProvider>);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveClass('alert__root', 'alert__root--status_success');
  expect(screen.getByRole('status')).toHaveTextContent('Appearance saved.');
  state.themeStatus = 'saving';
  view.rerender(<OperatorThemeProvider><OperatorThemeControl /></OperatorThemeProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Saving appearance');
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});
