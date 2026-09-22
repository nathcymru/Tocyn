import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const { chromium } = createRequire(import.meta.url)('playwright');
const bundle = readFileSync('apps/widget/dist/lumina-widget.js');
const sourcePaths = ['tools/ui-browser/widget-visual.mjs', 'apps/widget/src/main.tsx', 'packages/ui/src/styles/panda.css', 'apps/widget/src/App.tsx', 'apps/widget/src/widgetStyles.ts', 'apps/widget/src/components/TicketForm.tsx', 'apps/widget/dist/lumina-widget.js'];
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/widget.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); return; }
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><body><button>Host control</button><script data-widget-key="synthetic" src="/widget.js"></script></body></html>'); return; }
  response.statusCode = 404; response.end();
});

function visualSnapshot(locator, pseudo = null) {
  return locator.evaluate((element, pseudoElement) => {
    const parse = value => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const values = match[1].split(',').map(part => Number(part.trim()));
      return values.length === 3 || values.length === 4 ? { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 } : null;
    };
    const composite = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      return alpha === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha, g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha, b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha, a: alpha };
    };
    const luminance = color => [color.r, color.g, color.b].map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const background = node => {
      const layers = [];
      let current = node;
      while (current) {
        if (current instanceof Element) layers.push(getComputedStyle(current).backgroundColor);
        const root = current.getRootNode();
        current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
      }
      let result = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) {
        const parsed = parse(layer);
        if (!parsed) return { unsupported: `background:${layer}` };
        result = composite(parsed, result);
      }
      return result;
    };
    const style = getComputedStyle(element, pseudoElement);
    const foreground = parse(style.color);
    const backdrop = background(element);
    const contrast = foreground && !backdrop.unsupported ? (Math.max(luminance(composite(foreground, backdrop)), luminance(backdrop)) + .05) / (Math.min(luminance(composite(foreground, backdrop)), luminance(backdrop)) + .05) : null;
    const box = element.getBoundingClientRect();
    const focusBackdrop = background(element.parentElement ?? element);
    const focusCandidates = [style.outlineColor, ...((style.boxShadow.match(/rgba?\([^)]+\)/g) ?? []).reverse())].map(parse);
    const focusColor = focusCandidates.find(color => color && color.a > 0) ?? null;
    const focusContrast = focusColor && !focusBackdrop.unsupported ? (Math.max(luminance(composite(focusColor, focusBackdrop)), luminance(focusBackdrop)) + .05) / (Math.min(luminance(composite(focusColor, focusBackdrop)), luminance(focusBackdrop)) + .05) : null;
    const root = element.getRootNode();
    const activeInShadow = root instanceof ShadowRoot && root.activeElement === element;
    return { activeInShadow, text: { color: style.color, background: backdrop.unsupported ? null : backdrop, contrast, unsupported: backdrop.unsupported ?? (!foreground ? `foreground:${style.color}` : null) }, focus: { visible: activeInShadow && element.matches(':focus-visible'), outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, boxShadow: style.boxShadow, contrast: focusContrast, unsupported: focusContrast === null ? (focusBackdrop.unsupported ?? 'no nontransparent focus color') : null }, target: { width: box.width, height: box.height } };
  }, pseudo);
}

