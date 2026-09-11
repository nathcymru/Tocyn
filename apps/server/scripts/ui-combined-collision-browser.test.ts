import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';
import test from 'node:test';
import { chromium, type Route } from 'playwright';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { type LocalTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const dashboardRoot = resolve(repositoryRoot, 'apps/dashboard/dist');
const csp = "default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'self'; frame-ancestors 'none'";

type Loopback = Readonly<{ origin: string; loseNextReplyResponse: () => void; replyKeys: () => readonly string[]; close: () => Promise<void> }>;

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (chunks.reduce((size, current) => size + current.length, 0) + bytes.length > 64 * 1024) throw new Error('Bounded browser fixture request exceeded 64 KiB');
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function forwardedHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string' && ['authorization', 'content-type', 'idempotency-key'].includes(name.toLowerCase())) headers[name] = value;
  }
  return headers;
}

async function staticResponse(pathname: string, response: ServerResponse): Promise<void> {
  const candidate = pathname === '/' || pathname === '/tickets' || pathname.startsWith('/tickets/') ? 'index.html' : pathname.slice(1);
  const path = resolve(dashboardRoot, normalize(candidate));
  if (!path.startsWith(dashboardRoot + sep) && path !== dashboardRoot) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    const extension = path.slice(path.lastIndexOf('.'));
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Content-Security-Policy': csp }).end(bytes);
  } catch { response.writeHead(404).end(); }
}

async function startLoopback(fixture: LocalTenantFixture): Promise<Loopback> {
  let loseReply = false;
  const replyKeys: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return await staticResponse(url.pathname, response);
      const body = await requestBody(request);
      const isReply = request.method === 'POST' && url.pathname === '/api/tickets/fixture-ticket/articles';
      if (isReply) replyKeys.push(typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : '');
      const result = await fixture.request(`${url.pathname}${url.search}`, {
        method: request.method, rawBody: body, contentType: request.headers['content-type'] ?? null, headers: forwardedHeaders(request),
      });
      if (isReply && loseReply && result.status === 201) {
        loseReply = false;
        await result.body?.cancel();
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Synthetic lost response"}');
        return;
      }
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      const contentType = result.headers.get('content-type'); if (contentType) headers['Content-Type'] = contentType;
      const replayed = result.headers.get('Idempotency-Replayed'); if (replayed) headers['Idempotency-Replayed'] = replayed;
      response.writeHead(result.status, headers).end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Local fixture forwarding failed"}'); }
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return Object.freeze({
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    loseNextReplyResponse: () => { loseReply = true; },
    replyKeys: () => Object.freeze([...replyKeys]),
    close: () => new Promise<void>(done => server.close(() => done())),
  });
}

async function operatorSession(fixture: LocalTenantFixture): Promise<Readonly<{ token: string; user: unknown }>> {
  const login = await fixture.login('operatorA'); assert.equal(login.status, 200);
  const challenge = await login.json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true); assert.equal(typeof challenge.token, 'string');
  const complete = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode('operatorA') } });
  assert.equal(complete.status, 200);
  const session = await complete.json<{ token?: string; user?: unknown }>();
  assert.equal(typeof session.token, 'string'); assert.ok(session.user && typeof session.user === 'object');
  return Object.freeze({ token: session.token!, user: session.user });
}

test('production dashboard browser proves guarded combined stale review, manual rebase, and lost-response replay without external requests', async () => {
  await withTwoTenantFixture(async fixture => {
    const session = await operatorSession(fixture);
    const colleague = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
    await initializeLocalBetaFixture(fixture, {
      runId: 'combined-collision-browser', tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
      invitations: [...Object.values(fixture.principals).map(principal => ({ tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const })),
        { tenantId: fixture.principals.operatorA.tenantId, id: colleague.id, kind: 'staff' }],
      limits: { ticketLimit: 2, mutationLimit: 12, recoveryReserve: 2, uploadLimit: 2 },
    });
    const off = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: session.token });
    assert.equal(off.status, 200); assert.equal((await off.json<{ collision?: unknown }>()).collision, undefined);
    await fixture.enableApiTicketAdmission();
    const apiOnly = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: session.token });
    assert.equal(apiOnly.status, 200); assert.equal((await apiOnly.json<{ collision?: unknown }>()).collision, undefined);
    await fixture.enableCombinedTicketAdmission();
    const combined = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: session.token });
    assert.equal(combined.status, 200); assert.deepEqual((await combined.json<{ collision?: { protocol?: string } }>()).collision?.protocol, 'draft-precondition-v1');

    const loopback = await startLoopback(fixture);
    const browser = await chromium.launch({ headless: true });
    const external: string[] = [];
    try {
      const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.route('**/*', (route: Route) => {
        if (new URL(route.request().url()).origin !== loopback.origin) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      await page.addInitScript(({ token, user }) => localStorage.setItem('lumina-auth', JSON.stringify({ state: { token, user, mfaRequired: false }, version: 0 })), session);
      const navigation = await page.goto(`${loopback.origin}/tickets/fixture-ticket`);
      assert.equal(navigation?.headers()['content-security-policy'], csp);
      const message = page.getByRole('textbox', { name: 'Reply message' });
      await message.waitFor();
      await message.fill('Browser retained stale draft');
      await page.getByText('Draft saved.', { exact: true }).waitFor();

      const colleagueReply = await fixture.request('/api/tickets/fixture-ticket/articles', {
        method: 'POST', token: colleague.token, idempotencyKey: 'browser-colleague-material',
        body: { body: 'Browser-visible newer material', body_format: 'markdown-v1', is_internal: false, attachments: [] },
      });
      assert.equal(colleagueReply.status, 201);
      await page.getByRole('button', { name: 'Send Reply', exact: true }).click();
      await page.getByText(/Review and rebase before sending/).waitFor();
      assert.equal(await message.inputValue(), 'Browser retained stale draft');
      await page.getByRole('button', { name: 'Refresh and review conversation', exact: true }).click();
      await page.getByText('Browser-visible newer material', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Rebase saved draft', exact: true }).click();
      await page.getByText(/Draft rebased to the reviewed conversation/).waitFor();
      assert.equal(await message.inputValue(), 'Browser retained stale draft');
      await page.getByRole('button', { name: 'Send Reply', exact: true }).click();
      await page.getByText('Public reply added to the conversation.', { exact: true }).waitFor();

      await message.fill('Browser lost response retry');
      await page.getByText('Draft saved.', { exact: true }).waitFor();
      loopback.loseNextReplyResponse();
      await page.getByRole('button', { name: 'Send Reply', exact: true }).click();
      await page.getByText(/Synthetic lost response.*draft is retained/i).waitFor();
      assert.equal(await message.inputValue(), 'Browser lost response retry');
      await page.getByRole('button', { name: 'Send Reply', exact: true }).click();
      await page.getByText('Public reply added to the conversation.', { exact: true }).waitFor();
      const keys = loopback.replyKeys();
      assert.equal(keys.length, 4, 'stale, reviewed, lost, and retry browser posts stay bounded');
      assert.equal(keys[2], keys[3], 'Lost-response retry reuses one stable acknowledged intent key');
      assert.match(keys[2], /^[0-9a-f-]{36}$/);
      assert.equal((await fixture.db.prepare(`SELECT count(*) AS count FROM articles WHERE tenant_id=? AND body=?`).bind(fixture.principals.operatorA.tenantId, 'Browser lost response retry').first<{ count: number }>())?.count, 1,
        'The lost response committed one article and the browser retry returned the receipt winner');
      assert.deepEqual(external, []);
      await context.close();
    } finally { await browser.close(); await loopback.close(); }
  });
});
