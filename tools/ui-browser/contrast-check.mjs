import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.argv[2] ?? 'http://127.0.0.1:5190';
const url = new URL(origin);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/' && !url.username && !url.password);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
  await page.goto(`${url.origin}/__test-login`);
  await page.waitForURL('**/settings/agent-permissions');
  const rows = [];
  const scenarios = [
    { path: '/settings/filters', open: 'Create Filter', text: 'No conditions. This filter will match all tickets.' },
    { path: '/settings/ticket-fields', text: 'Channels' },
    { path: '/profile/security', text: '2FA is currently enabled' },
  ];
  for (const scenario of scenarios) {
    await page.goto(url.origin + scenario.path);
    if (scenario.open) await page.getByRole('button', { name: scenario.open, exact: true }).click();
    const text = page.getByText(scenario.text, { exact: true });
    await text.waitFor();
    const colors = await text.evaluate(element => {
      const foreground = getComputedStyle(element).color;
      let background;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (Number(style.opacity) !== 1 || style.backgroundImage !== 'none') throw new Error('Layer requires manual contrast measurement');
        if (!background && style.backgroundColor !== 'rgba(0, 0, 0, 0)') background = style.backgroundColor;
      }
      return { foreground, background: background ?? 'rgb(255, 255, 255)' };
    });
    const luminance = color => {
      const match = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
      assert.ok(match, `Only opaque sRGB colors supported: ${color}`);
      return match.slice(1).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const a = luminance(colors.foreground), b = luminance(colors.background);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `${scenario.text}: ${ratio} < 4.5`);
    rows.push({ ...scenario, ...colors, ratio, minimum: 4.5 });
  }
  const paths = ['apps/dashboard/src/pages/FiltersSettingsPage.tsx', 'apps/dashboard/src/pages/SecurityProfilePage.tsx', 'apps/dashboard/src/components/layout/SettingsLayout.tsx'];
  console.log(JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), recordedAt: new Date().toISOString(), node: process.version, browser: browser.version(), sourceHashes: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), rows, limitation: 'Three opaque default text pairs in an existing local synthetic operator fixture. Not a whole-page, icon, focus-ring, hover, placeholder or theme contrast audit.' }, null, 2));
} finally { await browser.close(); }
