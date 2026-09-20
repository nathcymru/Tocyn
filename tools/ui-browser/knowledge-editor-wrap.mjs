import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// A visual geometry regression for long Markdown content. All API data is synthetic.
const origin = process.env.TOCYN_DASHBOARD_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const results = [];

try {
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block',
      });
      await context.addInitScript(() => localStorage.setItem('lumina-auth', JSON.stringify({
        state: {
          token: 'synthetic-browser-token',
          user: { id: 'synthetic-operator', tenant_id: 'synthetic-tenant', email: 'operator@example.invalid', full_name: 'Synthetic Operator', role: 'admin', mfa_enabled: true },
          mfaRequired: false,
        }, version: 0,
      })));
      let writes = 0;
      let external = 0;
      const errors = [];
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) { external += 1; return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') { writes += 1; return route.abort(); }
        if (url.pathname === '/api/knowledge/categories') return route.fulfill({ json: [] });
        if (url.pathname === '/api/workspace/presentation-preference') return route.fulfill({ json: { version: 2, revision: 0, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'compact', contextDefault: 'remember', shortcutsEnabled: true, interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null } });
        if (url.pathname === '/api/workspace/theme-preference') return route.fulfill({ json: { revision: 0, mode: 'system', updatedAt: null } });
        if (url.pathname === '/api/settings/theme') return route.fulfill({ json: { fallback: true, version: '1', light: {}, dark: {} } });
        return route.fulfill({ json: [] });
      });

      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/knowledge/new`);
      await page.getByRole('heading', { name: 'New Article' }).waitFor();
      const editor = page.getByRole('textbox', { name: 'Content (Markdown)' });
      await editor.fill(`Synthetic content ${'LONGTOKEN'.repeat(22)}`);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const content = document.querySelector('.ProseMirror[role="textbox"]');
        const toolbar = document.querySelector('[role="toolbar"][aria-label="Formatting controls"]');
        const card = content?.closest('.knowledgeEditor__card');
        const rect = element => element?.getBoundingClientRect().toJSON();
        return {
          viewport: innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          card: rect(card), toolbar: rect(toolbar), editor: rect(content),
          editorScrollWidth: content?.scrollWidth, editorClientWidth: content?.clientWidth,
        };
      });
      assert.equal(geometry.pageWidth, width, 'the page must not scroll horizontally');
      assert.ok(geometry.card && geometry.toolbar && geometry.editor, 'the Park card and Tiptap editor must render');
      assert.ok(geometry.card.right <= width + 1, 'the card must fit the viewport');
      assert.ok(geometry.toolbar.right <= geometry.card.right + 1, 'the formatting toolbar must fit its card');
      assert.ok(geometry.editor.right <= geometry.card.right + 1, 'the editable body must fit its card');
      assert.ok(geometry.editorScrollWidth <= geometry.editorClientWidth + 1, 'the long token must wrap inside the editable body');
      assert.deepEqual(errors, []);
      assert.equal(writes, 0);
      assert.equal(external, 0);
      const screenshot = `/tmp/tocyn-knowledge-editor-wrap-${colorScheme}-${width}.png`;
      await page.screenshot({ path: screenshot });
      results.push({ colorScheme, width, geometry, screenshot });
      await context.close();
    }
  }
  console.log(JSON.stringify({ passed: true, synthetic: true, results }));
} finally {
  await browser.close();
}
