import assert from 'node:assert/strict';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as OTPAuth from 'otpauth';
import { decodeJwt } from 'jose';
import { createLocalFixtureBootstrap } from './local-tenant-fixture';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serverRoot, '../..');
const wrangler = join(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');
const betaOperator = join(serverRoot, 'scripts/run-local-beta-operator.ts');
const origin = 'http://localhost:8787';
const startClock = Date.UTC(2030, 0, 2, 3, 4, 5);

type Credentials = Readonly<{ email: string; password: string; provisioningUri?: string }>;
type CapturedMessage = Readonly<{ to: string; loginLink?: string }>;
type WorkflowReport = Readonly<{
  result: 'passed'; mode: 'disposable-local-wrangler'; tenants: 2; workerRestarts: number;
  routeRequests: number; d1Rows: number; capturedMessages: number; articleDelta: number; eventDelta: number;
}>;

type ConversationCounts = Readonly<{ articles: number; events: number }>;

function secret(): string { return randomBytes(32).toString('hex'); }

function localEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  for (const key of Object.keys(environment)) if (/^(CLOUDFLARE_|CF_API_|RESEND_)/.test(key)) delete environment[key];
  return environment;
}

function assertStatus(response: Response, expected: number, label: string): void {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, received ${response.status}`);
}

function opaqueToken(message: CapturedMessage): string {
  assert.ok(message.loginLink, 'captured magic link must be present');
  const token = new URL(message.loginLink).searchParams.get('token');
  assert.ok(token && /^[0-9a-f]{64}$/.test(token), 'captured magic link must contain an opaque challenge');
  return token;
}

function totp(uri: string): string {
  const parsed = OTPAuth.URI.parse(uri);
  assert.ok(parsed instanceof OTPAuth.TOTP, 'fixture operator provisioning URI must contain a TOTP secret');
  return parsed.generate();
}

class LocalPortalWorkflow {
  private temporary = mkdtempSync(join(tmpdir(), 'tocyn-portal-workflow-'));
  private state = join(this.temporary, 'state');
  private configPath = join(this.temporary, 'wrangler.json');
  private worker: ChildProcess | undefined;
  private workerLog: number | undefined;
  private secrets = { JWT_SECRET: secret(), APP_MASTER_KEY: secret(), MFA_ENCRYPTION_KEY: secret() };
  private routeRequests = 0;
  private restarts = 0;

  private command(args: string[], json = false): string {
    const result = spawnSync(process.execPath, [wrangler, ...args, '--config', this.configPath], {
      cwd: this.temporary, env: localEnvironment(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error('A local Wrangler command failed without exposing its output');
    return json ? result.stdout : '';
  }

  private initializeGuardedBeta(): void {
    const policyPath = join(this.temporary, 'beta-policy.json');
    const policy = {
      runId: `portal-workflow-${randomBytes(8).toString('hex')}`,
      tenants: ['fixture-tenant-a', 'fixture-tenant-b'],
      invitations: ['fixture-tenant-a', 'fixture-tenant-b'].flatMap(tenantId => [
        { tenantId, kind: 'customer', id: 'fixture-customer' },
        { tenantId, kind: 'staff', id: 'fixture-operator' },
      ]),
    };
    writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', betaOperator,
        'initialize', '--local', '--persist-to', this.state, '--expected-revision', '0', '--policy', policyPath], {
        cwd: serverRoot, env: localEnvironment(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      });
      if (result.status !== 0) throw new Error('The local beta operator rejected the run-owned policy');
      const initialized = JSON.parse(result.stdout) as { state?: string; revision?: number };
      assert.deepEqual(initialized, { run_id: policy.runId, revision: 1, state: 'running', ticket_limit: 100, mutation_limit: 1000, recovery_reserve: 200, upload_limit: 100, tickets: 0, mutations: 0, upload_attempts: 0 },
        'The supported local operator must initialize the exact two-tenant policy before Worker startup');
    } finally {
      rmSync(policyPath, { force: true });
    }
  }

  private async releasePort(): Promise<void> {
    const probe = createServer();
    await new Promise<void>((resolvePromise, reject) => { probe.once('error', reject); probe.listen(8787, '127.0.0.1', resolvePromise); });
    await new Promise<void>(resolvePromise => probe.close(() => resolvePromise()));
  }

  private async stopWorker(): Promise<void> {
    if (!this.worker?.pid || this.worker.exitCode !== null || this.worker.signalCode !== null) return;
    const running = () => !!this.worker?.pid && this.worker.exitCode === null && this.worker.signalCode === null;
    try { process.kill(-this.worker.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    if (running()) await Promise.race([once(this.worker, 'exit'), new Promise(resolvePromise => setTimeout(resolvePromise, 1_500))]);
    if (running()) {
      try { process.kill(-this.worker.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      if (running()) await once(this.worker, 'exit');
    }
  }

  private async waitForHealth(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (this.worker?.exitCode !== null) throw new Error('Local Worker stopped before becoming ready');
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500), redirect: 'error' });
        await response.body?.cancel();
        if (response.status === 200) return;
      } catch { /* wait only for the run-owned loopback Worker */ }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 150));
    }
    throw new Error('Local Worker did not become ready');
  }

  async start(): Promise<readonly Credentials[]> {
    const config = JSON.parse(readFileSync(join(serverRoot, 'wrangler.local.json'), 'utf8'));
    assert.equal(config.vars?.ENVIRONMENT, 'local');
    assert.ok(config.d1_databases.every((binding: { remote?: boolean }) => binding.remote === false));
    assert.ok(config.r2_buckets.every((binding: { remote?: boolean }) => binding.remote === false));
    config.vars.LOCAL_BETA_ENABLED = 'true';
    config.main = join(serverRoot, 'scripts/local-portal-workflow-entry.ts');
    config.d1_databases[0].migrations_dir = join(serverRoot, 'migrations');
    writeFileSync(this.configPath, JSON.stringify(config), { mode: 0o600 });
    this.command(['d1', 'migrations', 'apply', 'tocyn-local', '--local', '--persist-to', this.state]);
    const bootstrap = await createLocalFixtureBootstrap(this.secrets);
    const sqlFile = join(this.temporary, 'fixture.sql');
    writeFileSync(sqlFile, bootstrap.sql, { mode: 0o600 });
    try { this.command(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', this.state, '--file', sqlFile]); }
    finally { rmSync(sqlFile, { force: true }); }
    this.initializeGuardedBeta();
    await this.restart(startClock, 0);
    return bootstrap.credentials;
  }

  async restart(clockMs: number, captureFailures: number): Promise<void> {
    assert.ok(Number.isSafeInteger(clockMs) && clockMs >= 0, 'runner clock must be a non-negative safe integer');
    assert.ok(Number.isSafeInteger(captureFailures) && captureFailures >= 0, 'capture failure count must be a non-negative safe integer');
    await this.stopWorker();
    await this.releasePort();
    if (this.workerLog !== undefined) { closeSync(this.workerLog); this.workerLog = undefined; }
    writeFileSync(join(this.temporary, '.dev.vars'), [
      ...Object.entries(this.secrets).map(([key, value]) => `${key}=${value}`),
      `LOCAL_TEST_CLOCK_MS=${clockMs}`,
      `LOCAL_TEST_CAPTURE_FAILURES=${captureFailures}`,
    ].join('\n') + '\n', { mode: 0o600 });
    this.workerLog = openSync(join(this.temporary, `worker-${this.restarts}.log`), 'w', 0o600);
    this.worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', this.state, '--config', this.configPath], {
      cwd: this.temporary, env: localEnvironment(), stdio: ['ignore', this.workerLog, this.workerLog], detached: process.platform !== 'win32',
    });
    this.restarts++;
    await this.waitForHealth();
  }

  async request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
    this.routeRequests++;
    const headers = new Headers(init.headers);
    if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
    return fetch(`${origin}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(5_000) });
  }

  async json<T>(path: string, body: unknown, token?: string): Promise<{ response: Response; body: T }> {
    const response = await this.request(path, { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, body: await response.json() as T };
  }

  async captured(): Promise<CapturedMessage[]> {
    const response = await this.request('/__local/auth-capture/messages');
    assertStatus(response, 200, 'read local captured email');
    return response.json() as Promise<CapturedMessage[]>;
  }

  async d1Rows(): Promise<number> {
    const output = this.command(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', this.state,
      '--command', 'SELECT (SELECT count(*) FROM tickets) + (SELECT count(*) FROM articles) + (SELECT count(*) FROM customer_auth_tokens) AS count', '--json'], true);
    const parsed = JSON.parse(output) as Array<{ results?: Array<{ count?: number }> }>;
    const value = parsed[0]?.results?.[0]?.count;
    assert.ok(Number.isSafeInteger(value), 'local D1 diagnostic must return a bounded row count');
    return value as number;
  }

  async conversationCounts(): Promise<ConversationCounts> {
    const output = this.command(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', this.state,
      '--command', 'SELECT (SELECT count(*) FROM articles) AS articles, (SELECT count(*) FROM conversation_events) AS events', '--json'], true);
    const parsed = JSON.parse(output) as Array<{ results?: Array<Partial<ConversationCounts>> }>;
    const counts = parsed[0]?.results?.[0];
    assert.ok(Number.isSafeInteger(counts?.articles) && Number.isSafeInteger(counts?.events), 'local D1 diagnostic must return article and event counts');
    const verified = counts as ConversationCounts;
    return { articles: verified.articles, events: verified.events };
  }

  async latestChallengeExpiry(): Promise<string> {
    const output = this.command(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', this.state,
      '--command', 'SELECT expires_at FROM customer_auth_tokens ORDER BY expires_at DESC LIMIT 1', '--json'], true);
    const parsed = JSON.parse(output) as Array<{ results?: Array<{ expires_at?: string }> }>;
    const expiry = parsed[0]?.results?.[0]?.expires_at;
    assert.ok(typeof expiry === 'string', 'local D1 diagnostic must retain the challenge expiry');
    return expiry;
  }

  async cleanup(): Promise<void> {
    try { await this.stopWorker(); }
    finally {
      if (this.workerLog !== undefined) { try { closeSync(this.workerLog); } catch { /* already closed */ } }
      rmSync(this.temporary, { recursive: true, force: true });
    }
  }

  report(d1Rows: number, capturedMessages: number, delta: ConversationCounts): WorkflowReport {
    return Object.freeze({ result: 'passed', mode: 'disposable-local-wrangler', tenants: 2, workerRestarts: this.restarts,
      routeRequests: this.routeRequests, d1Rows, capturedMessages, articleDelta: delta.articles, eventDelta: delta.events });
  }
}

