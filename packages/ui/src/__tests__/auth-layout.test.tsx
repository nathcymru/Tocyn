// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthLayout } from '../auth-layout';

beforeEach(() => { window.history.replaceState({}, ''); document.documentElement.removeAttribute('data-tocyn-theme-mode'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function media(wide: boolean, dark = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') ? wide : dark, addEventListener() {}, removeEventListener() {} }));
}
it('omits splash elements on mobile while retaining the form', () => {
  media(false);
  const view = render(<AuthLayout><input aria-label="Email" /></AuthLayout>);
  expect(view.container.querySelector('.tocyn-auth-splash')).toBeNull();
  expect(screen.getByLabelText('Email')).toBeTruthy();
});
it('uses the explicit app mode before the system preference', () => {
  media(true, false); document.documentElement.setAttribute('data-tocyn-theme-mode', 'dark');
  const view = render(<AuthLayout>Form</AuthLayout>);
  expect(view.container.querySelector('.tocyn-auth-splash img')?.getAttribute('src')).toContain('/splash/dark/');
});
it('retains the choice across auth-boundary remounts but selects again for a new entry', () => {
  media(true); const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99);
  const first = render(<AuthLayout>Credentials</AuthLayout>);
  const src = first.container.querySelector('.tocyn-auth-splash img')?.getAttribute('src');
  first.unmount();
  const second = render(<AuthLayout>Verification</AuthLayout>);
  expect(second.container.querySelector('.tocyn-auth-splash img')?.getAttribute('src')).toBe(src);
  expect(random).toHaveBeenCalledTimes(1);
  second.unmount(); window.history.replaceState({}, '');
  const nextVisit = render(<AuthLayout>Credentials</AuthLayout>);
  expect(nextVisit.container.querySelector('.tocyn-auth-splash img')?.getAttribute('src')).not.toBe(src);
});
