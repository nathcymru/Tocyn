import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFile(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('shared stylesheet entry boundaries', () => {
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

  it('keeps UI, widget and legacy override styles inside the widget ShadowRoot', async () => {
    const widgetMain = await source('../main.tsx');

    expect(widgetMain).toContain('shadow.appendChild(primitiveStyleElement)');
    expect(widgetMain).toContain('shadow.appendChild(widgetStyleElement)');
    expect(widgetMain).toContain('shadow.appendChild(legacyWidgetStyles)');
    expect(widgetMain.toLowerCase()).not.toContain('tailwind');
    expect(widgetMain).not.toContain('document.head.appendChild');
  });
});
