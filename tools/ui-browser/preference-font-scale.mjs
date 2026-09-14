import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

// Deliberately separate from routine CI: local browser evidence for #132.
const paths = ['apps/dashboard/src/index.css', 'packages/ui/src/styles/tocyn.css', 'apps/dashboard/src/components/layout/Layout.tsx'];
const sources = paths.map(path => readFileSync(path, 'utf8'));
const hint = sources[2].match(/<span data-tocyn-focus-decoration[^>]*>[^<]*<\/span>/)?.[0].replace('className=', 'class=');
assert.ok(hint, 'Use the actual marked Layout shortcut hint');
const content = `${hint}<section data-tocyn-appearance><h3>Workspace preferences</h3><fieldset><label>Text size<select><option>Standard</option></select></label></fieldset><div><button>Save preferences</button></div></section><p>Workspace state</p>`;
// The evidence check consumes the same authored Panda/static CSS as the app.
// It must not compile a second styling system just to measure representative markup.
const css = { css: sources[0] };
const expectedFactors = { normal: 1, large: 1.125, larger: 1.25 };
const results = [];
for (const browserBase of [16, 20]) {
  // Blink's browser default font setting changes the initial size, not an author
  // pixel override on html. Assert it took effect before exercising preferences.
  const browser = await chromium.launch({ headless: true,
    ...(process.env.TOCYN_BROWSER_EXECUTABLE ? { executablePath: process.env.TOCYN_BROWSER_EXECUTABLE } : {}),
    args: [`--blink-settings=defaultFontSize=${browserBase}`],
  });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<style>${sources[1]}\n${css.css}</style>${content}`);
    const measure = () => page.evaluate(() => Object.fromEntries([
      ['root', document.documentElement], ['label', document.querySelector('label')],
      ['heading', document.querySelector('h3')], ['button', document.querySelector('button')],
      ['select', document.querySelector('select')], ['workspaceText', document.querySelector('.text-sm')],
    ].map(([key, element]) => [key, parseFloat(getComputedStyle(element).fontSize)])));
    const baseline = await measure();
    assert.equal(baseline.root, browserBase, 'Browser initial font size must match requested user default');
    for (const [scale, factor] of Object.entries(expectedFactors)) {
      await page.evaluate(scale => { document.documentElement.dataset.tocynFontScale = scale; }, scale);
      await page.waitForTimeout(250); // Allow the existing 180ms control transition to settle.
      const measured = await measure();
      for (const [name, size] of Object.entries(baseline)) {
        assert.ok(Math.abs(measured[name] - size * factor) < 0.02, `${browserBase}px ${scale}: ${name} expected ${size * factor}, got ${measured[name]}`);
      }
      results.push({ browserBase, scale, measured });
    }
    await page.evaluate(() => { document.documentElement.dataset.tocynFontScale = 'normal'; });
    await page.waitForTimeout(250);
    assert.deepEqual(await measure(), baseline, 'Returning to standard must restore the browser base');
    await page.evaluate(() => { document.documentElement.dataset.tocynFontScale = 'larger'; delete document.documentElement.dataset.tocynFontScale; });
    await page.waitForTimeout(250);
    assert.deepEqual(await measure(), baseline, 'Removing the identity-scoped attribute must restore the browser base');
    const hintLocator = page.locator('[data-tocyn-focus-decoration]');
    assert.equal(await hintLocator.isVisible(), true, 'Shortcut decoration visible at desktop width by default');
    await page.evaluate(() => { document.documentElement.dataset.tocynFocusMode = 'true'; });
    assert.equal(await hintLocator.isVisible(), false, 'Focus mode suppresses the marked decorative hint');
    for (const selector of ['label', 'h3', 'button', 'select', '.text-sm']) {
      assert.equal(await page.locator(selector).isVisible(), true, 'Focus rule must preserve ' + selector);
    }
    await page.evaluate(() => { document.documentElement.dataset.tocynFocusMode = 'false'; });
    assert.equal(await hintLocator.isVisible(), true, 'Disabling focus restores the decoration');
    results.push({ browserBase, reset: 'passed', focusDecoration: 'passed', browser: browser.version() });
  } finally { await browser.close(); }
}
console.log(JSON.stringify({ recordedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceSha256: Object.fromEntries(paths.map((path, index) => [path, createHash('sha256').update(sources[index]).digest('hex')])), results,
  limitations: ['Synthetic representative markup with actual shared/dashboard CSS; no backend or full workspace integration.', '16px and 20px browser defaults supplied through Blink setting; not an OS accessibility session.', 'No 200% zoom/reflow, critical-state preservation or spoken screen-reader acceptance claim.'],
}, null, 2));
