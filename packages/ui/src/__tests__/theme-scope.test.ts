// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createTocynThemeScope } from '../theme-scope';

afterEach(() => document.body.replaceChildren());

describe('instance-scoped theme application', () => {
  it('allows one owner per element and fences disposed scopes from a new owner', () => {
    const element = document.createElement('div');
    const first = createTocynThemeScope(element);
    expect(() => createTocynThemeScope(element)).toThrow(/already/);
    first.remove(); first.remove();
    const second = createTocynThemeScope(element, { mode: 'dark' });
    expect(() => first.apply({ mode: 'light' })).toThrow(/removed/);
    first.remove();
    expect(element.dataset.tocynThemeMode).toBe('dark');
    second.remove();
  });
  it('keeps containers, focus and unrelated properties isolated', () => {
    const first = document.createElement('div'); const second = document.createElement('div');
    const input = document.createElement('input'); input.value = 'draft'; first.append(input); input.focus();
    document.body.append(first, second); input.focus();
    first.style.setProperty('--other', 'keep'); second.style.setProperty('--tocyn-color-text', 'original');
    const scope = createTocynThemeScope(first, { instance: { colorSurface: '#ffffff' } });
    expect(first.style.getPropertyValue('--tocyn-color-surface')).toBe('#ffffff');
    expect(second.style.getPropertyValue('--tocyn-color-text')).toBe('original');
    expect(document.activeElement).toBe(input); expect(input.value).toBe('draft'); expect(first.style.getPropertyValue('--other')).toBe('keep');
    scope.remove();
    expect(first.style.getPropertyValue('--tocyn-color-surface')).toBe('');
    expect(first.style.getPropertyValue('--other')).toBe('keep'); expect(document.activeElement).toBe(input);
  });

  it('replaces only managed values and restores original values and mode', () => {
    const element = document.createElement('div'); element.setAttribute('data-tocyn-theme-mode', 'light');
    element.style.setProperty('--tocyn-color-text', '#0f172a');
    const scope = createTocynThemeScope(element, { mode: 'light' });
    scope.apply({ mode: 'dark' });
    expect(element.getAttribute('data-tocyn-theme-mode')).toBe('dark');
    expect(element.style.getPropertyValue('--tocyn-color-text')).toBe('#f8fafc');
    scope.remove();
    expect(element.getAttribute('data-tocyn-theme-mode')).toBe('light');
    expect(element.style.getPropertyValue('--tocyn-color-text')).toBe('#0f172a');
  });

  it('rejects invalid replacements without changing the active DOM state', () => {
    const element = document.createElement('div'); const scope = createTocynThemeScope(element, { mode: 'light' });
    const before = element.getAttribute('data-tocyn-theme-mode'); const color = element.style.getPropertyValue('--tocyn-color-surface');
    expect(() => scope.apply({ mode: 'light', instance: { colorSurface: 'url(https://invalid.test)' } })).toThrow(TypeError);
    expect(element.getAttribute('data-tocyn-theme-mode')).toBe(before); expect(element.style.getPropertyValue('--tocyn-color-surface')).toBe(color);
  });
});
