import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const urls = process.argv.slice(2);
assert.equal(urls.length, 2, 'Provide local operator and customer login URLs');
for (const value of urls) { const url = new URL(value); assert.equal(url.protocol, 'http:'); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)); }
const browser = await chromium.launch({ headless: true });
try {
  for (const url of urls) for (const mode of ['light', 'dark']) for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: mode });
    const page = await context.newPage(); const splashRequests = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/splash/')) splashRequests.push(request.url()); });
    await page.goto(url); await page.locator('.tocyn-auth-form input').first().waitFor();
    assert.equal(await page.locator('.tocyn-auth').getAttribute('data-auth-mode'), mode);
    if (width < 768) {
      assert.equal(await page.locator('.tocyn-auth-splash').count(), 0);
      assert.equal(splashRequests.length, 0);
    } else {
      const panel = page.locator('.tocyn-auth-splash');
      assert.ok((await panel.boundingBox()).width <= width * 0.45);
      const image = panel.locator('img');
      assert.equal(await image.evaluate(img => getComputedStyle(img).objectPosition), '0% 0%');
      assert.ok((await image.getAttribute('src')).startsWith(`/splash/${mode}/`));
      await image.evaluate(img => img.decode());
      const before = await image.getAttribute('src');
      await page.locator('.tocyn-auth-form input').first().fill('synthetic@example.invalid');
      assert.equal(await image.getAttribute('src'), before);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/private/tmp/tocyn-auth-${new URL(url).port}-${mode}-${width}.png` });
    await context.close();
  }
  console.log(JSON.stringify({ passed: true, variants: 8, checks: ['theme pools', '45% maximum', 'top-left anchor', 'mobile omission/no splash request', 'stable during typing', 'no horizontal overflow'], scope: 'local browser layout; not a backend-authentication proof' }));
} finally { await browser.close(); }
