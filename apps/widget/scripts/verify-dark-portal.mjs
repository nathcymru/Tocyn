/** Deliberately invoked browser check; never part of routine PR CI. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const portalAssets = join(repository, 'apps/portal/dist/assets');
const portalCss = readdirSync(portalAssets).find(name => /^index-.*\.css$/.test(name));
assert.ok(portalCss, 'Build the portal before checking the widget in a dark portal host');
const widget = readFileSync(join(repository, 'apps/widget/dist/lumina-widget.js'));
const host = `<!doctype html><html lang="en" class="dark" data-tocyn-theme-mode="dark">
  <head><link rel="stylesheet" href="/assets/${portalCss}"></head>
  <body><div id="root"><main style="min-height:100vh;padding:32px">
    <h1>Dark portal host</h1><p>Separate portal surface</p><button id="host-action">Portal action</button>
  </main></div><script data-widget-key="synthetic" src="/widget.js"></script></body></html>`;

async function measure(page, selector) {
  return page.evaluate(selector => {
    const shadow = document.querySelector('#lumina-widget-container')?.shadowRoot;
    const element = selector.startsWith('label:')
      ? [...(shadow?.querySelectorAll('label') ?? [])].find(label => label.textContent.trim() === selector.slice('label:'.length))
      : shadow?.querySelector(selector);
    if (!element) return null;
    const parse = value => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const [r, g, b, a = 1] = match[1].split(',').map(Number);
      return { r, g, b, a };
    };
    const composite = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      return { r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
        g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
        b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha, a: alpha };
    };
    const luminance = color => [color.r, color.g, color.b]
      .map(channel => channel / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ancestors = [];
    for (let current = element; current;) {
      ancestors.push(current);
      const root = current.getRootNode();
      current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (const ancestor of ancestors.reverse()) {
      const layer = parse(getComputedStyle(ancestor).backgroundColor);
      if (!layer) return { unsupported: `background:${getComputedStyle(ancestor).backgroundColor}` };
      background = composite(layer, background);
    }
    const style = getComputedStyle(element);
    const foreground = parse(style.color);
    if (!foreground) return { unsupported: `foreground:${style.color}` };
    const text = composite(foreground, background);
    const lighter = Math.max(luminance(text), luminance(background));
    const darker = Math.min(luminance(text), luminance(background));
    const box = element.getBoundingClientRect();
    return { color: style.color, ownBackground: style.backgroundColor, background,
      contrast: Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2)),
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } };
  }, selector);
}

const browser = await chromium.launch({ headless: true });
const scenarios = [];
try {
  for (const width of [1280, 320]) for (const signedIn of [true, false]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
    let externalRequests = 0;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'portal.test') { externalRequests++; return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: host });
      if (url.pathname === '/widget.js') return route.fulfill({ contentType: 'application/javascript', body: widget });
      if (url.pathname.endsWith('/config')) return route.fulfill({ json: {
        title: 'Synthetic support', primaryColor: '#2457d6', features: { ticketForm: true, aiChat: false },
      } });
      if (url.pathname.endsWith('/session')) return route.fulfill({ json: signedIn ? { user: { email: 'synthetic@example.invalid' } } : { user: null } });
      if (url.pathname.startsWith('/assets/')) {
        const asset = join(portalAssets, url.pathname.slice('/assets/'.length));
        try { return route.fulfill({ body: readFileSync(asset), contentType: asset.endsWith('.css') ? 'text/css' : 'font/woff2' }); }
        catch { return route.fulfill({ status: 404, body: 'Missing local asset' }); }
      }
      return route.fulfill({ status: 404, body: 'Unexpected local request' });
    });
    try {
      await page.goto('http://portal.test/');
      await page.getByRole('button', { name: 'Open support' }).click();
      if (signedIn) await page.getByRole('textbox', { name: 'Subject' }).waitFor();
      else await page.getByText('Sign in through the support portal to use chat or submit a ticket.').waitFor();
      const selectors = {
        title: 'h2', close: 'button[aria-label="Close support"]:not([aria-expanded])',
        launcher: 'button[aria-expanded]', tab: '[role="tab"]',
        ...(signedIn ? {
          nameLabel: 'label:Your Name', subjectLabel: 'label:Subject',
          subjectInput: 'input[placeholder="How can we help?"]',
          send: 'button[type="submit"]', attribution: '[data-product-attribution]',
        } : { status: '.alert__description', attribution: '[data-product-attribution]' }),
      };
      const samples = Object.fromEntries(await Promise.all(Object.entries(selectors).map(async ([name, selector]) => [name, await measure(page, selector)])));
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('#lumina-widget-container')?.shadowRoot;
        const panel = root?.querySelector('[role="region"]')?.getBoundingClientRect();
        return { portalDark: document.documentElement.classList.contains('dark'), widgetLight: root?.querySelector('#lumina-widget-root')?.classList.contains('light'),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          panelClipped: !panel || panel.left < 0 || panel.right > innerWidth || panel.top < 0 || panel.bottom > innerHeight };
      });
      const screenshotPath = `/tmp/tocyn-widget-dark-portal-${width}-${signedIn ? 'form' : 'status'}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      // A host CSS selector must affect the host control while leaving the shadow control alone.
      const isolation = await page.evaluate(() => {
        const portalButton = document.querySelector('#host-action');
        const launcher = document.querySelector('#lumina-widget-container').shadowRoot.querySelector('button[aria-expanded]');
        const before = getComputedStyle(launcher).outlineWidth;
        const style = document.createElement('style');
        style.textContent = 'body button { outline: 10px solid rgb(200, 0, 0) !important; text-transform: uppercase !important; }';
        document.head.append(style);
        return { hostOutline: getComputedStyle(portalButton).outlineWidth,
          widgetOutlineBefore: before, widgetOutlineAfter: getComputedStyle(launcher).outlineWidth,
          hostTransform: getComputedStyle(portalButton).textTransform,
          widgetTransform: getComputedStyle(launcher).textTransform };
      });
      scenarios.push({ width, signedIn, samples, geometry, isolation, externalRequests, screenshotPath });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }

const failures = scenarios.flatMap(scenario => [
  ...Object.entries(scenario.samples).filter(([, value]) => !value || value.unsupported || value.contrast < 4.5)
    .map(([name, value]) => `${scenario.width}/${scenario.signedIn ? 'form' : 'status'} ${name}: contrast ${value?.contrast ?? value?.unsupported ?? 'missing'}`),
  ...(!scenario.geometry.portalDark || !scenario.geometry.widgetLight || scenario.geometry.horizontalOverflow || scenario.geometry.panelClipped
    ? [`${scenario.width}: theme or geometry boundary failed`] : []),
  ...(scenario.isolation.widgetOutlineAfter !== scenario.isolation.widgetOutlineBefore
    || scenario.isolation.hostTransform !== 'uppercase' || scenario.isolation.widgetTransform !== 'none'
    ? [`${scenario.width}: host CSS selector crossed widget ShadowRoot`] : []),
  ...(scenario.externalRequests ? [`${scenario.width}: ${scenario.externalRequests} external requests`] : []),
]);
const receiptPath = '/tmp/tocyn-widget-dark-portal.json';
writeFileSync(receiptPath, `${JSON.stringify({ scenarios, failures }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ receiptPath, scenarios: scenarios.map(scenario => ({
  width: scenario.width, signedIn: scenario.signedIn, contrast: Object.fromEntries(Object.entries(scenario.samples)
    .map(([name, value]) => [name, value?.contrast ?? null])), geometry: scenario.geometry,
  externalRequests: scenario.externalRequests, screenshotPath: scenario.screenshotPath,
})), failures })}\n`);
assert.deepEqual(failures, [], 'Built widget must remain readable and isolated inside a dark portal');
