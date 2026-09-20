import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorThemeControl, OperatorThemeProvider } from '../OperatorThemeProvider';
import { useOperatorTheme } from '../../../hooks/useOperatorTheme';

vi.mock('../../../hooks/useOperatorTheme', () => ({ useOperatorTheme: vi.fn() }));
const scope = { apply: vi.fn(), remove: vi.fn() };
vi.mock('@luminatick/ui', async () => ({
  ...(await vi.importActual<typeof import('@luminatick/ui')>('@luminatick/ui')),
  createTocynThemeScope: vi.fn(() => scope),
}));

const theme = (status: string, overrides: Record<string, unknown> = {}) => ({
  mode: 'system', resolvedMode: 'light', revision: 0, updatedAt: null,
  theme: { version: '1', light: {}, dark: {} }, error: null,
  updateMode: vi.fn(), save: vi.fn(), retry: vi.fn(), restore: vi.fn(), status, ...overrides,
}) as ReturnType<typeof useOperatorTheme>;

describe('OperatorThemeProvider', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useOperatorTheme).mockReset(); });

  it('keeps the workspace usable with Park skeleton and progress feedback, then resolves it', () => {
    const hook = vi.mocked(useOperatorTheme);
    hook.mockReturnValueOnce(theme('loading')).mockReturnValueOnce(theme('restored')).mockReturnValue(theme('loading'));
    const view = render(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading appearance');
    expect(screen.getByRole('textbox', { name: 'composer' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(document.querySelector('[class~="skeleton"]')).not.toBeNull();
    act(() => view.rerender(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>));
    const composer = screen.getByRole('textbox', { name: 'composer' });
    expect(composer).toBeInTheDocument();
    act(() => view.rerender(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>));
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(composer);
    expect(scope.remove).not.toHaveBeenCalled();
  });

  it('keeps a safe fallback usable and exposes retry after restore failure', () => {
    const retry = vi.fn();
    vi.mocked(useOperatorTheme).mockReturnValue(theme('error', { error: 'Appearance unavailable.', retry }));
    render(<OperatorThemeProvider><OperatorThemeControl /></OperatorThemeProvider>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('alert__root');
    expect(alert.querySelector('.alert__description')).toHaveTextContent('Appearance unavailable.');
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry appearance' })[0]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps a previously restored workspace mounted while a preference conflict is shown', () => {
    const hook = vi.mocked(useOperatorTheme);
    hook.mockReturnValue(theme('restored'));
    const view = render(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>);
    const composer = screen.getByRole('textbox', { name: 'composer' });
    const retry = vi.fn();
    hook.mockReturnValue(theme('conflict', { error: 'Theme preference changed elsewhere.', retry }));
    act(() => view.rerender(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>));
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(composer);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('alert__root');
    expect(alert.querySelector('.alert__description')).toHaveTextContent('Theme preference changed elsewhere.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry appearance' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the workspace usable through an initial timeout and appearance recovery', () => {
    const retry = vi.fn();
    const hook = vi.mocked(useOperatorTheme);
    hook.mockReturnValue(theme('error', { error: 'Appearance settings took too long to load. Check your connection and retry.', retry }));
    const view = render(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('alert__root');
    expect(alert).toHaveTextContent('Appearance settings could not be loaded');
    expect(screen.getByRole('heading', { level: 1, name: 'Appearance settings could not be loaded' })).toHaveClass('alert__title');
    expect(alert.querySelector('.alert__description')).toHaveTextContent('took too long');
    const composer = screen.getByRole('textbox', { name: 'composer' });
    composer.focus();
    fireEvent.change(composer, { target: { value: 'Draft survives theme recovery' } });
    expect(composer).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Retry appearance' }));
    expect(retry).toHaveBeenCalledTimes(1);
    hook.mockReturnValue(theme('loading'));
    act(() => view.rerender(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>));
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(composer);
    hook.mockReturnValue(theme('restored'));
    act(() => view.rerender(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>));
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(composer);
    expect(composer).toHaveValue('Draft survives theme recovery');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('removes the scoped CSSOM values on unmount', () => {
    vi.mocked(useOperatorTheme).mockReturnValue(theme('restored'));
    const view = render(<OperatorThemeProvider><span>workspace</span></OperatorThemeProvider>);
    view.unmount();
    expect(scope.remove).toHaveBeenCalledTimes(1);
  });

  it('provides keyboard reachable controls without remounting workspace inputs', async () => {
    const hook = vi.mocked(useOperatorTheme);
    const first = theme('restored');
    const second = theme('unsaved', { mode: 'dark', resolvedMode: 'dark' });
    hook.mockReturnValue(first);
    const view = render(<OperatorThemeProvider><><OperatorThemeControl /><input aria-label="composer" /></></OperatorThemeProvider>);
    const input = screen.getByRole('textbox', { name: 'composer' });
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    const dark = screen.getByRole('radio', { name: 'Dark' });
    dark.focus();
    expect(document.activeElement).toBe(dark);
    await userEvent.click(screen.getByText('Dark'));
    expect(first.updateMode).toHaveBeenCalledWith('dark');
    hook.mockReturnValue(second);
    act(() => view.rerender(<OperatorThemeProvider><><OperatorThemeControl /><input aria-label="composer" /></></OperatorThemeProvider>));
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(input);
  });
});
