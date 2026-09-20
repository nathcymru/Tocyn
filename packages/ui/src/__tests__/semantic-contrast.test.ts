// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import pandaConfig from '../../panda.config';
import { slate } from '../theme/colors/slate';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function fallback(value: string): string {
  const match = /,\s*(#[0-9a-f]{6})\)$/i.exec(value);
  if (!match) throw new Error(`Missing static colour fallback: ${value}`);
  return match[1];
}

it('keeps Park textual secondary colour readable across both static palettes', () => {
  const colors = pandaConfig.theme.extend.semanticTokens.colors;
  const css = readFileSync(resolve(import.meta.dirname, '../../src/styles/panda.css'), 'utf8');
  expect(colors.fg.subtle.value).toEqual({ _light: '{colors.gray.11}', _dark: '{colors.gray.11}' });
  expect(css.match(/--colors-fg-subtle: var\(--colors-gray-11\)/g)).toHaveLength(2);

  for (const mode of ['light', 'dark'] as const) {
    const shade = mode === 'light' ? '_light' : '_dark';
    const surface = mode === 'light' ? 'base' : '_dark';
    const foreground = slate['11'].value[shade];
    for (const token of ['bg.canvas', 'bg.surface', 'bg.input', 'selected'] as const) {
      const background = fallback(colors[token].value[surface]);
      expect(contrast(foreground, background), `${mode} fg.subtle on ${token}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it('emits Inter and tabular numerals for installed Park code and table components', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../../src/styles/panda.css'), 'utf8');
  expect(pandaConfig.theme.extend.tokens.fonts.code.value).toBe("'Inter', sans-serif");
  expect(css).toContain("--fonts-code: 'Inter', sans-serif;");
  expect(css).toMatch(/\.table__root\s*\{[^}]*font-family: var\(--fonts-tabular\);[^}]*font-feature-settings: "tnum" 1, "cv01" 1;[^}]*font-variant-numeric: tabular-nums;/);
});
