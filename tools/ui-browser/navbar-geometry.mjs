import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Inspect the rendered shell with synthetic identity and read-only responses.
// This is specialist visual acceptance, deliberately outside routine CI.
const origin = process.env.TOCYN_DASHBOARD_ORIGIN ?? 'http://127.0.0.1:5173';
const widths = [450, 640, 768, 800, 900, 1280]; // 450 CSS px also represents a 900px viewport at 200% zoom.
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: widths[0], height: 700 }, serviceWorkers: 'block' });
const errors = [];
let writes = 0;
let external = 0;

try {
  await context.addInitScript(() => localStorage.setItem('lumina-auth', JSON.stringify({
    state: {
      token: 'synthetic-browser-token',
      user: { id: 'synthetic-operator', tenant_id: 'synthetic-tenant', email: 'operator@example.invalid', full_name: 'Synthetic Operator', role: 'admin', mfa_enabled: true },
      mfaRequired: false,
    }, version: 0,
  })));
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { external += 1; return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') { writes += 1; return route.abort(); }
    if (url.pathname === '/api/workspace/presentation-preference') return route.fulfill({ json: { version: 2, revision: 0, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'compact', contextDefault: 'remember', shortcutsEnabled: true, interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null } });
    if (url.pathname === '/api/workspace/theme-preference') return route.fulfill({ json: { revision: 0, mode: 'system', updatedAt: null } });
    if (url.pathname === '/api/settings/theme') return route.fulfill({ json: { fallback: true, version: '1', light: {}, dark: {} } });
    return route.fulfill({ json: [] });
  });

  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/knowledge`);
  await page.getByRole('button', { name: 'Activity' }).waitFor();
  const measure = () => page.evaluate(() => {
    const rect = element => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const header = document.querySelector('header');
    const search = header?.querySelector('[class*="shell__headerSearch"]');
    const scope = search?.querySelector('[class*="globalSearch__scope"]');
    const input = search?.querySelector('input[aria-label*="global shell"]');
    const activity = header?.querySelector('button[aria-label^="Activity"]');
    const visible = [...(header?.children ?? [])].filter(element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0);
    return { header: rect(header), search: rect(search), scope: rect(scope), input: rect(input), activity: rect(activity), children: visible.map(element => ({ selector: element.className || element.tagName, rect: rect(element) })), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const results = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(100);
    if (width === 800 || width === 900) await page.screenshot({ path: `/tmp/tocyn-navbar-${width}-light.png` });
    results.push({ width, scheme: 'light', ...await measure() });
  }
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.tocynThemeMode === 'dark');
  await page.screenshot({ path: '/tmp/tocyn-navbar-900-dark.png' });
  results.push({ width: 900, scheme: 'dark', ...await measure() });
  console.log(JSON.stringify({ results, errors, writes, external }, null, 2));
  for (const result of results) {
    assert.ok(result.scope.right <= result.search.right + 1, `${result.width}px: search scope escapes the search slot`);
    assert.ok(result.input.width >= 100, `${result.width}px: search field is too narrow to use`);
    for (let i = 0; i < result.children.length; i += 1) {
      for (let j = i + 1; j < result.children.length; j += 1) {
        const a = result.children[i].rect;
        const b = result.children[j].rect;
        const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert.ok(horizontal < 1 || vertical < 1, `${result.width}px: navbar children overlap`);
      }
    }
    assert.equal(result.overflow, false, `${result.width}px: document overflows horizontally`);
  }
  assert.deepEqual(errors, []);
  assert.equal(writes, 0);
  assert.equal(external, 0);
} finally {
  await context.close();
  await browser.close();
}