test('localhost Wrangler proves portal login, tenant isolation, delivery recovery, challenge expiry, session revocation, and session expiry', async () => {
  const workflow = new LocalPortalWorkflow();
  let report: WorkflowReport | undefined;
  try {
    const credentials = await workflow.start();
    const customerA = credentials.find(credential => credential.email === 'tocyn-auth-test-a@example.invalid');
    const customerB = credentials.find(credential => credential.email === 'tocyn-auth-test-b@example.invalid');
    const operatorA = credentials.find(credential => credential.email === 'fixture.operator.a@example.test');
    assert.ok(customerA && customerB && operatorA?.provisioningUri, 'bootstrap must retain only the approved customer recipients and one synthetic operator');
    const operatorProvisioningUri = operatorA.provisioningUri;
    const baseline = await workflow.conversationCounts();

    const requestLink = async (email: string, key: string) => {
      const result = await workflow.json<{ success: boolean }>('/api/v1/customer/auth/request', { email, type: 'magic_link', widgetKey: key });
      assertStatus(result.response, 200, 'customer magic-link request');
      assert.equal(result.body.success, true);
      const messages = await workflow.captured();
      const message = messages.findLast(candidate => candidate.to === email);
      assert.ok(message, 'requested approved recipient must receive exactly its local capture message');
      return opaqueToken(message);
    };
    const verify = async (token: string, key: string) => {
      const result = await workflow.json<{ token?: string }>('/api/v1/customer/auth/verify', { token, widgetKey: key });
      return result;
    };

    const aChallenge = await requestLink(customerA.email, 'fixture-widget-key-a');
    const bChallenge = await requestLink(customerB.email, 'fixture-widget-key-b');
    const expiredChallenge = await requestLink(customerA.email, 'fixture-widget-key-a');
    assert.equal(await workflow.latestChallengeExpiry(), new Date(startClock + 15 * 60_000).toISOString(),
      'fixed local clock must give the persisted challenge and capture the same expiry');
    const foreignRedeem = await verify(aChallenge, 'fixture-widget-key-b');
    assertStatus(foreignRedeem.response, 401, 'tenant B must not redeem tenant A challenge');
    const verifiedA = await verify(aChallenge, 'fixture-widget-key-a');
    assertStatus(verifiedA.response, 200, 'tenant A customer must redeem its own challenge');
    assert.ok(verifiedA.body.token, 'normal verification must issue tenant A customer token');
    assert.equal(decodeJwt(verifiedA.body.token).iat, Math.floor(startClock / 1_000), 'normal verification must sign the JWT at the injected clock');
    const verifiedB = await verify(bChallenge, 'fixture-widget-key-b');
    assertStatus(verifiedB.response, 200, 'tenant B customer must redeem its own challenge');
    assert.ok(verifiedB.body.token, 'normal verification must issue tenant B customer token');
    const usedLink = await verify(aChallenge, 'fixture-widget-key-a');
    assertStatus(usedLink.response, 401, 'a redeemed customer link must not be replayed');

    const create = await workflow.json<{ ticket?: { id?: string } }>('/api/v1/customer/tickets', {
      subject: 'Local portal workflow', message: 'Customer message persisted before operator delivery.',
    }, verifiedA.body.token);
    assertStatus(create.response, 201, 'authenticated tenant A portal intake');
    const ticketId = create.body.ticket?.id;
    assert.ok(ticketId, 'portal intake must return a ticket id');
    const list = await workflow.request('/api/v1/customer/tickets', { token: verifiedA.body.token });
    assertStatus(list, 200, 'customer ticket list must include its persisted intake');
    const listed = await list.json() as { data?: Array<{ id?: string }> };
    assert.ok(listed.data?.some(ticket => ticket.id === ticketId), 'customer list must include its own ticket');
    const foreignDetail = await workflow.request(`/api/v1/customer/tickets/${ticketId}`, { token: verifiedB.body.token });
    assertStatus(foreignDetail, 404, 'tenant B customer must not retrieve tenant A conversation');
    const customerReply = await workflow.json<{ id?: string }>(`/api/v1/customer/tickets/${ticketId}/messages`, {
      message: 'Customer follow-up is visible before an operator response.',
    }, verifiedA.body.token);
    assertStatus(customerReply.response, 201, 'customer follow-up reply');
    assert.ok(customerReply.body.id, 'customer follow-up must create an article');

    const operatorSession = async () => {
      const login = await workflow.json<{ mfa_required?: boolean; token?: string }>('/api/auth/login', { email: operatorA.email, password: operatorA.password });
      assertStatus(login.response, 200, 'operator password login');
      assert.equal(login.body.mfa_required, true, 'operator route must require MFA');
      assert.ok(login.body.token, 'operator password login must issue only an MFA challenge');
      const mfa = await workflow.json<{ token?: string }>('/api/auth/mfa/verify', { code: totp(operatorProvisioningUri) }, login.body.token);
      assertStatus(mfa.response, 200, 'operator MFA verification');
      assert.ok(mfa.body.token, 'MFA verification must issue an operator session');
      return mfa.body.token;
    };

    await workflow.restart(startClock, 1);
    const failedDeliverySession = await operatorSession();
    const reply = await workflow.json<{ id?: string }>('/api/tickets/' + ticketId + '/articles', {
      body: 'Operator reply survives a deliberately failed local delivery.', is_internal: false,
    }, failedDeliverySession);
    assertStatus(reply.response, 201, 'operator reply must commit despite captured-mail outage');
    assert.ok(reply.body.id, 'committed reply must return its article id');
    assert.equal((await workflow.captured()).length, 0, 'injected local mail failure must not report a delivered capture');
    const detail = await workflow.request(`/api/v1/customer/tickets/${ticketId}`, { token: verifiedA.body.token });
    assertStatus(detail, 200, 'customer must recover the stored reply after delivery failure');
    const conversation = await detail.json() as { articles?: Array<{ body?: string }> };
    assert.ok(conversation.articles?.some(article => article.body === 'Operator reply survives a deliberately failed local delivery.'), 'delivery failure must not roll back the operator reply');

    await workflow.restart(startClock + 15 * 60_000 + 1, 0);
    const expired = await verify(expiredChallenge, 'fixture-widget-key-a');
    assertStatus(expired.response, 401, 'expired persisted challenge must be rejected through normal verification');
    const bLogout = await workflow.request('/api/v1/customer/auth/logout', {
      method: 'POST', token: verifiedB.body.token, headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assertStatus(bLogout, 200, 'unexpired tenant B customer may revoke its own session');
    const revoked = await workflow.request('/api/v1/customer/auth/me', { token: verifiedB.body.token });
    assertStatus(revoked, 401, 'session revocation must be distinct from token expiry');
    const activeA = await workflow.request('/api/v1/customer/auth/me', { token: verifiedA.body.token });
    assertStatus(activeA, 200, 'tenant A session remains live before its JWT expiry');
    const successfulDeliverySession = await operatorSession();
    const deliveredReply = await workflow.json<{ id?: string }>(`/api/tickets/${ticketId}/articles`, {
      body: 'Operator reply reaches the local approved recipient.', is_internal: false,
    }, successfulDeliverySession);
    assertStatus(deliveredReply.response, 201, 'operator reply with successful local capture');
    assert.ok(deliveredReply.body.id, 'successful operator reply must create an article');
    const capturedDelivery = await workflow.captured();
    assert.equal(capturedDelivery.length, 1, 'one successful operator reply must create one local capture');
    assert.equal(capturedDelivery[0]?.to, customerA.email, 'successful operator delivery must target the owning approved customer recipient');
    assert.equal(capturedDelivery[0]?.loginLink, undefined, 'conversation delivery must not be mistaken for an authentication link');
    const internalNote = await workflow.json<{ id?: string }>(`/api/tickets/${ticketId}/articles`, {
      body: 'Internal operator note must not reach the customer.', is_internal: true,
    }, successfulDeliverySession);
    assertStatus(internalNote.response, 201, 'operator internal note');
    assert.ok(internalNote.body.id, 'internal note must create an article for staff only');
    const publicDetail = await workflow.request(`/api/v1/customer/tickets/${ticketId}`, { token: verifiedA.body.token });
    assertStatus(publicDetail, 200, 'customer detail remains readable after internal note');
    const publicConversation = await publicDetail.json() as { articles?: Array<{ id?: string; body?: string; is_internal?: boolean }> };
    assert.ok(publicConversation.articles?.some(article => article.body === 'Customer follow-up is visible before an operator response.'), 'customer detail must retain the customer follow-up');
    assert.ok(publicConversation.articles?.some(article => article.body === 'Operator reply reaches the local approved recipient.'), 'customer detail must retain the successful operator reply');
    assert.equal(publicConversation.articles?.some(article => article.id === internalNote.body.id || article.body === 'Internal operator note must not reach the customer.'), false,
      'customer detail must filter internal article identities and content');
    const history = await workflow.request(`/api/v1/customer/tickets/${ticketId}/history`, { token: verifiedA.body.token });
    assertStatus(history, 200, 'customer history remains available after mail failure and internal note');
    const publicHistory = await history.json() as { events?: Array<{ kind?: string; visibility?: string; facts?: unknown; articleId?: string }> };
    assert.equal(publicHistory.events?.length, 4, 'customer history must include intake and three public replies only');
    assert.ok(publicHistory.events?.every(event => (event.kind === 'ticket.intake' || event.kind === 'message.reply') && event.visibility === 'public'),
      'customer history must expose only public intake/reply events');
    assert.ok(publicHistory.events?.every(event => JSON.stringify(event.facts) === '{}'), 'customer history must redact internal facts');
    assert.equal(publicHistory.events?.some(event => event.articleId === internalNote.body.id), false, 'customer history must omit the internal note event');

    await workflow.restart(startClock + 7 * 24 * 60 * 60_000 + 1, 0);
    const expiredSession = await workflow.request('/api/v1/customer/auth/me', { token: verifiedA.body.token });
    assertStatus(expiredSession, 401, 'normal widget JWT verification must reject an expired session');
    const rows = await workflow.d1Rows();
    const captures = (await workflow.captured()).length;
    const finalCounts = await workflow.conversationCounts();
    const delta = { articles: finalCounts.articles - baseline.articles, events: finalCounts.events - baseline.events };
    assert.deepEqual(delta, { articles: 5, events: 5 }, 'each persisted intake, public reply, and internal note must add one article and one event');
    report = workflow.report(rows, captures, delta);
    assert.equal(report.tenants, 2);
    assert.ok(report.d1Rows > 0, 'local run must report persisted D1 resource use');
  } finally {
    await workflow.cleanup();
  }
  assert.ok(report, 'successful workflow must retain a redacted resource receipt');
  process.stdout.write(`local portal workflow resource receipt ${JSON.stringify({ ...report, cleanup: 'disposed' })}\n`);
});
