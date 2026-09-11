import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { chromium, type Locator, type Page, type Route } from 'playwright';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const maximumBodyBytes = 1024 * 1024;

async function digestDirectory(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else { hash.update(child.slice(directory.length)); hash.update(await readFile(child)); }
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBodyBytes) throw new Error('SLA browser fixture body limit exceeded');
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function staticResponse(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const candidate = pathname.includes('.') ? pathname.slice(1) : 'index.html';
  const path = resolve(root, normalize(candidate));
  if (!path.startsWith(root + sep) && path !== root) return void response.writeHead(403).end();
  try {
    const bytes = await readFile(path);
    const extension = path.slice(path.lastIndexOf('.'));
    const type = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}

async function startServer(fixture: LocalTenantFixture, application: 'dashboard' | 'portal') {
  const root = resolve(repositoryRoot, `apps/${application}/dist`);
  await readFile(join(root, 'index.html'));
  let policyReadFailures = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return await staticResponse(root, url.pathname, response);
      if (application === 'dashboard' && policyReadFailures > 0 && url.pathname === '/api/sla-policy') {
        policyReadFailures -= 1;
        return void response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"Synthetic policy read failure"}');
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string' && ['authorization', 'content-type', 'x-widget-key'].includes(name.toLowerCase())) headers[name] = value;
      }
      const result = await fixture.request(`${url.pathname}${url.search}`, {
        method: request.method, rawBody: await requestBody(request), contentType: request.headers['content-type'] ?? null, headers,
      });
      const contentType = result.headers.get('content-type');
      response.writeHead(result.status, { 'Cache-Control': 'no-store', ...(contentType ? { 'Content-Type': contentType } : {}) }).end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"Local SLA fixture forwarding failed"}'); }
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return Object.freeze({
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    failPolicyReads: (count: number) => { policyReadFailures = count; },
    close: () => new Promise<void>(done => server.close(() => done())),
  });
}

async function operatorSession(fixture: LocalTenantFixture) {
  const login = await fixture.login('operatorA'); assert.equal(login.status, 200);
  const challenge = await login.json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true); assert.equal(typeof challenge.token, 'string');
  const verified = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode('operatorA') } });
  assert.equal(verified.status, 200);
  const session = await verified.json<{ token?: string; user?: unknown }>();
  assert.equal(typeof session.token, 'string'); assert.ok(session.user && typeof session.user === 'object');
  return { token: session.token!, user: session.user };
}

async function customerToken(fixture: LocalTenantFixture): Promise<string> {
  const customer = fixture.principals.customerA;
  const requested = await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', body: { email: customer.email, type: 'magic_link', widgetKey: customer.widgetKey }, ip: `${fixture.rateLimitIdentity}-sla-customer`,
  });
  assert.equal(requested.status, 200);
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const token = new URL(messages.find(message => message.to === customer.email)?.loginLink ?? '').searchParams.get('token');
  assert.ok(token);
  const verified = await fixture.request('/api/v1/customer/auth/verify', { method: 'POST', body: { token, widgetKey: customer.widgetKey }, ip: `${fixture.rateLimitIdentity}-sla-customer` });
  assert.equal(verified.status, 200);
  return (await verified.json<{ token: string }>()).token;
}

async function seedDashboard(page: Page, session: { token: string; user: unknown }) {
  await page.addInitScript(({ token, user }) => localStorage.setItem('lumina-auth', JSON.stringify({ state: { token, user, mfaRequired: false }, version: 0 })), session);
}

async function seedPortal(page: Page, token: string, widgetKey: string) {
  await page.addInitScript(({ token, widgetKey }) => {
    localStorage.setItem('lumina_customer_token', token);
    sessionStorage.setItem('tocyn_widget_key', widgetKey);
  }, { token, widgetKey });
}

type RenderedContrast = Readonly<{ label: string; foreground: string; background: string; ratio: number; unsupported: string | null }>;

