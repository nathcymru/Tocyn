import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const source = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  files: Object.fromEntries(['packages/shared/ui-theme.ts', 'packages/ui/src/theme.ts', 'packages/ui/src/theme-scope.ts', 'packages/ui/src/styles/tocyn.css', 'tools/ui-browser/theme-scope.mjs']
    .map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])),
};
const css = readFileSync(join(root, 'packages/ui/src/styles/tocyn.css'), 'utf8');
const bundle = (await build({ bundle: true, format: 'esm', platform: 'browser', write: false, stdin: { loader: 'ts', resolveDir: root, contents: `
import { createTocynThemeScope } from ${JSON.stringify(join(root, 'packages/ui/src/theme-scope.ts'))};
window.themeCspViolations = [];
document.addEventListener('securitypolicyviolation', event => window.themeCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
const out = document.querySelector('#out');
const button = document.querySelector('#run');
const check = (ok, message) => { if (!ok) throw new Error(message); };
button.addEventListener('click', () => {
  const first = document.querySelector('#first'), second = document.querySelector('#second');
  const input = document.querySelector('#draft'); input.focus(); input.value = 'preserved draft';
  first.style.setProperty('--unrelated', 'keep'); first.style.setProperty('--tocyn-color-text', '#0f172a', 'important'); first.setAttribute('data-tocyn-theme-mode', 'light');
  const original = { text: first.style.getPropertyValue('--tocyn-color-text'), priority: first.style.getPropertyPriority('--tocyn-color-text'), mode: first.getAttribute('data-tocyn-theme-mode') };
  const secondScope = createTocynThemeScope(second, { mode: 'dark' });
  const scope = createTocynThemeScope(first, { mode: 'light' });
  check(second.style.getPropertyValue('--tocyn-color-text') === '#f8fafc', 'second container changed');
  check(document.activeElement === input && input.value === 'preserved draft', 'focus or input changed');
  const light = { surface: getComputedStyle(first).getPropertyValue('--tocyn-color-surface').trim(), text: getComputedStyle(first).getPropertyValue('--tocyn-color-text').trim() };
  check(getComputedStyle(first).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(second).backgroundColor === 'rgb(15, 23, 42)', 'simultaneous rendered surfaces disagree');
  scope.apply({ mode: 'dark' });
  const dark = { surface: getComputedStyle(first).getPropertyValue('--tocyn-color-surface').trim(), text: getComputedStyle(first).getPropertyValue('--tocyn-color-text').trim() };
  check(dark.surface === '#0f172a' && dark.text === '#f8fafc', 'dark replacement failed');
  let invalidRejected = false;
  try { scope.apply({ mode: 'light', instance: { colorSurface: 'url(https://invalid.test)' } }); } catch { invalidRejected = true; }
  check(invalidRejected && first.getAttribute('data-tocyn-theme-mode') === 'dark', 'invalid update was not atomic');
  scope.remove();
  check(first.style.getPropertyValue('--tocyn-color-text') === original.text && first.style.getPropertyPriority('--tocyn-color-text') === original.priority, 'inline priority/value not restored');
  check(first.getAttribute('data-tocyn-theme-mode') === original.mode && first.style.getPropertyValue('--unrelated') === 'keep', 'attributes or unrelated property not restored');
  check(document.activeElement === input && input.value === 'preserved draft', 'remove changed focus or input');
  check(second.getAttribute('data-tocyn-theme-mode') === 'dark' && getComputedStyle(second).color === 'rgb(248, 250, 252)', 'removal changed another active scope');
  secondScope.remove();
  out.textContent = JSON.stringify({ passed: true, light, dark, invalidUpdateAtomic: true, restoredInlinePriority: original.priority, focused: document.activeElement === input, inputValue: input.value });
});
` } })).outputFiles[0].text;

const server = createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'");
  if (req.url === '/tocyn.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/tocyn.css"></head><body><main><button id="run">Run theme scope checks</button><div id="first" data-tocyn-workspace><input id="draft"></div><div id="second" data-tocyn-workspace></div><pre id="out"></pre></main><script type="module" src="/bundle.js"></script></body></html>');
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
const address = server.address(); const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' }); const page = await context.newPage();
  const violations = []; const external = []; page.on('console', message => { if (message.type() === 'error') violations.push(message.text()); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run theme scope checks' }).click();
  const result = JSON.parse(await page.locator('#out').textContent());
  violations.push(...await page.evaluate(() => window.themeCspViolations));
  checkResult(result, violations, external, browser.version());
} finally { if (browser) await browser.close(); await new Promise(resolveClose => server.close(resolveClose)); }

function checkResult(result, violations, external, browserVersion) {
  if (!result.passed || violations.length || external.length) throw new Error(JSON.stringify({ result, violations, external }));
  console.log(JSON.stringify({ version: 1, source, scenario: 'headless Chromium instance-scoped Tocyn theme over loopback HTTP with restrictive CSP', browser: browserVersion, cspViolations: violations, externalRequests: external, result, firstPaint: 'Navigation observes stylesheet/script loading, but this is not input-to-photon or production first-paint timing evidence.', limitations: ['Synthetic DOM fixture only; no authenticated tenant loading, persistence, deployed CSP headers, screen reader, or cross-browser evidence.'] }, null, 2));
}
