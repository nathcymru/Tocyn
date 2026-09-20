import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperatorPreferencesControl, OperatorThemeProvider } from '../components/theme/OperatorThemeProvider';

const state = vi.hoisted(() => ({
  status: 'restored',
  update: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../hooks/useOperatorTheme', () => ({
  useOperatorTheme: () => ({ status: 'idle', mode: 'system', resolvedMode: 'light', theme: {}, error: '', retry: vi.fn() }),
}));
vi.mock('../hooks/useOperatorPreferences', () => ({
  useOperatorPreferences: () => ({
    status: state.status,
    schemaUnavailable: false,
    density: 'comfortable', fontScale: 'normal', motion: 'system', navigation: 'labelled',
    contextDefault: 'remember', interruptionLevel: 'standard',
    focusMode: false, shortcutsEnabled: true, advanceAfterResolve: false,
    update: state.update, save: state.save, retry: vi.fn(), restore: vi.fn(), error: '',
  }),
}));

afterEach(() => { cleanup(); state.status = 'restored'; vi.clearAllMocks(); });

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
});
