import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { chromium, type Route } from 'playwright';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { betaCounters, initializeLocalBetaFixture } from './local-beta-fixture';

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
  await visit(directory); return hash.digest('hex');
}

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
    if (size > maximumBodyBytes) throw new Error('Support-state browser fixture body limit exceeded');
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function staticResponse(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const candidate = pathname.includes('.') ? pathname.slice(1) : 'index.html';
  const path = resolve(root, normalize(candidate));
  if (!path.startsWith(root + sep) && path !== root) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    const extension = path.slice(path.lastIndexOf('.'));
    const type = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}

async function startServer(fixture: LocalTenantFixture) {
  const root = resolve(repositoryRoot, 'apps/dashboard/dist');
  await readFile(join(root, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return await staticResponse(root, url.pathname, response);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string' && ['authorization', 'content-type'].includes(name.toLowerCase())) headers[name] = value;
      const result = await fixture.request(`${url.pathname}${url.search}`, { method: request.method, rawBody: await requestBody(request), contentType: request.headers['content-type'] ?? null, headers });
      const contentType = result.headers.get('content-type');
      const nextCursor = result.headers.get('x-next-cursor');
      response.writeHead(result.status, { 'Cache-Control': 'no-store', ...(contentType ? { 'Content-Type': contentType } : {}), ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}) }).end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"Local support-state fixture forwarding failed"}'); }
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return Object.freeze({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>(done => server.close(() => done())) });
}

async function operatorSession(fixture: LocalTenantFixture, principal: 'operatorA' | 'operatorB') {
  const login = await fixture.login(principal); assert.equal(login.status, 200);
  const challenge = await login.json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true); assert.equal(typeof challenge.token, 'string');
  const verified = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(principal) } });
  assert.equal(verified.status, 200);
  const session = await verified.json<{ token?: string; user?: unknown }>();
  assert.equal(typeof session.token, 'string'); assert.ok(session.user && typeof session.user === 'object');
  return Object.freeze({ token: session.token!, user: session.user });
}

async function customerWidgetToken(fixture: LocalTenantFixture, principal: 'customerA' | 'customerB'): Promise<string> {
  const customer = fixture.principals[principal];
  const requested = await fixture.request('/api/v1/customer/auth/request', {
    method: 'POST', body: { email: customer.email, type: 'magic_link', widgetKey: customer.widgetKey }, ip: `${fixture.rateLimitIdentity}-${principal}`,
  });
  assert.equal(requested.status, 200);
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
  const token = new URL(messages.find(message => message.to === customer.email)?.loginLink ?? '').searchParams.get('token');
  assert.ok(token);
  const verified = await fixture.request('/api/v1/customer/auth/verify', { method: 'POST', body: { token, widgetKey: customer.widgetKey }, ip: `${fixture.rateLimitIdentity}-${principal}` });
  assert.equal(verified.status, 200);
  return (await verified.json<{ token: string }>()).token;
}

async function seedSession(page: import('playwright').Page, session: { token: string; user: unknown }) {
  await page.addInitScript(({ token, user }) => localStorage.setItem('lumina-auth', JSON.stringify({ state: { token, user, mfaRequired: false }, version: 0 })), session);
}

