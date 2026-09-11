import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, normalize, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { chromium, type Route } from 'playwright';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { betaCounters, initializeLocalBetaFixture } from './local-beta-fixture';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
const maximumBodyBytes = 1024 * 1024;

type Operator = 'operatorA' | 'operatorB';
type Server = Readonly<{
  origin: string;
  failDraftPuts: (count: number) => void;
  close: () => Promise<void>;
}>;

async function digestDirectory(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else { hash.update(child.slice(directory.length)); hash.update(await readFile(child)); }
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

async function requestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBodyBytes) throw new Error('Browser harness request exceeded its local limit');
    chunks.push(bytes);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function requestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string' && ['authorization', 'content-type'].includes(name.toLowerCase())) headers[name] = value;
  }
  return headers;
}

async function staticResponse(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const candidate = pathname === '/' || pathname === '/tickets' || pathname.startsWith('/tickets/') || pathname === '/login' || pathname === '/mfa'
    ? 'index.html' : pathname.slice(1);
  const path = resolve(root, normalize(candidate));
  if (!path.startsWith(root + sep) && path !== root) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    const extension = path.slice(path.lastIndexOf('.'));
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
}

async function startServer(fixture: LocalTenantFixture): Promise<Server> {
  const root = resolve(repositoryRoot, 'apps/dashboard/dist');
  let failedDraftPuts = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return await staticResponse(root, url.pathname, response);
      if (failedDraftPuts > 0 && request.method === 'PUT' && url.pathname === '/api/workspace/drafts/fixture-ticket') {
        failedDraftPuts--;
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Synthetic local draft save failure"}');
        return;
      }
      const fixtureResponse = await fixture.request(`${url.pathname}${url.search}`, {
        method: request.method,
        rawBody: await requestBody(request),
        contentType: request.headers['content-type'] ?? null,
        headers: requestHeaders(request),
      });
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      const contentType = fixtureResponse.headers.get('content-type');
      if (contentType) headers['Content-Type'] = contentType;
      response.writeHead(fixtureResponse.status, headers).end(Buffer.from(await fixtureResponse.arrayBuffer()));
    } catch { response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"Local fixture forwarding failed"}'); }
  });
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  return Object.freeze({
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    failDraftPuts: (count: number) => {
      assert.ok(Number.isInteger(count) && count >= 1 && count <= 4, 'Draft fault injection must remain bounded');
      failedDraftPuts = count;
    },
    close: () => new Promise<void>(resolvePromise => server.close(() => resolvePromise())),
  });
}

async function operatorSession(fixture: LocalTenantFixture, operator: Operator): Promise<Readonly<{ token: string; user: unknown }>> {
  const login = await fixture.login(operator);
  assert.equal(login.status, 200, 'Synthetic operator login must succeed');
  const challenge = await login.json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true, 'Synthetic operator login must require MFA');
  assert.equal(typeof challenge.token, 'string', 'Synthetic MFA challenge must contain a token');
  const complete = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) } });
  assert.equal(complete.status, 200, 'Synthetic MFA verification must succeed');
  const result = await complete.json<{ token?: string; user?: unknown }>();
  assert.equal(typeof result.token, 'string', 'Synthetic MFA verification must return a token');
  assert.ok(result.user && typeof result.user === 'object', 'Synthetic MFA verification must return a browser user');
  assert.equal((result.user as { tenant_id?: unknown }).tenant_id, fixture.principals[operator].tenantId,
    'The real MFA session user must carry the verified tenant scope required by the dashboard draft controller');
  return Object.freeze({ token: result.token!, user: result.user });
}

async function initializeBrowserLocalBeta(fixture: LocalTenantFixture): Promise<void> {
  await initializeLocalBetaFixture(fixture, {
    runId: 'operator-draft-browser',
    tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
    // The profile requires explicit invitations before its authenticated routes can be exercised.
    invitations: Object.values(fixture.principals).map(principal => ({
      tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
    })),
    // Eight expected positive writes cover selected ticket/panel/list preferences and
    // attachment/body/recovery draft saves. Sixteen remains a bounded local guard while
    // allowing serialized controller recovery writes to complete through the Worker.
    limits: { ticketLimit: 1, mutationLimit: 16, recoveryReserve: 2, uploadLimit: 1 },
  });
}

