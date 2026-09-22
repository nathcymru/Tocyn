import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Synthetic, read-only browser contrast check for Park solid and selected controls.
const origin = process.env.TOCYN_DASHBOARD_ORIGIN ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const reports = [];
function luminance(color) {
  const channels = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)?.slice(1).map(Number);
  assert.equal(channels?.length, 3, `Expected an opaque RGB color, received ${color}`);
  const linear = channels.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: scheme, serviceWorkers: 'block' });
    let writes = 0;
    let external = 0;
    const errors = [];
    try {
      await context.addInitScript(() => localStorage.setItem('lumina-auth', JSON.stringify({
        state: { token: 'synthetic-browser-token', user: { id: 'synthetic-operator', tenant_id: 'synthetic-tenant', email: 'operator@example.invalid', full_name: 'Synthetic Operator', role: 'admin', mfa_enabled: true }, mfaRequired: false }, version: 0,
      })));
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) { external += 1; return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') { writes += 1; return route.abort(); }
        if (url.pathname === '/api/workspace/presentation-preference') return route.fulfill({ json: { version: 2, revision: 0, density: 'comfortable', fontScale: 'normal', focusMode: false, motion: 'system', navigation: 'compact', contextDefault: 'remember', shortcutsEnabled: true, interruptionLevel: 'standard', advanceAfterResolve: false, updatedAt: null } });
        if (url.pathname === '/api/workspace/theme-preference') return route.fulfill({ json: { revision: 0, mode: scheme, updatedAt: null } });
        if (url.pathname === '/api/settings/theme') return route.fulfill({ json: { fallback: true, version: '1', light: {}, dark: {} } });
        return route.fulfill({ json: [] });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/knowledge`);
      await page.waitForFunction(mode => document.documentElement.dataset.tocynThemeMode === mode, scheme);
      if (scheme === 'dark') await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
      await page.getByRole('button', { name: 'All Articles' }).waitFor();
      // Park controls animate colors briefly when the saved theme restores.
      // Inspect the stable theme after that transition has completed.
      await page.waitForTimeout(300);
      for (const width of [800, 900]) {
        await page.setViewportSize({ width, height: 700 });
        if (scheme === 'dark' && width === 900) await page.screenshot({ path: '/tmp/tocyn-solid-dark-settled.png' });
        const rows = await page.evaluate(() => {
          const names = ['All Articles', 'Disconnected', 'New Article', 'Create article'];
          const root = getComputedStyle(document.documentElement);
          const tokens = { className: document.documentElement.className, mode: document.documentElement.dataset.tocynThemeMode, gray1: root.getPropertyValue('--colors-gray-1').trim(), gray12: root.getPropertyValue('--colors-gray-12').trim(), solidBg: root.getPropertyValue('--colors-color-palette-solid-bg').trim(), solidFg: root.getPropertyValue('--colors-color-palette-solid-fg').trim() };
          return { tokens, controls: names.map(name => {
            const element = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === name || button.textContent?.trim() === name);
            if (!element) return { name, missing: true };
            const style = getComputedStyle(element);
            const svg = element.querySelector('svg');
            return { name, classes: element.className, color: style.color, background: style.backgroundColor, iconColor: svg ? getComputedStyle(svg).color : null, transitionDuration: style.transitionDuration, gray1: style.getPropertyValue('--colors-gray-1').trim(), gray12: style.getPropertyValue('--colors-gray-12').trim(), solidBg: style.getPropertyValue('--colors-color-palette-solid-bg').trim(), solidFg: style.getPropertyValue('--colors-color-palette-solid-fg').trim(), lightAncestor: element.closest('.light')?.tagName ?? null };
          }) };
        });
        for (const control of rows.controls) {
          assert.equal(control.missing, undefined, `${scheme} ${width}px: ${control.name} is missing`);
          assert.match(control.classes, /button--variant_solid/, `${scheme} ${width}px: ${control.name} lost the Park solid recipe`);
          control.textContrast = Number(contrast(control.color, control.background).toFixed(2));
          assert.ok(control.textContrast >= 4.5, `${scheme} ${width}px: ${control.name} text contrast ${control.textContrast}:1`);
          if (control.iconColor) {
            control.iconContrast = Number(contrast(control.iconColor, control.background).toFixed(2));
            assert.ok(control.iconContrast >= 3, `${scheme} ${width}px: ${control.name} icon contrast ${control.iconContrast}:1`);
          }
        }
        reports.push({ scheme, width, ...rows, errors, writes, external });
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      for (const width of [800, 900]) {
        await page.setViewportSize({ width, height: 700 });
        const durations = await page.evaluate(() => ['All Articles', 'Disconnected'].map(name => {
          const button = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === name || element.textContent?.trim() === name);
          return { name, duration: button ? getComputedStyle(button).transitionDuration : null };
        }));
        for (const row of durations) assert.equal(row.duration, '1e-05s', `${scheme} ${width}px: ${row.name} should honour reduced motion`);
        reports.push({ scheme, width, motion: 'reduce', durations });
      }
      assert.deepEqual(errors, []);
      assert.equal(writes, 0);
      assert.equal(external, 0);
    } finally { await context.close(); }
  }
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
