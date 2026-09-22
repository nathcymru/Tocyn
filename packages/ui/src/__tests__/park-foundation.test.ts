// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(packageRoot, path), 'utf8');

describe('Park UI foundation', () => {
  it('keeps official component recipes as the only component recipe definitions', () => {
    const config = read('panda.config.ts');
    for (const key of ['button', 'input', 'textarea', 'icon', 'select', 'tabs', 'splitter', 'scrollArea']) {
      expect(config).not.toMatch(new RegExp(`^ {8}${key}: \\{`, 'm'));
    }
    expect(config).toContain('...parkRegistryRecipes');
    expect(config).toContain('...parkRegistrySlotRecipes');
    expect(config).toContain("recipes: '*'");
  });

  it('emits official variants, anatomy and resolved token values', () => {
    const css = read('src/styles/panda.css');
    for (const selector of ['.button--variant_solid', '.button--variant_plain', '.button--variant_outline', '.button--variant_surface', '.button--variant_subtle', '.select__content', '.field__label', '.menu__content', '.pin-input__input', '.dialog__content', '.splitter__resizeTrigger', '.authShell__root', '.color-palette_red']) {
      expect(css, selector).toContain(selector);
    }
    expect(css).not.toMatch(/\bcolorPalette\.[\w.]+/);
  });

  it('resets native inset and outset control borders without forcing a second focus outline', () => {
    const config = read('panda.config.ts');
    const css = read('src/styles/panda.css');
    expect(config).toContain('preflight: true');
    expect(config).not.toContain('outlineWidth: \'2px !important\'');
    expect(css).toContain('@layer reset{');
    expect(css).toMatch(/\*,::before,::after,::backdrop,::file-selector-button\s*\{[^}]*border-width: 0px/);
    expect(css).toMatch(/button,input,optgroup,select,textarea,::file-selector-button\s*\{[^}]*font: inherit/);
    expect(css).not.toMatch(/:focus-visible\s*\{[^}]*outline-width: 2px !important/);
  });

  it('places the Park search focus ring around the full composite', () => {
    const css = read('src/styles/panda.css');
    expect(css).toMatch(/\.input--variant_outline:is\(:focus-visible, \[data-focus-visible\]\)\s*\{[^}]*outline-width: var\(--focus-ring-width, 1px\)/);
    expect(css).toMatch(/\.globalSearch__root:has\(\.globalSearch__input:is\(:focus-visible, \[data-focus-visible\]\)\)\s*\{[^}]*outline-width: var\(--focus-ring-width, 2px\);[^}]*outline-style: solid;[^}]*outline-color: var\(--global-color-focus-ring, #005FCC\);[^}]*outline-offset: 2px;/);
    expect(css).toMatch(/\.globalSearch__input\s*\{[^}]*--focus-ring-width: 0px/);
  });

  it('reserves indicator space in every Select size without overriding the logical end inset', () => {
    const css = read('src/styles/panda.css');
    const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)\\s*\\.${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
    expect(css).toMatch(/\.select__root,\.select__control\s*\{[^}]*min-width: var\(--sizes-0\)/);
    expect(rule('select__control')).toContain('position: relative');
    expect(rule('select__valueText')).toContain('min-width: var(--sizes-0)');
    expect(rule('select__indicatorGroup')).toContain('inset-inline-end: var(--spacing-3)');
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) {
      const trigger = rule(`select__trigger--size_${size}`);
      expect(trigger, size).toContain('padding-inline-end: var(--spacing-10)');
      expect(trigger.indexOf('padding-inline-end:'), size).toBeGreaterThan(trigger.indexOf('padding-inline:'));
    }
  });

  it('emits reduced-motion styles for the operator choice and OS preference', () => {
    const css = read('src/styles/panda.css');
    expect(css).toContain('html[data-tocyn-motion="reduced"] *');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('html:not([data-tocyn-motion="full"]) *');
    expect(css).toContain('transition-duration: 0.01ms !important');
    expect(css).toContain('animation-duration: 0.01ms !important');
  });

  it('uses installed Park sources and Phosphor icons without pseudo markers', () => {
    const shared = read('src/park.tsx');
    const select = read('src/components/ui/select.tsx');
    const button = read('src/components/ui/button.tsx');
    expect(shared).not.toContain('data-park=');
    expect(select).toContain('createStyleContext(select)');
    expect(button).toContain('styled(ark.button, button)');
    expect(select).toContain("from '../phosphor-icons'");
  });

  it('keeps removed component adapters out of active application source and public exports', () => {
    const root = resolve(packageRoot, '../..');
    const sourceRoots = ['apps/dashboard/src', 'apps/portal/src', 'apps/widget/src', 'packages/ui/src'];
    const legacyNames = ['Button', 'Input', 'Select', 'Textarea', 'Dialog', 'Tabs', 'Popover', 'ScrollArea', 'Splitter', 'EmptyState']
      .map(name => `Tocyn${name}`);
    const legacyName = new RegExp(`\\b(?:${legacyNames.join('|')})\\b`);
    const offenders: string[] = [];
    const inspect = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'generated') continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) { inspect(path); continue; }
        if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(?:test|spec)\.[jt]sx?$/.test(entry.name)) continue;
        const source = readFileSync(path, 'utf8');
        if (legacyName.test(source) || source.includes('data-' + 'park')
          || source.includes('@luminatick/ui/' + 'primitives')) offenders.push(path.replace(`${root}/`, ''));
      }
    };
    sourceRoots.forEach(directory => inspect(resolve(root, directory)));
    expect(offenders).toEqual([]);
    const exports = JSON.parse(read('package.json')) as { exports: Record<string, unknown> };
    expect(exports.exports).not.toHaveProperty('./primitives');
  });
});
