// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { w, widgetBrandColor } from '../widgetStyles';
import { appendLegacyWidgetCss } from '../compatibility-styles';

const source = (relativePath: string) => readFile(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

afterEach(() => vi.unstubAllGlobals());

describe('shared stylesheet entry boundaries', () => {
  it('accepts a tenant hex colour and falls back for untrusted CSS values', () => {
    expect(widgetBrandColor('#3b82f6')).toBe('#3b82f6');
    expect(widgetBrandColor('red; position: fixed')).toBe('#334155');
    expect(widgetBrandColor(null)).toBe('#334155');
  });

  it('imports Panda-backed UI CSS once per document entry', async () => {
    const [dashboardMain, portalMain, widgetMain, sharedStyles] = await Promise.all([
      source('../../../dashboard/src/main.tsx'),
      source('../../../portal/src/main.tsx'),
      source('../main.tsx'),
      source('../../../../packages/ui/src/styles/app-layout.css'),
    ]);

    expect(dashboardMain.match(/@luminatick\/ui\/styles\.css/g)).toHaveLength(1);
    expect(portalMain.match(/@luminatick\/ui\/styles\.css/g)).toHaveLength(1);
    expect(widgetMain.match(/@luminatick\/ui\/styles\.css\?inline/g)).toHaveLength(1);
    expect(sharedStyles.match(/@import ['"]\.\/panda\.css['"]/g)).toHaveLength(1);
  });

  it('keeps the Panda and Park sheet inside the widget ShadowRoot', async () => {
    const widgetMain = await source('../main.tsx');

    expect(widgetMain).toContain('shadow.appendChild(primitiveStyleElement)');
    expect(widgetMain).toContain('root.className = w.host');
    expect(widgetMain).not.toContain('index.css?inline');
    expect(widgetMain).not.toContain('legacyWidgetStyles');
    expect(widgetMain.toLowerCase()).not.toContain('tailwind');
    expect(widgetMain).not.toContain('document.head.appendChild');
    expect(widgetMain.indexOf('appendLegacyWidgetCss(shadow)')).toBeGreaterThan(widgetMain.indexOf('shadow.appendChild(primitiveStyleElement)'));
  });

  it('uses the Park button focus ring without a second widget launcher ring', async () => {
    const [widgetStyles, buttonRecipe] = await Promise.all([
      source('../widgetStyles.ts'),
      source('../../../../packages/ui/src/theme/recipes/button.ts'),
    ]);
    expect(buttonRecipe).toContain("focusVisibleRing: 'outside'");
    expect(widgetStyles).not.toContain('_focusVisible: { boxShadow:');
  });

  it('rebinds the default Park palette where the light tokens exist in the ShadowRoot', async () => {
    const pandaCss = await source('../../../../packages/ui/src/styles/panda.css');
    expect(w.host.split(' ')).toContain('color-palette_gray');
    expect(pandaCss).toMatch(/\.color-palette_gray\s*\{[^}]*--colors-color-palette-solid-bg:\s*var\(--colors-gray-solid-bg\)/);
    expect(pandaCss).toMatch(/:where\(:root, \.light\)\s*\{[^}]*--colors-gray-solid-bg:/);
  });

  it('keeps the optional host CSS absent by default and accepts only a primitive string inside the ShadowRoot', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const generated = document.createElement('style');
    generated.textContent = '.button { color: black; }';
    shadow.appendChild(generated);

    appendLegacyWidgetCss(shadow);
    vi.stubGlobal('LUMINA_WIDGET_CSS', new String('.button { color: red; }'));
    appendLegacyWidgetCss(shadow);
    vi.stubGlobal('LUMINA_WIDGET_CSS', { toString: () => '.button { color: red; }' });
    appendLegacyWidgetCss(shadow);
    expect(shadow.querySelectorAll('style')).toHaveLength(1);

    vi.stubGlobal('LUMINA_WIDGET_CSS', '.button { color: red; }');
    appendLegacyWidgetCss(shadow);
    const styles = shadow.querySelectorAll('style');
    expect(styles).toHaveLength(2);
    expect(styles[0]).toBe(generated);
    expect(styles[1]?.textContent).toBe('.button { color: red; }');
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
    host.remove();
  });

  it('injects bundled Atkinson and Inter font faces with the ShadowRoot sheet', async () => {
    const widgetMain = await source('../main.tsx');
    for (const font of [
      '@fontsource/atkinson-hyperlegible/400.css?inline',
      '@fontsource/atkinson-hyperlegible/700.css?inline',
      '@fontsource/inter/400.css?inline',
      '@fontsource/inter/500.css?inline',
      '@fontsource/inter/600.css?inline',
    ]) expect(widgetMain).toContain(font);
    expect(widgetMain).toContain('primitiveStyleElement.textContent = [');
    expect(widgetMain).not.toMatch(/import ['"]@fontsource\/[^'"?]+\.css['"]/);
  });
});