test('proves production dashboard support-state workflow against disposable two-tenant Worker/D1 state', async () => {
  await withTwoTenantFixture(async fixture => {
    const server = await startServer(fixture); const browser = await chromium.launch({ headless: true });
    try {
      const sessionA = await operatorSession(fixture, 'operatorA');
      await fixture.db.batch(Array.from({ length: 46 }, (_, index) => fixture.db.prepare(`INSERT INTO support_state_definitions
        (tenant_id,id,legacy_status,internal_label,public_label) VALUES ('fixture-tenant-a',?,'open',?,?)`)
        .bind(`browser-state-${String(index).padStart(3, '0')}`, `State ${String(index).padStart(3, '0')}`, `State ${index}`)));
      const externalRequests: string[] = [];
      const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const contextWriter = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      for (const context of [contextA, contextWriter]) await context.route('**/*', (route: Route) => {
        if (new URL(route.request().url()).origin !== server.origin) { externalRequests.push(route.request().resourceType()); return route.abort(); }
        return route.continue();
      });
      const page = await contextA.newPage(); await seedSession(page, sessionA);

      // Configuration is exercised before the guarded local-beta profile is enabled.
      // This does not assert that local-beta inventory authorizes configuration writes.
      await page.goto(`${server.origin}/settings/support-states`);
      await page.getByRole('heading', { name: 'Support states', exact: true }).waitFor();
      await page.getByLabel('State ID').fill('waiting-on-customer');
      await page.getByLabel('Internal label').fill('Waiting on customer');
      await page.getByLabel('Customer-visible label').fill('We need your reply');
      await page.getByLabel('Legacy lifecycle').selectOption('pending');
      await page.getByLabel('Require waiting reason').check();
      await page.getByLabel('Require next action').check();
      await page.getByRole('button', { name: 'Create state', exact: true }).click();
      await page.getByText('Support state created.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Load more support states', exact: true }).click();
      await page.getByRole('button', { name: 'Edit Waiting on customer', exact: true }).click();
      await page.getByLabel('Customer-visible label').fill('We are waiting for your reply');
      await page.getByRole('button', { name: 'Save state', exact: true }).click();
      await page.getByText('Support state saved.', { exact: true }).waitFor();
      await page.getByText('Customer label: We are waiting for your reply · Legacy lifecycle: pending', { exact: true }).waitFor();
      const directFirstPage = await fixture.request('/api/support-states?limit=50', { token: sessionA.token });
      assert.equal(directFirstPage.status, 200);
      assert.equal((await directFirstPage.clone().json<Array<unknown>>()).length, 50);
      assert.ok(directFirstPage.headers.get('X-Next-Cursor'), 'The Worker must return a continuation cursor for the browser page-two fixture');

      await initializeLocalBetaFixture(fixture, {
        runId: 'support-state-browser', tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
        invitations: Object.values(fixture.principals).map(principal => ({ tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const })),
        limits: { ticketLimit: 1, mutationLimit: 4, recoveryReserve: 1, uploadLimit: 1 },
      });
      const betaFirstPage = await fixture.request('/api/support-states?limit=50', { token: sessionA.token });
      assert.equal(betaFirstPage.status, 200);
      assert.ok(betaFirstPage.headers.get('X-Next-Cursor'), 'The local-beta Worker route must preserve support-state pagination');

      const writer = await contextWriter.newPage(); await seedSession(writer, sessionA);
      const patches: unknown[] = [];
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/tickets/fixture-ticket/support-state' && request.method() === 'PATCH') patches.push(request.postDataJSON()); });
      for (const candidate of [page, writer]) {
        const firstSupportStatePage = candidate.waitForResponse(response => {
          const request = response.request();
          const url = new URL(request.url());
          return request.method() === 'GET' && url.origin === server.origin && url.pathname === '/api/support-states' && !url.searchParams.has('cursor');
        });
        await candidate.goto(`${server.origin}/inbox/all/fixture-ticket`);
        assert.ok((await firstSupportStatePage).headers()['x-next-cursor'], 'The browser fixture must forward the first support-state continuation cursor');
        await candidate.getByRole('combobox', { name: 'Support state', exact: true }).waitFor();
        await candidate.getByRole('button', { name: 'Load more support states', exact: true }).click();
        await candidate.getByRole('option', { name: 'Waiting on customer (pending)', exact: true }).waitFor({ state: 'attached' });
        await candidate.getByRole('combobox', { name: 'Support state', exact: true }).selectOption('waiting-on-customer');
      }
      assert.equal(await writer.getByLabel('Waiting reason').getAttribute('aria-required'), 'true', 'The real dashboard must expose waiting reason as required for this state');
      assert.equal(await writer.getByLabel('Next action').getAttribute('aria-required'), 'true', 'The real dashboard must expose next action as required for this state');
      await writer.getByLabel('Waiting reason').fill('Writer is awaiting account information');
      await writer.getByLabel('Next action').fill('Writer follows up tomorrow');
      await writer.getByRole('button', { name: 'Save support state', exact: true }).click();
      await writer.getByText('Support state saved.', { exact: true }).waitFor();

      await page.getByLabel('Waiting reason').fill('Local operator input must survive conflict');
      await page.getByLabel('Next action').fill('Local operator will retry after refresh');
      await page.getByRole('button', { name: 'Save support state', exact: true }).click();
      await page.getByText(/This support state changed elsewhere/).waitFor();
      assert.equal(await page.getByLabel('Waiting reason').inputValue(), 'Local operator input must survive conflict');
      await page.getByRole('button', { name: 'Refresh current support state', exact: true }).click();
      await page.getByText('Current support state refreshed. Your local input is retained; review it before saving.', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Waiting reason').inputValue(), 'Local operator input must survive conflict');
      await page.getByRole('button', { name: 'Save support state', exact: true }).click();
      await page.getByText('Support state saved.', { exact: true }).waitFor();
      assert.equal(patches.length, 2, 'The first browser writer is allowed one conflict then one retry');
      const first = patches[0] as { expectedRevision?: unknown; waitingReason?: unknown };
      const retry = patches[1] as { expectedRevision?: unknown; waitingReason?: unknown };
      assert.equal(first.expectedRevision, 1, 'The stale browser write must use the original revision');
      assert.equal(retry.expectedRevision, 2, 'The browser retry must use the revision fetched after the other writer committed');
      assert.equal(retry.waitingReason, 'Local operator input must survive conflict');

      const sessionB = await operatorSession(fixture, 'operatorB');
      const publicState = await fixture.request('/api/v1/customer/tickets/fixture-ticket/support-state', { token: sessionA.token });
      // The staff token is intentionally not accepted by the customer projection route.
      assert.equal(publicState.status, 401);
      const customerToken = await customerWidgetToken(fixture, 'customerA');
      const customerState = await fixture.request('/api/v1/customer/tickets/fixture-ticket/support-state', { token: customerToken });
      assert.equal(customerState.status, 200);
      const publicProjection = await customerState.json<Record<string, unknown>>();
      assert.equal(publicProjection.label, 'We are waiting for your reply');
      assert.equal('waiting_reason' in publicProjection, false); assert.equal('next_action' in publicProjection, false); assert.equal('internal_label' in publicProjection, false);
      const tenantBStates = await fixture.request('/api/support-states', { token: sessionB.token });
      assert.equal(tenantBStates.status, 200);
      assert.equal((await tenantBStates.json<Array<{ id?: unknown }>>()).some(state => state.id === 'waiting-on-customer'), false, 'Tenant B must not observe Tenant A definitions');
      const tenantBState = await fixture.request('/api/tickets/fixture-ticket/support-state', { token: sessionB.token });
      assert.equal(tenantBState.status, 200);
      assert.notEqual((await tenantBState.json<{ waiting_reason?: unknown }>()).waiting_reason, 'Local operator input must survive conflict', 'Tenant B colliding ticket state remains unchanged');
      assert.equal(externalRequests.length, 0, 'The production dashboard browser must make no external request');
      const counters = await betaCounters(fixture); assert.ok(counters && counters.mutations <= 4, 'Guarded transition writes remain inside the bounded local budget');

      process.stdout.write(`${JSON.stringify({
        version: 1, kind: 'tocyn-local-support-state-browser', revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().length > 0,
        scope: { dashboard: 'production-dist', worker: 'disposable-miniflare', tenants: 2, remoteBindings: 0, externalNetworkRequests: 0, localBeta: { enabledOnlyForTransitions: true, mutationLimit: 4, actualSuccessfulMutations: counters?.mutations ?? null } },
        artifact: {
          dashboardDistSha256: await digestDirectory(resolve(repositoryRoot, 'apps/dashboard/dist')),
          dashboardSourceSha256: await digestDirectory(resolve(repositoryRoot, 'apps/dashboard/src')),
        },
        checks: { adminCreatesAndEditsSeparateLabels: true, requiredWaitingFacts: true, realSecondWriterCasConflict: true, refreshRetainsLocalInput: true, retryUsesFreshRevision: true, customerSafeProjection: true, tenantBUnchanged: true },
        limitations: ['Disposable Miniflare D1/R2 bindings and loopback static server only; this is not deployed Worker or provider evidence.', 'Configuration runs before guarded local-beta activation. This test does not claim the local-beta positive inventory permits configuration writes.', 'Synthetic identities and fixture data only; no external network request, remote binding, customer data, or provider activation.'],
      })}\n`);
      await contextA.close(); await contextWriter.close();
    } finally { await browser.close(); await server.close(); }
  });
});
