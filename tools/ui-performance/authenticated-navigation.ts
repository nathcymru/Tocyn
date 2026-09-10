import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, normalize, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type Route } from 'playwright';
import type { LocalTenantFixture } from '../../apps/server/scripts/local-tenant-fixture';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const maximumBodyBytes = 1024 * 1024;

type Client = 'dashboard' | 'portal';
type Timing = Readonly<{ listToDetailMs: number }>;
type Sample = Readonly<{ client: Client; sample: number; timing: Timing }>;
type RecoverySample = Readonly<{ client: Client; timing: Readonly<{ failedDetailRetryMs: number }> }>;
type Sessions = Readonly<{ dashboard: Readonly<{ token: string; user: unknown }>; portal: Readonly<{ token: string }> }>;

export type AuthenticatedNavigationReceipt = Readonly<{
  version: 1;
  kind: 'tocyn-local-authenticated-ticket-navigation';
  revision: string;
  dirty: boolean;
  environment: Readonly<{ node: string; platform: string; browser: string; playwright: string; headless: true; viewport: Readonly<{ width: 1280; height: 800 }>; reducedMotion: 'reduce'; remoteBindings: 0; synthetic: true }>;
  tenantIsolation: Readonly<{ dashboardForeignTicketDenied: true; portalForeignTicketDenied: true }>;
  configuration: Readonly<{ samplesPerClient: number; maximumSamples: 20; warmupsPerClient: 0 }>;
  artifacts: Readonly<Record<Client, string>>;
  sourceHashes: Readonly<Record<string, string>>;
  measurements: readonly Sample[];
  recovery: readonly RecoverySample[];
  limitations: readonly string[];
}>;

function boundedSamples(samples: number): number {
  if (!Number.isInteger(samples) || samples < 1 || samples > 20) throw new Error('Samples must be an integer from 1 to 20');
  return samples;
}

function revision(): { revision: string; dirty: boolean } {
  const run = (args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  return { revision: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']).length > 0 };
}

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

async function sourceHashes(): Promise<Record<string, string>> {
  const paths = ['tools/ui-performance/authenticated-navigation.ts', 'apps/server/scripts/ui-authenticated-navigation.test.ts', 'apps/dashboard/src/pages/TicketListPage.tsx', 'apps/dashboard/src/pages/TicketDetailPage.tsx', 'apps/portal/src/pages/TicketListPage.tsx', 'apps/portal/src/pages/TicketDetailPage.tsx'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(join(repositoryRoot, path))).digest('hex')])));
}

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBodyBytes) throw new Error('Request body exceeds local harness limit');
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function requestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string' && ['authorization', 'content-type', 'x-widget-key'].includes(name.toLowerCase())) headers[name] = value;
  }
  return headers;
}

async function staticResponse(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const candidate = pathname === '/' || pathname === '/tickets' || pathname.startsWith('/tickets/') ? 'index.html' : pathname.slice(1);
  const path = resolve(root, normalize(candidate));
  if (!path.startsWith(root + sep) && path !== root) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    const extension = path.slice(path.lastIndexOf('.'));
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}

async function startServer(fixture: LocalTenantFixture, client: Client): Promise<{ origin: string; failTicketDetailReads: (count: number) => void; close: () => Promise<void> }> {
  const root = resolve(repositoryRoot, 'apps', client, 'dist');
  let failedDetailReadsRemaining = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return await staticResponse(root, url.pathname, response);
      if (failedDetailReadsRemaining > 0 && request.method === 'GET' && /\/tickets\/fixture-ticket$/.test(url.pathname)) {
        failedDetailReadsRemaining--;
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Synthetic local detail read failure"}');
        return;
      }
      const body = await requestBody(request);
      const fixtureResponse = await fixture.request(`${url.pathname}${url.search}`, {
        method: request.method,
        rawBody: body,
        contentType: request.headers['content-type'] ?? null,
        headers: requestHeaders(request),
      });
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      const contentType = fixtureResponse.headers.get('content-type');
      if (contentType) headers['Content-Type'] = contentType;
      response.writeHead(fixtureResponse.status, headers).end(Buffer.from(await fixtureResponse.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"Local fixture forwarding failed"}'); }
  });
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, failTicketDetailReads: (count: number) => {
    assert.ok(Number.isInteger(count) && count >= 1 && count <= 4, 'Synthetic detail fault count must stay bounded');
    failedDetailReadsRemaining = count;
  }, close: () => new Promise(resolvePromise => server.close(() => resolvePromise())) };
}

