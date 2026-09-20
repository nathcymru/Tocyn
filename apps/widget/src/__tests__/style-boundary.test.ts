import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { widgetBrandColor } from '../widgetStyles';

const source = (relativePath: string) => readFile(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

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