/** Mirrors the computed-color compositing used by tools/ui-browser/widget-visual.mjs. */
async function renderedContrast(label: string, locator: Locator): Promise<RenderedContrast> {
  const evaluate = Function('element', 'label', `
    const parse = value => {
      const match = value.match(/^rgba?\\(([^)]+)\\)$/);
      if (!match) return null;
      const parts = match[1].split(',').map(part => Number(part.trim()));
      return (parts.length === 3 || parts.length === 4) && parts.every(Number.isFinite)
        ? { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 } : null;
    };
    const composite = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      return alpha === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha, g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha, b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha, a: alpha };
    };
    const luminance = color => [color.r, color.g, color.b].map(channel => {
      const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const layers = [];
    for (let node = element; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
    let backdrop = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) {
      const color = parse(layer);
      if (!color) return { label, foreground: getComputedStyle(element).color, background: layer, ratio: Number.NaN, unsupported: 'background:' + layer };
      backdrop = composite(color, backdrop);
    }
    const foreground = parse(getComputedStyle(element).color);
    if (!foreground) return { label, foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, ratio: Number.NaN, unsupported: 'foreground:' + getComputedStyle(element).color };
    const compositedForeground = composite(foreground, backdrop);
    const ratio = (Math.max(luminance(compositedForeground), luminance(backdrop)) + 0.05) / (Math.min(luminance(compositedForeground), luminance(backdrop)) + 0.05);
    return { label, foreground: getComputedStyle(element).color, background: 'rgba(' + backdrop.r.toFixed(3) + ', ' + backdrop.g.toFixed(3) + ', ' + backdrop.b.toFixed(3) + ', ' + backdrop.a.toFixed(3) + ')', ratio, unsupported: null };
  `) as (element: unknown, label: string) => RenderedContrast;
  return locator.evaluate(evaluate, label);
}

function assertTextContrast(samples: readonly RenderedContrast[]) {
  assert.ok(samples.every(Boolean), `Contrast measurements were not serializable: ${JSON.stringify(samples)}`);
  const defects = samples.filter(sample => sample.unsupported || sample.ratio < 4.5)
    .map(sample => `${sample.label}: ${sample.unsupported ?? `${sample.ratio.toFixed(2)}:1 (${sample.foreground} on ${sample.background})`}`);
  assert.deepEqual(defects, [], `SLA text must meet 4.5:1 rendered contrast: ${defects.join('; ')}`);
}