async function operatorToken(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB' = 'operatorA'): Promise<{ token: string; user: unknown }> {
  const login = await fixture.login(operator);
  assert.equal(login.status, 200, 'Fixture operator login must succeed');
  const challenge = await login.json<{ mfa_required?: boolean; token?: string }>();
  assert.equal(challenge.mfa_required, true, 'Fixture operator login must require MFA');
  assert.equal(typeof challenge.token, 'string', 'Fixture operator challenge must contain a token');
  const response = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) } });
  assert.equal(response.status, 200, 'Fixture operator MFA verification must succeed');
  const completed = await response.json<{ token?: string; user?: unknown }>();
  assert.equal(typeof completed.token, 'string', 'Fixture MFA completion must create a session');
  assert.equal(await fixture.tokenTenant(completed.token!), fixture.principals[operator].tenantId);
  return { token: completed.token!, user: completed.user };
}

async function customerToken(fixture: LocalTenantFixture, customer: 'customerA' | 'customerB' = 'customerA'): Promise<string> {
  const principal = fixture.principals[customer];
  const requested = await fixture.request('/api/v1/customer/auth/request', { method: 'POST', body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey } });
  assert.equal(requested.status, 200, 'Fixture customer auth request must succeed');
  const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to?: string; loginLink?: string }>>();
  const link = [...messages].reverse().find(message => message.to === principal.email)?.loginLink;
  assert.ok(link, 'Fixture customer auth capture must contain its generated local link');
  const challenge = new URL(link).searchParams.get('token');
  assert.ok(challenge, 'Fixture customer link must contain a challenge token');
  const response = await fixture.request('/api/v1/customer/auth/verify', { method: 'POST', body: { token: challenge, widgetKey: principal.widgetKey } });
  assert.equal(response.status, 200, 'Fixture customer verification must succeed');
  const completed = await response.json<{ token?: string }>();
  assert.equal(typeof completed.token, 'string', 'Fixture customer verification must create a session');
  assert.equal(await fixture.widgetTokenTenant(completed.token!), principal.tenantId);
  return completed.token!;
}

