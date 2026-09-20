import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// A synthetic slow lazy-route load; no API writes or external requests are allowed.
const origin = process.env.TOCYN_DASHBOARD_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const errors = [];
let delayedRoute = false;
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
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { external += 1; return route.abort(); }
    if (url.pathname.includes('/src/pages/KnowledgePage.tsx')) {
      delayedRoute = true;
      await new Promise(resolve => setTimeout(resolve, 7_000));
      return route.continue();
    }
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
  const loading = page.getByRole('status', { name: 'Loading page' });
  await loading.waitFor();
  assert.equal(await loading.locator('.skeleton').count(), 4);
  const initialAnnouncement = await loading.getByText('Loading page').evaluate(element => ({
    className: element.className,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    clip: getComputedStyle(element).clip,
  }));
  assert.ok(initialAnnouncement.width <= 1 && initialAnnouncement.height <= 1, 'initial announcement must occupy no visible area');
  await loading.getByRole('progressbar', { name: 'Preparing this page…' }).waitFor();
  const screenshot = '/tmp/tocyn-route-slow-progress.png';
  await page.screenshot({ path: screenshot });
  await loading.getByRole('progressbar', { name: 'This page is taking longer than expected to load…' }).waitFor();
  await page.getByRole('heading', { name: 'Knowledge Base' }).waitFor();
  assert.equal(delayedRoute, true);
  assert.deepEqual(errors, []);
  assert.equal(writes, 0);
  assert.equal(external, 0);
  console.log(JSON.stringify({ passed: true, synthetic: true, delayedRoute, screenshot, writes, external, errors }));
} finally {
  await context.close();
  await browser.close();
}
