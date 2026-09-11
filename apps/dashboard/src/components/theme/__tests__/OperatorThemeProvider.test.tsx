import React from 'react';
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
  beforeEach(() => { vi.clearAllMocks(); });

  it('holds the workspace behind an accessible restore gate, then resolves it', () => {
    const hook = vi.mocked(useOperatorTheme);
    hook.mockReturnValueOnce(theme('loading')).mockReturnValueOnce(theme('restored')).mockReturnValue(theme('loading'));
    const view = render(<OperatorThemeProvider><input aria-label="composer" /></OperatorThemeProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading appearance');
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
    expect(screen.getByRole('alert')).toHaveTextContent('Appearance unavailable.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry appearance' })[0]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('removes the scoped CSSOM values on unmount', () => {
    vi.mocked(useOperatorTheme).mockReturnValue(theme('restored'));
    const view = render(<OperatorThemeProvider><span>workspace</span></OperatorThemeProvider>);
    view.unmount();
    expect(scope.remove).toHaveBeenCalledTimes(1);
  });

  it('provides keyboard reachable controls without remounting workspace inputs', () => {
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
    fireEvent.click(dark);
    expect(first.updateMode).toHaveBeenCalledWith('dark');
    hook.mockReturnValue(second);
    act(() => view.rerender(<OperatorThemeProvider><><OperatorThemeControl /><input aria-label="composer" /></></OperatorThemeProvider>));
    expect(screen.getByRole('textbox', { name: 'composer' })).toBe(input);
  });
});