test('proves production dashboard draft restore, guarded navigation, and tenant scope against the disposable local Worker', async () => {
  await withTwoTenantFixture(async fixture => {
    await initializeBrowserLocalBeta(fixture);
    const server = await startServer(fixture);
    const browser = await chromium.launch({ headless: true });
    try {
      const sessionA = await operatorSession(fixture, 'operatorA');
      const created = await fixture.request('/api/tickets', {
        method: 'POST', token: sessionA.token,
        body: { subject: 'Synthetic browser navigation ticket', customer_email: fixture.principals.customerA.email, body: 'Synthetic navigation seed' },
      });
      assert.equal(created.status, 201, 'The local Worker must create the navigation fixture ticket');
      const createdTicket = await created.json<{ id?: string }>();
      assert.equal(typeof createdTicket.id, 'string', 'The local Worker must return the navigation fixture identifier');

      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const externalRequests: string[] = [];
      const workspaceResponses: Array<{ method: string; status: number; injected: boolean }> = [];
      const workspaceStateResponses: Array<{ method: string; status: number }> = [];
      const ticketSortRequests: string[] = [];
      const attachmentUploadStatuses: number[] = [];
      await context.route('**/*', (route: Route) => {
        if (new URL(route.request().url()).origin !== server.origin) { externalRequests.push(route.request().resourceType()); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === server.origin && url.pathname === '/api/workspace/drafts/fixture-ticket') {
          workspaceResponses.push({ method: response.request().method(), status: response.status(), injected: response.status() === 503 });
        }
        if (url.origin === server.origin && url.pathname === '/api/workspace/state') {
          workspaceStateResponses.push({ method: response.request().method(), status: response.status() });
        }
        if (url.origin === server.origin && url.pathname === '/api/tickets') {
          ticketSortRequests.push(url.searchParams.get('sort') ?? '');
        }
        if (url.origin === server.origin && url.pathname === '/api/attachments/upload') attachmentUploadStatuses.push(response.status());
      });

      // The dashboard bundle cannot receive a fixture password from the public fixture API.
      // Seed an authenticated browser storage entry only after real local MFA has issued it.
      await page.addInitScript(({ token, user }) => {
        localStorage.setItem('lumina-auth', JSON.stringify({ state: { token, user, mfaRequired: false }, version: 0 }));
      }, sessionA);

      await page.goto(`${server.origin}/tickets/fixture-ticket`);
      const body = page.getByLabel('Reply message', { exact: true });
      await body.waitFor();
      await page.locator('#reply-message:not([readonly])').waitFor();
      await page.getByText('Workspace preference saved.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Internal Note', exact: true }).click();
      const savedPutsBeforeAttachment = workspaceResponses.filter(response => response.method === 'PUT' && response.status === 200).length;
      const uploadResponse = page.waitForResponse(response => new URL(response.url()).origin === server.origin &&
        new URL(response.url()).pathname === '/api/attachments/upload' && response.request().method() === 'POST');
      await page.getByLabel('Reply attachments', { exact: true }).setInputFiles({
        name: 'synthetic-draft-attachment.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic attachment'),
      });
      assert.equal((await uploadResponse).status(), 200, 'The real local attachment upload must succeed before draft restoration is checked');
      await page.getByText('synthetic-draft-attachment.txt', { exact: true }).waitFor();
      await page.getByText('Draft saved.', { exact: true }).waitFor();
      assert.ok(workspaceResponses.filter(response => response.method === 'PUT' && response.status === 200).length > savedPutsBeforeAttachment,
        'A real attachment upload must be followed by a real acknowledged draft save');
      await body.fill('Synthetic retained internal draft');
      await page.getByText('Draft saved.', { exact: true }).waitFor();

      await page.reload();
      await body.waitFor();
      await page.getByText('Draft saved.', { exact: true }).waitFor();
      assert.equal(await body.inputValue(), 'Synthetic retained internal draft', 'Reload must restore the stored draft body');
      await assert.doesNotReject(page.getByRole('button', { name: 'Internal Note', exact: true }).waitFor({ state: 'visible' }));
      assert.equal(await page.getByRole('button', { name: 'Internal Note', exact: true }).getAttribute('aria-pressed'), 'true', 'Reload must restore internal mode');
      await page.getByText('synthetic-draft-attachment.txt', { exact: true }).waitFor();

      const openContextSave = page.waitForResponse(response => new URL(response.url()).origin === server.origin &&
        new URL(response.url()).pathname === '/api/workspace/state' && response.request().method() === 'PUT' && response.status() === 200);
      await page.getByRole('button', { name: 'Show ticket context', exact: true }).click();
      await openContextSave;
      await page.getByRole('heading', { name: 'Ticket Details', exact: true }).waitFor();
      assert.equal(await page.locator('#ticket-context-panel').isVisible(), true, 'Opening ticket context must show its persisted details panel');

      await page.reload();
      await body.waitFor();
      await page.getByRole('button', { name: 'Hide ticket context', exact: true }).waitFor();
      assert.equal(await page.locator('#ticket-context-panel').isVisible(), true, 'Reload must restore the details panel preference');
      const restoredInitialState = await fixture.request('/api/workspace/state', { token: sessionA.token });
      assert.equal(restoredInitialState.status, 200, 'The real Worker must return the persisted workspace preference');
      const initialState = await restoredInitialState.json<{ selectedTicketId?: unknown; panel?: unknown }>();
      assert.equal(initialState.selectedTicketId, 'fixture-ticket', 'Reloaded current ticket must remain the server-backed selection');
      assert.equal(initialState.panel, 'details', 'Reloaded context panel must remain the server-backed details preference');

      await page.getByRole('link', { name: 'Back to Tickets', exact: true }).click();
      const sort = page.getByRole('combobox', { name: 'Sort tickets', exact: true });
      await sort.waitFor();
      const sortSave = page.waitForResponse(response => {
        if (new URL(response.url()).origin !== server.origin || new URL(response.url()).pathname !== '/api/workspace/state' || response.request().method() !== 'PUT' || response.status() !== 200) return false;
        try { return (response.request().postDataJSON() as { sort?: unknown }).sort === 'priority_asc'; } catch { return false; }
      });
      const sortedTicketRequest = page.waitForResponse(response => new URL(response.url()).origin === server.origin &&
        new URL(response.url()).pathname === '/api/tickets' && new URL(response.url()).searchParams.get('sort') === 'priority_asc');
      await sort.selectOption('priority_asc');
      await Promise.all([sortSave, sortedTicketRequest]);
      const savedSortState = await fixture.request('/api/workspace/state', { token: sessionA.token });
      assert.equal(savedSortState.status, 200, 'The real Worker must return the acknowledged list sort preference');
      assert.equal((await savedSortState.json<{ sort?: unknown }>()).sort, 'priority_asc',
        'An acknowledged list sort save must persist through the real Worker before browser reload');
      const restoredSortRequest = page.waitForResponse(response => new URL(response.url()).origin === server.origin &&
        new URL(response.url()).pathname === '/api/tickets' && new URL(response.url()).searchParams.get('sort') === 'priority_asc');
      await page.reload();
      await sort.waitFor();
      await restoredSortRequest;
      await page.waitForFunction(() => (globalThis as any).document.querySelector('select[aria-label="Sort tickets"]')?.value === 'priority_asc');
      assert.equal(await sort.inputValue(), 'priority_asc', 'Reload must restore the selected list sort');

      const selectCreatedSave = page.waitForResponse(response => new URL(response.url()).origin === server.origin &&
        new URL(response.url()).pathname === '/api/workspace/state' && response.request().method() === 'PUT' && response.status() === 200);
      await page.getByRole('link', { name: 'Synthetic browser navigation ticket', exact: true }).click();
      await page.waitForURL(new RegExp(`/tickets/${createdTicket.id}$`));
      await selectCreatedSave;
      const selectedCreatedState = await fixture.request('/api/workspace/state', { token: sessionA.token });
      assert.equal(selectedCreatedState.status, 200, 'The real Worker must expose the selected-ticket preference to its scoped operator');
      assert.equal((await selectedCreatedState.json<{ selectedTicketId?: unknown }>()).selectedTicketId, createdTicket.id,
        'Opening a successfully loaded ticket must persist that ticket as the server-backed selection');
      await page.getByRole('link', { name: 'Back to Tickets', exact: true }).click();
      const selectFixtureSave = page.waitForResponse(response => new URL(response.url()).origin === server.origin &&
        new URL(response.url()).pathname === '/api/workspace/state' && response.request().method() === 'PUT' && response.status() === 200);
      await page.getByRole('link', { name: 'Fixture ticket A', exact: true }).click();
      await body.waitFor();
      await selectFixtureSave;
      await page.getByText('Draft saved.', { exact: true }).waitFor();
      assert.equal(await body.inputValue(), 'Synthetic retained internal draft', 'Ticket navigation must restore the original draft body');
      assert.equal(await page.getByRole('button', { name: 'Internal Note', exact: true }).getAttribute('aria-pressed'), 'true', 'Ticket navigation must restore internal mode');

      server.failDraftPuts(2);
      await body.fill('Synthetic retained failed draft');
      await page.getByText('Draft was not saved. Retry to keep this version.', { exact: true }).waitFor();
      await page.getByRole('link', { name: 'Back to Tickets', exact: true }).click();
      await page.getByText('Your draft or workspace preferences are not saved. Stay on this ticket, retry or restore preferences, then navigate again.', { exact: true }).waitFor();
      assert.match(page.url(), /\/tickets\/fixture-ticket$/, 'Failed autosave must retain ticket navigation');
      assert.equal(await body.inputValue(), 'Synthetic retained failed draft', 'Failed autosave must retain editable text');
      await page.getByRole('button', { name: 'Retry draft', exact: true }).click();
      await page.getByText('Draft saved.', { exact: true }).waitFor();

      const sessionB = await operatorSession(fixture, 'operatorB');
      const foreignDraft = await fixture.request('/api/workspace/drafts/fixture-ticket', { token: sessionB.token });
      assert.equal(foreignDraft.status, 204, 'Tenant B must not observe tenant A\'s draft through the real Worker');

      assert.equal(externalRequests.length, 0, 'The browser must not reach a non-loopback origin');
      assert.ok(workspaceResponses.some(response => response.method === 'GET' && response.status === 200), 'The browser must restore through the real Worker route');
      assert.ok(workspaceResponses.some(response => response.method === 'PUT' && response.status === 200), 'The browser must persist through the real Worker route');
      assert.ok(workspaceStateResponses.some(response => response.method === 'PUT' && response.status === 200), 'The browser must persist selected-ticket, panel, and sort preferences through the real Worker route');
      assert.ok(ticketSortRequests.filter(sort => sort === 'priority_asc').length >= 2, 'Restored list sorting must be requested from the server before and after reload');
      assert.equal(workspaceResponses.filter(response => response.injected).length, 2, 'Only the documented bounded local failure injection may produce 503 responses');

      const counters = await betaCounters(fixture);
      assert.ok(counters && counters.mutations <= 16, 'The guarded local-beta mutation budget must remain enforced');

      const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().length > 0;
      process.stdout.write(`${JSON.stringify({
        version: 1,
        kind: 'tocyn-local-operator-draft-browser',
        revision,
        dirty,
        scope: { worker: 'disposable-miniflare', tenants: 2, localBeta: { invitedPrincipals: 4, ticketLimit: 1, mutationLimit: 16, recoveryReserve: 2, uploadLimit: 1, actualSuccessfulMutations: counters?.mutations ?? null }, dashboard: 'production-dist', remoteBindings: 0, externalNetworkRequests: 0 },
        artifact: { dashboardDistSha256: await digestDirectory(resolve(repositoryRoot, 'apps/dashboard/dist')) },
        checks: { reloadRestoresTextModeAndAttachment: true, ticketNavigationRestoresDraft: true, reloadRestoresSelectedTicketAndContextPanel: true, restoredListSortDrivesServerPagination: true, failedAutosaveShowsFeedbackAndRetainsNavigation: true, wrongTenantHasNoDraft: true },
        syntheticFault: { boundary: 'ephemeral loopback forwarding server', route: 'PUT /api/workspace/drafts/fixture-ticket', responses: 2, persistedWorkerRequests: true, capacityDenials: 0 },
        attachment: { uploadRoute: 'POST /api/attachments/upload', uploadStatuses: attachmentUploadStatuses, filenameRestored: true },
        tenantBProof: 'Operator B authenticates against the real local Worker and receives 204 from its scoped draft GET. This check does not render a second Tenant B dashboard browser session.',
        workspaceRouteStatuses: workspaceResponses,
        workspaceStateRouteStatuses: workspaceStateResponses,
        ticketSortRequests,
        limitations: ['Node application harness with disposable Miniflare D1/R2 bindings and an ephemeral loopback static server; this is not a Worker-hosted full-application runtime, deployed Worker, or provider evidence.', 'The two 503 responses are deliberately injected at the loopback forwarding boundary to prove browser recovery; all other observed draft requests use the real Worker route.', 'Synthetic tenant identities and fixture data only; no production credentials, customer data, remote bindings, or external network requests.'],
      })}\n`);
      await context.close();
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