let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const scenarios = [];
  for (const viewport of [{ name: 'desktop', width: 1200, height: 900 }, { name: 'narrow', width: 320, height: 812 }, { name: 'short', width: 320, height: 480 }]) for (const aiChat of [true, false]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(8_000);
      let externalRequests = 0; let apiWrites = 0;
      await context.route('**/*', route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== origin) { externalRequests++; return route.abort(); }
        if (url.pathname.endsWith('/config')) return route.fulfill({ json: { title: 'Synthetic support', primaryColor: '#2457d6', features: { aiChat, ticketForm: true } } });
        if (url.pathname.endsWith('/session')) return route.fulfill({ json: { user: { email: 'ui-only@example.invalid' } } });
        if (url.pathname.endsWith('/tickets') && request.method() !== 'GET') { apiWrites++; return route.abort(); }
        return route.continue();
      });
      await page.goto(origin);
      const launcher = page.getByRole('button', { name: 'Open support', exact: true }); await launcher.waitFor();
      await page.keyboard.press('Tab'); await launcher.focus(); const launcherVisual = await visualSnapshot(launcher);
      await launcher.press('Enter');
      const close = page.getByRole('button', { name: 'Close support', exact: true }).first(); await close.waitFor();
      const ticket = page.getByRole('tab', { name: 'New Ticket', exact: true });
      const chat = page.getByRole('tab', { name: 'AI Chat', exact: true });
      if (aiChat) { assert.equal(await chat.getAttribute('aria-selected'), 'true'); await chat.focus(); await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('#lumina-widget-container')?.shadowRoot?.activeElement?.textContent?.includes('New Ticket')); assert.equal(await ticket.evaluate(element => element.getRootNode().activeElement === element), true); assert.equal(await chat.getAttribute('aria-selected'), 'true'); await page.keyboard.press('Enter'); }
      else { assert.equal(await chat.count(), 0); assert.equal(await ticket.getAttribute('aria-selected'), 'true'); }
      await ticket.click(); assert.equal(await ticket.getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Tab'); await ticket.focus();
      await page.waitForFunction(element => {
        const style = getComputedStyle(element);
        return element.getRootNode().activeElement === element && element.matches(':focus-visible')
          && parseFloat(style.outlineWidth) >= 2 && parseFloat(style.outlineOffset) >= 2;
      }, await ticket.elementHandle());
      const ticketVisual = await visualSnapshot(ticket);
      await close.focus(); const closeVisual = await visualSnapshot(close);
      const controls = { launcher: launcherVisual, close: closeVisual, ticketTab: ticketVisual, name: await visualSnapshot(page.getByLabel('Your Name', { exact: true })), subject: await visualSnapshot(page.getByLabel('Subject', { exact: true })), message: await visualSnapshot(page.getByLabel('Message', { exact: true })), send: await visualSnapshot(page.getByRole('button', { name: 'Send Message', exact: true })) };
      const subject = page.getByLabel('Subject', { exact: true });
      const send = page.getByRole('button', { name: 'Send Message', exact: true });
      const name = page.getByLabel('Your Name', { exact: true });
      await name.focus();
      controls.name = await visualSnapshot(name);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      // Park Field owns the generated input ID. Follow the labelled control
      // itself instead of assuming an application-specific ID suffix.
      const subjectElement = await subject.elementHandle();
      assert.ok(subjectElement, 'Subject input must be rendered');
      await page.waitForFunction(element => element.getRootNode().activeElement === element, subjectElement);
      assert.equal(await subject.evaluate(element => element.getRootNode().activeElement === element), true, 'Keyboard navigation must focus Subject in the widget shadow tree');
      controls.subject = await visualSnapshot(subject);
      await page.keyboard.press('Tab');
      const message = page.getByLabel('Message', { exact: true });
      assert.equal(await message.evaluate(element => element.getRootNode().activeElement === element), true, 'Keyboard navigation must focus Message after Subject');
      controls.message = await visualSnapshot(message);
      await page.keyboard.press('Tab');
      assert.equal(await send.evaluate(element => element.getRootNode().activeElement === element), true, 'Keyboard navigation must reach Send Message in the widget shadow tree');
      controls.send = await visualSnapshot(send);
      controls.send.keyboardReachable = await send.evaluate(element => {
        const panel = element.getRootNode().querySelector('[role="region"]');
        const scrollArea = element.closest('[data-scope="scroll-area"][data-part="viewport"]');
        const box = element.getBoundingClientRect();
        const panelBox = panel?.getBoundingClientRect();
        return Boolean(panelBox && box.top >= panelBox.top && box.bottom <= panelBox.bottom && (!scrollArea || scrollArea.scrollTop > 0 || scrollArea.scrollHeight <= scrollArea.clientHeight));
      });
      const panel = await page.locator('#lumina-widget-container').evaluate(host => { const panel = host.shadowRoot?.querySelector('[role="region"]'); const box = panel?.getBoundingClientRect(); return { panel: box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height } : null, viewport: { width: innerWidth, height: innerHeight }, documentOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight }; });
      const clipping = !panel.panel || panel.panel.left < 0 || panel.panel.top < 0 || panel.panel.right > panel.viewport.width || panel.panel.bottom > panel.viewport.height || panel.documentOverflow;
      const text = {
        title: await visualSnapshot(page.getByRole('heading', { name: 'Synthetic support', exact: true })),
        placeholder: await visualSnapshot(subject, '::placeholder'),
        footer: await visualSnapshot(page.locator('[data-product-attribution]')),
      };
      const defects = Object.entries({ ...controls, ...text }).flatMap(([name, measurement]) => [
        measurement.text.unsupported ? `${name}: ${measurement.text.unsupported}` : measurement.text.contrast !== null && measurement.text.contrast < 4.5 ? `${name}: text contrast ${measurement.text.contrast.toFixed(2)}:1` : null,
        measurement.focus.visible && measurement.focus.unsupported ? `${name}: ${measurement.focus.unsupported}` : (measurement.focus.visible && measurement.focus.contrast !== null && measurement.focus.contrast < 3 ? `${name}: visible focus contrast ${measurement.focus.contrast.toFixed(2)}:1` : null),
      ]).concat(Object.entries(controls).map(([name, measurement]) => {
        const { width, height } = measurement.target;
        if (width < 24 || height < 24) return `${name}: pointer target below 24px (${width.toFixed(1)}×${height.toFixed(1)}px)`;
        // These are normal controls; Park's 40px size is the approved minimum.
        return width < 40 || height < 40 ? `${name}: normal control below 40px (${width.toFixed(1)}×${height.toFixed(1)}px)` : null;
      })).filter(Boolean);
      // Installed Park inputs and textarea use an inside ring (0px offset);
      // Park buttons and tab triggers use an outside ring (2px offset).
      const focusOffsets = { launcher: 2, close: 2, ticketTab: 2, name: 0, subject: 0, message: 0, send: 2 };
      for (const [name, offset] of Object.entries(focusOffsets)) {
        const focus = controls[name].focus;
        const actualOffset = parseFloat(focus.outlineOffset);
        if (!focus.visible || parseFloat(focus.outlineWidth) < 2 || !Number.isFinite(actualOffset)
          || (offset === 0 ? actualOffset !== 0 : actualOffset < offset)
          || ['none', 'hidden'].includes(focus.outlineStyle)) defects.push(`${name}: Park keyboard ring (2px outline, ${offset}px offset) missing`);
      }
      if (!controls.send.keyboardReachable) defects.push('send: keyboard navigation did not reveal Send Message');
      if (clipping) defects.push('widget panel or document overflow/clipping observed');
      assert.deepEqual(defects, [], `Built widget visual defects (${viewport.name}, AI ${aiChat ? 'on' : 'off'})`);
      const screenshotPath = `/tmp/tocyn-widget-visual-${viewport.name}-ai-${aiChat ? 'on' : 'off'}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      assert.equal(externalRequests, 0, 'Widget visual harness must not access external origins');
      scenarios.push({ viewport, aiChat, selectedTab: aiChat ? 'ticket after keyboard activation' : 'ticket', controls, text, panel, clipping, defects, screenshotPath, externalRequests, blockedApiWrites: apiWrites });
    } finally { await context.close(); }
  }
  // The ShadowRoot keeps a light Park palette even when the embedding page is
  // dark. Check the launcher against that host background after focus settles.
  const darkHost = await browser.newContext({ viewport: { width: 320, height: 812 }, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
  let hostFocus;
  try {
    let externalRequests = 0;
    await darkHost.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { externalRequests++; return route.abort(); }
      if (url.pathname.endsWith('/config')) return route.fulfill({ json: { title: 'Synthetic support', primaryColor: '#2457d6', features: { aiChat: false, ticketForm: true } } });
      if (url.pathname.endsWith('/session')) return route.fulfill({ json: { user: { email: 'ui-only@example.invalid' } } });
      if (route.request().method() !== 'GET') return route.abort();
      return route.continue();
    });
    const page = await darkHost.newPage();
    await page.goto(origin);
    await page.evaluate(() => { document.body.style.backgroundColor = '#0f1115'; });
    const launcher = page.getByRole('button', { name: 'Open support', exact: true });
    await launcher.waitFor();
    await page.keyboard.press('Tab');
    await launcher.focus();
    await page.waitForFunction(element => {
      const shadow = getComputedStyle(element).boxShadow;
      return element.matches(':focus-visible') && /^rgb\([^)]+\) 0px 0px 0px 4px/.test(shadow);
    }, await launcher.elementHandle());
    hostFocus = await launcher.evaluate(element => {
      const css = getComputedStyle(element);
      const shadow = css.boxShadow.match(/^(rgb\([^)]+\)) 0px 0px 0px ([\d.]+)px/);
      const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = value => channels(value).map(channel => { const normal = channel / 255; return normal <= .04045 ? normal / 12.92 : ((normal + .055) / 1.055) ** 2.4; }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
      const backing = shadow?.[1] ?? '';
      const background = getComputedStyle(document.body).backgroundColor;
      const light = backing ? luminance(backing) : 0;
      const dark = luminance(background);
      return { outlineWidth: css.outlineWidth, outlineOffset: css.outlineOffset, backing, backingSpread: Number(shadow?.[2] ?? 0), background, contrast: (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) };
    });
    assert.equal(hostFocus.outlineWidth, '2px');
    assert.equal(hostFocus.outlineOffset, '2px');
    assert.ok(hostFocus.backingSpread >= 4 && hostFocus.contrast >= 3, `Widget launcher focus is not visible on a dark host: ${JSON.stringify(hostFocus)}`);
    assert.equal(externalRequests, 0);
    hostFocus.screenshotPath = '/tmp/tocyn-widget-visual-dark-host-focus.png';
    await page.screenshot({ path: hostFocus.screenshotPath });
  } finally { await darkHost.close(); }
  const receipt = { version: 1, kind: 'tocyn-local-built-widget-visual-keyboard', recordedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0, environment: { node: process.version, browser: browser.version(), headless: true, reducedMotion: 'reduce', localLoopback: true }, sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])), bundleSha256: createHash('sha256').update(bundle).digest('hex'), scenarios, darkHostFocus: hostFocus, limitations: ['Built widget loaded through a disposable local loopback server with synthetic intercepted config/session responses; no backend, provider, authentication, tenant, theme66, or wrapper67 claim.', 'Contrast uses computed opaque/alpha colors composited through ancestors. Unsupported color forms are recorded rather than treated as passing.', 'Visual checks cover default widget controls only, not full screen-reader or cross-browser acceptance.'] };
  writeFileSync('/tmp/tocyn-widget-visual.json', `${JSON.stringify(receipt, null, 2)}\n`); process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