test('proves production dashboard and portal SLA workflow against disposable two-tenant Worker/D1 state', async () => {
  await withTwoTenantFixture(async fixture => {
    const dashboard = await startServer(fixture, 'dashboard');
    const portal = await startServer(fixture, 'portal');
    const browser = await chromium.launch({ headless: true });
    const externalRequests: string[] = [];
    const contrast: RenderedContrast[] = [];
    try {
      const session = await operatorSession(fixture);
      const dashboardContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const writerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const portalContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      for (const context of [dashboardContext, writerContext, portalContext]) await context.route('**/*', (route: Route) => {
        const origin = new URL(route.request().url()).origin;
        if (origin !== dashboard.origin && origin !== portal.origin) { externalRequests.push(route.request().resourceType()); return route.abort(); }
        return route.continue();
      });
      const page = await dashboardContext.newPage(); await seedDashboard(page, session);
      const writer = await writerContext.newPage(); await seedDashboard(writer, session);
      const customer = await portalContext.newPage(); await seedPortal(customer, await customerToken(fixture), fixture.principals.customerA.widgetKey);

      const legacy = await fixture.request('/api/tickets', { method: 'POST', token: session.token,
        body: { subject: 'Synthetic legacy SLA browser ticket', customer_email: fixture.principals.customerA.email, body: 'Synthetic legacy SLA evidence' } });
      assert.equal(legacy.status, 201);
      const legacyTicket = await legacy.json<{ id?: string }>(); assert.equal(typeof legacyTicket.id, 'string');
      await fixture.db.prepare('DELETE FROM ticket_sla_clocks WHERE tenant_id=? AND ticket_id=?')
        .bind(fixture.principals.customerA.tenantId, legacyTicket.id).run();
      const legacySlaResponses: Array<{ status: number; url: string }> = [];
      page.on('response', response => {
        if (new URL(response.url()).pathname === `/api/tickets/${legacyTicket.id}/sla`) legacySlaResponses.push({ status: response.status(), url: response.url() });
      });
      const legacy404 = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tickets/${legacyTicket.id}/sla` && response.status() === 404);
      await page.goto(`${dashboard.origin}/tickets/${legacyTicket.id}`);
      await legacy404;
      const legacyUnavailable = page.getByText('Service level is unavailable.', { exact: false }).first();
      await legacyUnavailable.waitFor();
      contrast.push(await renderedContrast('default dashboard unavailable SLA panel', legacyUnavailable));
      assert.deepEqual(legacySlaResponses, [{ status: 404, url: `${dashboard.origin}/api/tickets/${legacyTicket.id}/sla` }], 'The explicit legacy negative scenario must retain one documented SLA 404');
      const legacyInitialized = await fixture.request(`/api/tickets/${legacyTicket.id}/sla/initialize`, { method: 'POST', token: session.token, body: {} });
      assert.equal(legacyInitialized.status, 201, 'An authorized administrator must recover the legacy clock before targets are configured');
      const initializedLegacySla = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tickets/${legacyTicket.id}/sla` && response.status() === 200);
      await page.reload();
      await initializedLegacySla;
      await page.getByRole('heading', { name: 'Service level', exact: true }).waitFor();
      assert.equal(await page.getByText('Service level is unavailable.', { exact: false }).count(), 0, 'Initialized legacy clocks must recover to a readable unavailable-target projection before any policy target is configured');
      assert.deepEqual(legacySlaResponses.map(response => response.status), [404, 200], 'Only the explicit pre-initialization read may return the documented 404');

      dashboard.failPolicyReads(1);
      const failedPolicyRead = page.waitForResponse(response => response.status() === 503 && new URL(response.url()).pathname === '/api/sla-policy');
      await page.goto(`${dashboard.origin}/settings/sla`);
      await failedPolicyRead;
      await page.getByRole('heading', { name: 'Service-level policy', exact: true }).waitFor();
      await expectDefaultPolicy(page);
      contrast.push(await renderedContrast('default dashboard SLA settings response label', page.locator('label', { hasText: 'Response target (minutes, optional)' })));
      contrast.push(await renderedContrast('default dashboard SLA settings response control', page.getByLabel('Response target (minutes, optional)')));
      contrast.push(await renderedContrast('default dashboard SLA settings resolution label', page.locator('label', { hasText: 'Resolution target (minutes, optional)' })));
      contrast.push(await renderedContrast('default dashboard SLA settings resolution control', page.getByLabel('Resolution target (minutes, optional)')));
      await page.getByLabel('Response target (minutes, optional)').fill('30');
      await page.getByLabel('Resolution target (minutes, optional)').fill('90');
      await page.getByRole('button', { name: 'Save SLA policy', exact: true }).click();
      await page.getByText('Saved. This policy applies only to clocks started after this revision.', { exact: true }).waitFor();

      const breachedTicketResponse = await fixture.request('/api/tickets', { method: 'POST', token: session.token,
        body: { subject: 'Synthetic breached SLA browser ticket', customer_email: fixture.principals.customerA.email, body: 'Synthetic breached SLA evidence' } });
      assert.equal(breachedTicketResponse.status, 201);
      const breachedTicket = await breachedTicketResponse.json<{ id?: string }>(); assert.equal(typeof breachedTicket.id, 'string');
      await fixture.db.prepare(`UPDATE ticket_sla_clocks SET response_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours'),
        resolution_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours') WHERE tenant_id=? AND ticket_id=?`)
        .bind(fixture.principals.customerA.tenantId, breachedTicket.id).run();
      const breachedProjection = await (await fixture.request(`/api/tickets/${breachedTicket.id}/sla`, { token: session.token })).json<{ response: { state: string; phase: string }; resolution: { state: string; phase: string } }>();
      assert.equal(breachedProjection.response.state, 'breached'); assert.equal(breachedProjection.response.phase, 'running');
      assert.equal(breachedProjection.resolution.state, 'breached'); assert.equal(breachedProjection.resolution.phase, 'running');

      await writer.goto(`${dashboard.origin}/settings/sla`);
      await writer.getByRole('heading', { name: 'Service-level policy', exact: true }).waitFor();
      await writer.getByLabel('Resolution target (minutes, optional)').fill('120');
      await writer.getByRole('button', { name: 'Save SLA policy', exact: true }).click();
      await writer.getByText('Saved. This policy applies only to clocks started after this revision.', { exact: true }).waitFor();
      const staleSave = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/sla-policy' && response.status() === 409);
      await page.getByLabel('Response target (minutes, optional)').fill('45');
      await page.getByRole('button', { name: 'Save SLA policy', exact: true }).click();
      await staleSave;
      await page.getByText('This policy changed elsewhere. Reload before saving again.', { exact: true }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Service-level policy', exact: true }).waitFor();
      await page.getByLabel('Response target (minutes, optional)').fill('45');
      await page.getByRole('button', { name: 'Save SLA policy', exact: true }).click();
      await page.getByText('Saved. This policy applies only to clocks started after this revision.', { exact: true }).waitFor();

      await fixture.db.prepare("UPDATE tickets SET assigned_to='fixture-operator' WHERE tenant_id='fixture-tenant-a' AND id='fixture-ticket'").run();
      const initialize = await fixture.request('/api/tickets/fixture-ticket/sla/initialize', { method: 'POST', token: session.token, body: {} });
      assert.equal(initialize.status, 201, 'The real Worker must initialize the existing fixture ticket after configured policy save');
      await fixture.db.prepare("INSERT INTO support_state_definitions (tenant_id,id,legacy_status,internal_label,public_label,waiting_reason_required,next_action_required) VALUES ('fixture-tenant-a','waiting-browser','pending','Private waiting label','Waiting for your reply',1,1)").run();

      await page.goto(`${dashboard.origin}/tickets/fixture-ticket`);
      await page.getByRole('button', { name: 'Manage support state', exact: true }).click();
      await page.getByRole('combobox', { name: 'Support state', exact: true }).selectOption('waiting-browser');
      await page.getByLabel('Waiting reason').fill('Private customer account evidence is needed');
      await page.getByLabel('Next action').fill('Private operator follow-up tomorrow');
      await page.getByRole('button', { name: 'Save support state', exact: true }).click();
      await page.getByText('Support state saved.', { exact: true }).waitFor();
      const paused = await (await fixture.request('/api/tickets/fixture-ticket/sla', { token: session.token })).json<{ response: { phase: string }; resolution: { phase: string } }>();
      assert.equal(paused.response.phase, 'paused'); assert.equal(paused.resolution.phase, 'paused');
      const pausedActionBar = page.getByLabel('SLA status').getByText('Paused', { exact: false }).first();
      await pausedActionBar.waitFor();
      contrast.push(await renderedContrast('default dashboard paused SLA action bar', pausedActionBar));
      contrast.push(await renderedContrast('default dashboard paused SLA panel', page.getByRole('region', { name: 'Service level' }).getByText('Paused', { exact: false }).first()));

      await customer.goto(`${portal.origin}/tickets/fixture-ticket?key=${fixture.principals.customerA.widgetKey}`);
      await customer.getByRole('heading', { name: 'Service status', exact: true }).waitFor();
      await customer.getByText('Responsible handler: Synthetic operatorA', { exact: true }).waitFor();
      await customer.getByText('Paused', { exact: true }).first().waitFor();
      assert.equal(await customer.getByText('Private customer account evidence is needed', { exact: true }).count(), 0);
      assert.equal(await customer.getByText('Private operator follow-up tomorrow', { exact: true }).count(), 0);
      assert.equal(await customer.getByText('Private waiting label', { exact: true }).count(), 0);

      await page.goto(`${dashboard.origin}/tickets/fixture-ticket`);
      await page.getByRole('button', { name: 'Manage support state', exact: true }).click();
      await page.getByRole('combobox', { name: 'Support state', exact: true }).selectOption('legacy-open');
      await page.getByRole('button', { name: 'Save support state', exact: true }).click();
      await page.getByText('Support state saved.', { exact: true }).waitFor();
      const resumed = await (await fixture.request('/api/tickets/fixture-ticket/sla', { token: session.token })).json<{ response: { phase: string; dueAt: string | null }; resolution: { phase: string; dueAt: string | null } }>();
      assert.equal(resumed.response.phase, 'running'); assert.equal(resumed.resolution.phase, 'running');
      assert.ok(resumed.response.dueAt && resumed.resolution.dueAt, 'Both configured clocks must be visible as real deadlines after resume');

      await page.goto(`${dashboard.origin}/tickets/fixture-ticket`);
      await page.getByRole('heading', { name: 'Service level', exact: true }).waitFor();
      assert.match(await page.getByLabel('SLA status').innerText(), /First response:.*Resolution:/s);
      assert.match(await page.getByRole('region', { name: 'Service level' }).innerText(), /Handler: Synthetic operatorA/);
      const stateControl = page.getByRole('button', { name: 'Manage support state', exact: true });
      await stateControl.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('combobox', { name: 'Support state', exact: true }).waitFor();

      const breachedBatch = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ticket-sla/projections');
      await page.goto(`${dashboard.origin}/tickets`);
      assert.equal((await breachedBatch).status(), 200, 'The real SLA projection batch must succeed before the list assertion');
      const breachedRow = page.getByRole('link', { name: 'Synthetic breached SLA browser ticket', exact: true }).locator('xpath=ancestor::tr');
      await breachedRow.waitFor();
      await breachedRow.getByText('Breached', { exact: false }).first().waitFor();
      assert.match(await breachedRow.innerText(), /Breached/, 'The conversation list must expose the breached SLA state in text');
      contrast.push(await renderedContrast('default dashboard breached SLA list', breachedRow.getByText('Breached', { exact: false }).first()));
      await page.getByRole('link', { name: 'Synthetic breached SLA browser ticket', exact: true }).click();
      await page.getByLabel('SLA status').getByText('Breached', { exact: false }).first().waitFor();
      assert.match(await page.getByRole('region', { name: 'Service level' }).innerText(), /Breached/, 'The ticket detail panel must expose the breached state in text');
      contrast.push(await renderedContrast('default dashboard breached SLA action bar', page.getByLabel('SLA status').getByText('Breached', { exact: false }).first()));
      contrast.push(await renderedContrast('default dashboard breached SLA panel', page.getByRole('region', { name: 'Service level' }).getByText('Breached', { exact: false }).first()));
      await customer.goto(`${portal.origin}/tickets/${breachedTicket.id}?key=${fixture.principals.customerA.widgetKey}`);
      await customer.getByRole('heading', { name: 'Service status', exact: true }).waitFor();
      const customerBreachedTarget = customer.getByText('Running — target exceeded', { exact: true }).first();
      await customerBreachedTarget.waitFor();
      contrast.push(await renderedContrast('customer portal breached service target', customerBreachedTarget));

      const themePreference = await fixture.request('/api/workspace/theme-preference', { token: session.token });
      assert.equal(themePreference.status, 200, 'The real workspace theme preference must be readable before the dark-theme contrast check');
      const currentTheme = await themePreference.json<{ revision: number }>();
      const darkTheme = await fixture.request('/api/workspace/theme-preference', { method: 'PUT', token: session.token, body: { expectedRevision: currentTheme.revision, mode: 'dark' } });
      assert.equal(darkTheme.status, 200, 'The real workspace theme preference must save dark mode before the dark-theme contrast check');
      await page.goto(`${dashboard.origin}/tickets/${breachedTicket.id}`);
      await page.locator('[data-tocyn-theme-mode="dark"]').waitFor();
      const darkBreachedTarget = page.getByRole('region', { name: 'Service level' }).getByText('Breached', { exact: false }).first();
      await darkBreachedTarget.waitFor();
      contrast.push(await renderedContrast('dark dashboard breached SLA panel', darkBreachedTarget));
      await page.goto(`${dashboard.origin}/tickets/fixture-ticket`);
      const darkOnTrackTarget = page.getByRole('region', { name: 'Service level' }).locator('dd').first();
      await darkOnTrackTarget.waitFor();
      assert.match(await darkOnTrackTarget.innerText(), /Due|On track/, 'The dark-theme fixture clock must remain on track before the pause measurement');
      contrast.push(await renderedContrast('dark dashboard on-track SLA panel', darkOnTrackTarget));
      await page.getByRole('button', { name: 'Manage support state', exact: true }).click();
      await page.getByRole('combobox', { name: 'Support state', exact: true }).selectOption('waiting-browser');
      await page.getByLabel('Waiting reason').fill('Synthetic contrast pause reason');
      await page.getByLabel('Next action').fill('Synthetic contrast next action');
      await page.getByRole('button', { name: 'Save support state', exact: true }).click();
      await page.getByText('Support state saved.', { exact: true }).waitFor();
      const darkPausedTarget = page.getByRole('region', { name: 'Service level' }).locator('dd').first();
      await darkPausedTarget.getByText('Paused', { exact: false }).waitFor();
      contrast.push(await renderedContrast('dark dashboard paused SLA panel', darkPausedTarget));
      assertTextContrast(contrast);

      const foreignTenant = await fixture.request('/api/v1/customer/tickets/fixture-ticket/sla', { token: await (async () => {
        const principal = fixture.principals.customerB;
        const requested = await fixture.request('/api/v1/customer/auth/request', { method: 'POST', body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey }, ip: `${fixture.rateLimitIdentity}-sla-foreign` });
        assert.equal(requested.status, 200);
        const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
        const token = new URL(messages.find(message => message.to === principal.email)?.loginLink ?? '').searchParams.get('token'); assert.ok(token);
        return (await (await fixture.request('/api/v1/customer/auth/verify', { method: 'POST', body: { token, widgetKey: principal.widgetKey }, ip: `${fixture.rateLimitIdentity}-sla-foreign` })).json<{ token: string }>()).token;
      })(), headers: { 'X-Widget-Key': fixture.principals.customerB.widgetKey } });
      assert.equal(foreignTenant.status, 404, 'Tenant B must not observe Tenant A SLA state through colliding ticket IDs');
      assert.equal(externalRequests.length, 0, 'Production dashboard and portal bundles must make no external request');

      process.stdout.write(`${JSON.stringify({
        version: 1, kind: 'tocyn-local-sla-browser', revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().length > 0,
        scope: { dashboard: 'production-dist', portal: 'production-dist', worker: 'disposable-miniflare', tenants: 2, remoteBindings: 0, externalNetworkRequests: externalRequests.length },
        artifact: { dashboardDistSha256: await digestDirectory(resolve(repositoryRoot, 'apps/dashboard/dist')), portalDistSha256: await digestDirectory(resolve(repositoryRoot, 'apps/portal/dist')) },
        checks: { legacyUnavailableUiAndAuthorizedRecovery: true, default24x7UtcPolicy: true, policyReadRetry: true, savedConfiguration: true, realCasConflictThenRefreshRetry: true, breachedRunningListDetailAndCustomer: true, bothClockDeadlines: true, waitingPausesBothClocks: true, resumeRestartsBothClocks: true, customerHandlerDisplay: true, customerPrivateFactsAbsent: true, foreignTenantDenied: true, keyboardReachableControl: true },
        legacySlaNegativeScenario: { route: `/api/tickets/${legacyTicket.id}/sla`, responses: legacySlaResponses },
        contrast,
        limitations: ['Disposable Miniflare D1/R2 bindings and loopback static servers only; this is not deployed Worker or provider evidence.', 'Automated keyboard navigation is evidence for focus and readable labels, not a substitute for the separate native assistive-technology review.', 'Synthetic identities and fixture data only; no external network request, remote binding, customer data, or provider activation.'],
      })}\n`);
      await dashboardContext.close(); await writerContext.close(); await portalContext.close();
    } finally { await browser.close(); await dashboard.close(); await portal.close(); }
  });
});

async function expectDefaultPolicy(page: Page) {
  await page.getByText(/Blank targets remain unavailable; the 24\/7 UTC calendar is the starting policy\./).waitFor();
  assert.equal(await page.getByLabel('Response target (minutes, optional)').inputValue(), '');
  assert.equal(await page.getByLabel('Resolution target (minutes, optional)').inputValue(), '');
}
