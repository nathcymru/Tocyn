// Run against a local portal dev server: node tools/ui-browser/portal-detail-long-subject.mjs [http://127.0.0.1:5174]
// All customer API responses are synthetic; writes and external requests are blocked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5174');
assert.equal(origin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));

const subject = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ticketId = 'synthetic-long-subject';
const createdAt = '2026-09-20T07:00:00Z';
const ticket = {
  id: ticketId, ticket_no: 42, subject, status: 'open', priority: 'normal',
  customer_email: 'customer@example.invalid', created_at: createdAt, updated_at: createdAt,
};
const detail = {
  ticket,
  articles: [{
    id: 'synthetic-article', ticket_id: ticketId, body: 'Synthetic customer message.',
    sender_type: 'customer', is_internal: false, created_at: createdAt, attachments: [],
  }],
  pagination: { next_cursor: null, has_more: false },
};
const sla = {
  response: { state: 'on-track', phase: 'running', dueAt: '2026-09-21T09:00:00Z', remainingWorkingMilliseconds: 3600000, targetWorkingMilliseconds: 7200000 },
  resolution: { state: 'on-track', phase: 'running', dueAt: '2026-09-22T09:00:00Z', remainingWorkingMilliseconds: 7200000, targetWorkingMilliseconds: 14400000 },
  handlerName: 'Synthetic Agent',
};

const browser = await chromium.launch({ headless: true });
const scenarios = [];
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 320, height: 800 }, colorScheme: scheme,
      reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    let externalRequests = 0;
    let blockedWrites = 0;
    const unknownApiPaths = [];
    const pageErrors = [];
    try {
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin.origin) { externalRequests++; return route.abort(); }
        if (!url.pathname.startsWith('/api/v1/customer')) return route.continue();
        if (request.method() !== 'GET') { blockedWrites++; return route.abort(); }
        const path = url.pathname.slice('/api/v1/customer'.length);
        if (path === '/auth/me') return route.fulfill({ json: { user: { id: 'synthetic-customer', name: 'Synthetic Customer', email: 'customer@example.invalid' } } });
        if (path === '/config') return route.fulfill({ json: { TICKET_PREFIX: '#' } });
        if (path === `/tickets/${ticketId}`) return route.fulfill({ json: detail });
        if (path === `/tickets/${ticketId}/sla`) return route.fulfill({ json: sla });
        unknownApiPaths.push(path);
        return route.fulfill({ status: 404, json: { error: 'Synthetic route unavailable' } });
      });
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(new URL(`/tickets/${ticketId}`, origin).href, { waitUntil: 'domcontentloaded' });
      const heading = page.getByRole('heading', { level: 1 });
      await heading.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await heading.evaluate((element, expectedSubject) => {
        const box = element.getBoundingClientRect();
        const messageViewport = document.querySelector('[data-scope="scroll-area"][data-part="viewport"]');
        return {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          headingText: element.textContent?.trim(),
          headingHasCompleteSubject: element.textContent?.includes(expectedSubject) ?? false,
          heading: { left: box.left, right: box.right, width: box.width, height: box.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth },
          messageViewport: messageViewport ? { scrollWidth: messageViewport.scrollWidth, clientWidth: messageViewport.clientWidth } : null,
          backLinkCount: document.querySelectorAll('a[aria-label="Back to Tickets"]').length,
        };
      }, subject);
      assert.equal(geometry.documentWidth, geometry.viewportWidth, `${scheme} detail page overflow: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.headingHasCompleteSubject, true, `${scheme} subject was truncated`);
      assert.ok(geometry.heading.left >= 0 && geometry.heading.right <= geometry.viewportWidth, `${scheme} heading escaped viewport`);
      assert.ok(geometry.heading.scrollWidth <= geometry.heading.clientWidth + 1, `${scheme} heading content overflows its own box`);
      assert.ok(geometry.heading.height > 60, `${scheme} long subject did not wrap into readable lines`);
      assert.ok(geometry.messageViewport && geometry.messageViewport.scrollWidth <= geometry.messageViewport.clientWidth + 1, `${scheme} message feed overflows`);
      assert.equal(geometry.backLinkCount, 1);
      assert.deepEqual(pageErrors, []);
      assert.equal(externalRequests, 0);
      assert.equal(blockedWrites, 0);
      assert.deepEqual(unknownApiPaths, []);
      await page.evaluate(() => scrollTo(0, 0));
      const screenshotPath = `/tmp/tocyn-portal-detail-long-subject-${scheme}-320.png`;
      await page.screenshot({ path: screenshotPath });
      scenarios.push({ scheme, geometry, externalRequests, blockedWrites, unknownApiPaths, pageErrors, screenshotPath });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const receipt = {
  kind: 'tocyn-local-portal-detail-long-subject',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  synthetic: true, browser: 'headless Chromium', reducedMotion: 'reduce', scenarios,
  limitations: ['Synthetic customer responses and loopback Chromium only; no real authentication, backend, Safari, or screen-reader claim.'],
};
writeFileSync('/tmp/tocyn-portal-detail-long-subject.json', `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