async function measure(client: Client, origin: string, browser: Browser, fixture: LocalTenantFixture, sessions: Sessions, sample: number, injectDetailFault?: () => void): Promise<number> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  let pageRoute = '';
  const apiResponses: Array<{ path: string; status: number }> = [];
  const pageErrorNames: string[] = [];
  try {
    let external = 0;
    await context.route('**/*', (route: Route) => {
      if (new URL(route.request().url()).origin !== origin) { external++; return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        apiResponses.push({ path: url.pathname, status: response.status() });
        if (apiResponses.length > 12) apiResponses.shift();
      }
    });
    page.on('pageerror', error => {
      pageErrorNames.push(error.name);
      if (pageErrorNames.length > 4) pageErrorNames.shift();
    });
    page.setDefaultTimeout(10_000);
    await page.addInitScript(`document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('a[href="/tickets/fixture-ticket"], button') : null;
      if (!target) return;
      if (target.matches('a[href="/tickets/fixture-ticket"]')) window.__tocynTicketNavigationStart = performance.now();
      if (/^Retry loading (ticket|conversation)$/.test(target.textContent.trim())) window.__tocynTicketRetryStart = performance.now();
    }, true);`);
    if (client === 'dashboard') {
      const session = sessions.dashboard;
      await page.addInitScript(({ token, user }: { token: string; user: unknown }) => localStorage.setItem('lumina-auth', JSON.stringify({ state: { token, user, mfaRequired: false }, version: 0 })), session);
    } else {
      const token = sessions.portal.token;
      const key = fixture.principals.customerA.widgetKey;
      await page.addInitScript(({ token: suppliedToken, widgetKey }: { token: string; widgetKey: string }) => {
        localStorage.setItem('lumina_customer_token', suppliedToken); sessionStorage.setItem('tocyn_widget_key', widgetKey);
      }, { token, widgetKey: key });
    }
    await page.goto(`${origin}/tickets${client === 'portal' ? `?key=${fixture.principals.customerA.widgetKey}` : ''}`);
    const subject = 'Fixture ticket A';
    const link = page.getByRole('link', { name: new RegExp(subject) }).first();
    await link.waitFor({ state: 'visible' });
    injectDetailFault?.();
    await link.click();
    await page.waitForURL(/\/tickets\/fixture-ticket/);
    pageRoute = new URL(page.url()).pathname;
    if (injectDetailFault) {
      const retryName = client === 'dashboard' ? 'Retry loading ticket' : 'Retry loading conversation';
      await page.getByRole('alert').waitFor({ state: 'visible' });
      const retry = page.getByRole('button', { name: retryName, exact: true });
      await retry.waitFor({ state: 'visible' });
      await retry.click();
    }
    // The portal heading also includes its visible status; requiring a heading prevents a stale list link from satisfying recovery.
    const detailHeading = page.getByRole('heading', { name: subject });
    await detailHeading.waitFor({ state: 'visible' });
    if (injectDetailFault && client === 'portal') {
      assert.equal(await detailHeading.evaluate(heading => (heading as unknown as { ownerDocument: { activeElement: unknown } }).ownerDocument.activeElement === heading), true, 'Portal retry must focus its recovered conversation heading');
    }
    const observed = await page.evaluate(`(async () => {
      const started = window.${injectDetailFault ? '__tocynTicketRetryStart' : '__tocynTicketNavigationStart'};
      if (!Number.isFinite(started)) throw new Error('Browser click timestamp was not recorded');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return performance.now() - started;
    })()`);
    if (typeof observed !== 'number' || !Number.isFinite(observed) || observed < 0) throw new Error('Browser navigation timing was invalid');
    const elapsed = observed;
    assert.equal(external, 0, 'Authenticated navigation must not request external origins');
    return elapsed;
  } catch (error) {
    // Keep CI diagnostics bounded and token-free: only local path/status and error class.
    const diagnostic = JSON.stringify({ client, sample, route: pageRoute, apiResponses, pageErrorNames });
    throw new Error(`Authenticated navigation did not reach its detail readiness target: ${diagnostic}`, { cause: error });
  } finally { await context.close(); }
}

