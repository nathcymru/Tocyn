import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5173');
assert.equal(origin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));

const ticketId = 'beta2-internal-attachment';
const subject = 'Beta 2 internal note with attachment';
const ticket = {
  id: ticketId, ticket_no: null, subject, status: 'open', priority: 'normal', source: 'web',
  customer_email: 'synthetic.customer@example.invalid',
  created_at: '2026-09-10T09:00:00Z', updated_at: '2026-09-10T09:20:00Z',
  articles: [{
    id: 'synthetic-internal-note', sender_type: 'agent', is_internal: true,
    body: 'Internal handoff note for the synthetic case.', body_format: 'plain',
    created_at: '2026-09-10T09:20:00Z',
    attachments: [{ id: 'synthetic-pdf', file_name: 'order-summary.pdf', file_size: 24576, content_type: 'application/pdf' }],
  }],
  pagination: { next_cursor: null, has_more: false },
};
const replyCapability = {
  version: 1, ticketId,
  modes: [
    { visibility: 'public', record: 'ticket_article', channel: 'email', delivery: 'email_attempted',
      recipient: 'ticket_customer', body: { maxCharacters: 16000, acceptedFormats: ['plain', 'markdown-v1'] },
      attachments: { maxCount: 10, maxBytesPerFile: 10485760, contentTypes: ['image/png', 'application/pdf'] } },
    { visibility: 'internal', record: 'ticket_article', channel: 'internal', delivery: 'recorded_only',
      recipient: null, body: { maxCharacters: 16000, acceptedFormats: ['plain', 'markdown-v1'] },
      attachments: { maxCount: 10, maxBytesPerFile: 10485760, contentTypes: ['image/png', 'application/pdf'] } },
  ],
};
const workspace = {
  revision: 1, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '', listAnchor: 'page:1',
  selectedTicketId: ticketId, panel: 'conversation', splitterRatio: 32,
  updatedAt: '2026-09-10T09:00:00Z',
};

const browser = await chromium.launch();
try {
  // The responsive geometry check uses the app default theme. Theme contrast is checked separately.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    await context.addInitScript(() => localStorage.setItem('lumina-auth', JSON.stringify({
      state: {
        token: 'synthetic-browser-token',
        user: { id: 'synthetic-operator', tenant_id: 'synthetic-tenant', email: 'operator@example.invalid',
          full_name: 'Synthetic Operator', role: 'admin', mfa_enabled: true },
        mfaRequired: false,
      },
      version: 0,
    })));
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin.origin) return route.abort();
      const path = url.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (request.method() !== 'GET' && !(request.method() === 'POST' && path === '/api/ticket-sla/projections')) return route.abort();
      if (path === '/api/workspace/state') return route.fulfill({ json: workspace });
      if (path.startsWith('/api/workspace/drafts/')) return route.fulfill({ status: 204, body: '' });
      if (path === '/api/workspace/drafts') return route.fulfill({ json: { items: [], next: null } });
      if (path === '/api/settings/filters') return route.fulfill({ json: [] });
      if (path === '/api/tickets/queue-counts') return route.fulfill({ json: { scope: 'standard_queues',
        counts: { all: 1, actionable: 1, mine: 0, unassigned: 1, mentions: 0, drafts: 0, snoozed: 0 } } });
      if (path === '/api/tickets') return route.fulfill({ json: { data: [ticket], meta: { page: 1, limit: 20, total: 1, total_pages: 1 } } });
      if (path === '/api/ticket-sla/projections') return route.fulfill({ json: {} });
      if (path === `/api/tickets/${ticketId}`) return route.fulfill({ json: ticket });
      if (path === `/api/tickets/${ticketId}/reply-capability`) return route.fulfill({ json: replyCapability });
      if (path === '/api/settings') return route.fulfill({ json: { TICKET_PREFIX: '#' } });
      if (path.endsWith('/support-state')) return route.fulfill({ status: 404, json: { error: 'Not configured' } });
      if (path.endsWith('/history')) return route.fulfill({ json: { data: [], meta: { next_cursor: null } } });
      if (path.endsWith('/utility-actions')) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    await page.goto(new URL(`/inbox/all/${ticketId}`, origin).href);
    await page.getByRole('heading', { level: 1, name: subject }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const readGeometry = () => page.evaluate(() => {
      const bounds = (element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      };
      const main = document.querySelector('.ticketDetail__main');
      const header = document.querySelector('.ticketDetail__header');
      const reference = document.querySelector('.ticketDetail__reference');
      const title = document.querySelector('.ticketDetail__title');
      const titleRow = document.querySelector('.ticketDetail__titleRow');
      return {
        viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
        main: bounds(main), header: bounds(header), reference: bounds(reference),
        title: bounds(title), titleRow: bounds(titleRow),
        titleScrollWidth: title.scrollWidth, titleClientWidth: title.clientWidth,
        rowDirection: getComputedStyle(titleRow).flexDirection,
      };
    });
    const desktop = await readGeometry();
    assert.equal(desktop.rowDirection, 'row');
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 850 });
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('.ticketDetail__titleRow')).flexDirection === expected,
        width === 320 ? 'column' : 'row');
      const geometry = await readGeometry();
      assert.equal(geometry.documentWidth, width);
      assert.ok(geometry.title.width >= 80, `Title collapsed at ${width}px: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.titleScrollWidth <= geometry.titleClientWidth + 1);
      assert.ok(geometry.title.bottom < geometry.main.bottom, `Title left the visible detail pane at ${width}px`);
      assert.ok(geometry.header.height < 300, `Detail header consumed the mobile viewport at ${width}px`);
      assert.equal(geometry.rowDirection, width === 320 ? 'column' : 'row');
      const screenshot = `/tmp/tocyn-ticket-detail-geometry-${width}-light.png`;
      await page.screenshot({ path: screenshot });
      console.log(JSON.stringify({ width, theme: 'light', geometry, screenshot }));
    }
    await context.close();
} finally {
  await browser.close();
}
