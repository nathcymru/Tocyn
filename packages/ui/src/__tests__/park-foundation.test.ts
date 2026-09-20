// @vitest-environment node
import { readFileSync } from 'node:fs';
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

  it('uses installed Park sources and Phosphor icons without pseudo markers', () => {
    const shared = read('src/park.tsx');
    const select = read('src/components/ui/select.tsx');
    const button = read('src/components/ui/button.tsx');
    expect(shared).not.toContain('data-park=');
    expect(select).toContain('createStyleContext(select)');
    expect(button).toContain('styled(ark.button, button)');
    expect(select).toContain("from '../phosphor-icons'");
  });
});