/** Real fixture authentication plus built-client ticket navigation; no mocks or remote resources. */
export async function runAuthenticatedNavigation(fixture: LocalTenantFixture, samples = 20): Promise<AuthenticatedNavigationReceipt> {
  boundedSamples(samples);
  const browser = await chromium.launch({ headless: true });
  let dashboardServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let portalServer: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    dashboardServer = await startServer(fixture, 'dashboard');
    portalServer = await startServer(fixture, 'portal');
    const dashboard = dashboardServer;
    const portal = portalServer;
    const sessions: Sessions = Object.freeze({ dashboard: await operatorToken(fixture), portal: Object.freeze({ token: await customerToken(fixture) }) });
    const dashboardForeign = await fixture.request('/api/tickets/fixture-b-only', { token: sessions.dashboard.token });
    const portalForeign = await fixture.request('/api/v1/customer/tickets/fixture-b-only', { token: sessions.portal.token, headers: { 'X-Widget-Key': fixture.principals.customerA.widgetKey } });
    assert.equal(dashboardForeign.status, 404, 'Tenant A dashboard session must not read tenant B-only ticket');
    assert.equal(portalForeign.status, 404, 'Tenant A customer session must not read tenant B-only ticket');
    const dashboardOwner = await fixture.request('/api/tickets/fixture-b-only', { token: (await operatorToken(fixture, 'operatorB')).token });
    const portalOwner = await fixture.request('/api/v1/customer/tickets/fixture-b-only', { token: await customerToken(fixture, 'customerB'), headers: { 'X-Widget-Key': fixture.principals.customerB.widgetKey } });
    assert.equal(dashboardOwner.status, 200, 'Tenant B dashboard session must read its own ticket');
    assert.equal(portalOwner.status, 200, 'Tenant B customer session must read its own ticket');
    assert.equal((await fixture.request('/api/auth/me', { token: sessions.dashboard.token })).status, 200, 'Fixture dashboard session must resolve its identity');
    assert.equal((await fixture.request('/api/v1/customer/auth/me', { token: sessions.portal.token, headers: { 'X-Widget-Key': fixture.principals.customerA.widgetKey } })).status, 200, 'Fixture customer session must resolve its identity');
    const measurements: Sample[] = [];
    for (let sample = 0; sample < samples; sample++) {
      measurements.push(Object.freeze({ client: 'dashboard', sample, timing: Object.freeze({ listToDetailMs: await measure('dashboard', dashboard.origin, browser, fixture, sessions, sample) }) }));
      measurements.push(Object.freeze({ client: 'portal', sample, timing: Object.freeze({ listToDetailMs: await measure('portal', portal.origin, browser, fixture, sessions, sample) }) }));
    }
    const recovery: RecoverySample[] = [];
    recovery.push(Object.freeze({ client: 'dashboard', timing: Object.freeze({ failedDetailRetryMs: await measure('dashboard', dashboard.origin, browser, fixture, sessions, samples, () => dashboard.failTicketDetailReads(2)) }) }));
    recovery.push(Object.freeze({ client: 'portal', timing: Object.freeze({ failedDetailRetryMs: await measure('portal', portal.origin, browser, fixture, sessions, samples, () => portal.failTicketDetailReads(1)) }) }));
    const source = revision();
    return Object.freeze({
      version: 1, kind: 'tocyn-local-authenticated-ticket-navigation', revision: source.revision, dirty: source.dirty,
      environment: Object.freeze({ node: process.version, platform: process.platform, browser: browser.version(), playwright: require('playwright/package.json').version, headless: true, viewport: Object.freeze({ width: 1280, height: 800 }), reducedMotion: 'reduce', remoteBindings: 0, synthetic: true }),
      tenantIsolation: Object.freeze({ dashboardForeignTicketDenied: true, portalForeignTicketDenied: true }),
      configuration: Object.freeze({ samplesPerClient: samples, maximumSamples: 20, warmupsPerClient: 0 }),
      artifacts: Object.freeze({ dashboard: await digestDirectory(resolve(repositoryRoot, 'apps/dashboard/dist')), portal: await digestDirectory(resolve(repositoryRoot, 'apps/portal/dist')) }),
      sourceHashes: Object.freeze(await sourceHashes()),
      measurements: Object.freeze(measurements),
      recovery: Object.freeze(recovery),
      limitations: Object.freeze(['Local disposable Miniflare fixture and loopback static servers only; not deployed-worker or provider timing.', 'Fixture-issued sessions prove only this synthetic tenant/auth flow; no production authentication or customer data.', 'Synthetic 503 detail faults are injected only by this loopback forwarding boundary; initial authentication and recovered reads use the real fixture.', 'No numeric threshold is evaluated.']),
    });
  } finally { await portalServer?.close(); await dashboardServer?.close(); await browser.close(); }
}
