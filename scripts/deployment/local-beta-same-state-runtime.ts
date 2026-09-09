import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  assertCompatibleMigrations, assertPreservedFallbackState, assertRequiredSchemaTables,
  canonicalDigest, passedFallbackReceipt, unavailableFallbackReceipt,
} from './local-beta-same-state-fallback.mjs';

type FallbackLifecycle = {
  run: (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<void>;
  /** Provided by the rehearsal lifecycle owner: an owned long-running process scope. */
  startService?: (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => { pid?: number; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; exitCode: number | null; signalCode: NodeJS.Signals | null };
  stopService?: (service: { pid?: number; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; exitCode: number | null; signalCode: NodeJS.Signals | null }) => Promise<void>;
};

type Source = Readonly<{ source: string; revision: string }>;
type BootstrapCredential = Readonly<{ email: string; password: string; provisioningUri?: string }>;
type Bootstrap = Readonly<{ sql: string; credentials: readonly BootstrapCredential[] }>;
type RuntimeSnapshot = Readonly<{
  canonical: string; tickets: number; articles: number; events: number;
  admission: Readonly<{ state: 'running'; revision: number; tickets: number; mutations: number; uploadAttempts: number }>;
}>;
type ManagedService = { pid?: number; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; exitCode: number | null; signalCode: NodeJS.Signals | null };

const serverRelative = 'apps/server';
const requiredSources = ['scripts/local-portal-workflow-entry.ts', 'scripts/local-tenant-fixture.ts', 'scripts/local-beta-state.ts', 'wrangler.local.json'];
const fixturePrincipals = new Set(['tocyn-auth-test-a@example.invalid', 'tocyn-auth-test-b@example.invalid', 'fixture.operator.a@example.test', 'fixture.operator.b@example.test']);
const captureRecipients = new Set(['tocyn-auth-test-a@example.invalid', 'tocyn-auth-test-b@example.invalid']);
const origin = 'http://localhost:8787';
const fixedClock = Date.UTC(2030, 0, 2, 3, 4, 5);

function fail(message: string): never { throw new Error(`Local same-state fallback rejected: ${message}`); }
function secret(): string { return randomBytes(32).toString('hex'); }
function safeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${name} must be a non-negative safe integer`);
  return value as number;
}
function sourcePath(source: Source): string {
  if (!isAbsolute(source.source) || !/^[0-9a-f]{40}$/i.test(source.revision)) fail('candidate and known-good sources must be absolute paths with full immutable SHAs');
  for (const relative of requiredSources) if (!existsSync(join(source.source, serverRelative, relative))) fail('source is missing the supported local workflow fixture');
  return resolve(source.source);
}
function assertCleanSource(source: Source): string {
  const path = sourcePath(source);
  let head: string;
  let status: string;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { fail('source is not a readable local git worktree'); }
  if (head !== source.revision.toLowerCase()) fail('source HEAD does not match its declared immutable revision');
  if (status) fail('source worktree is not clean');
  return path;
}
function sourceServer(source: Source): string { return join(sourcePath(source), serverRelative); }
function mode700(path: string): void { mkdirSync(path, { recursive: true, mode: 0o700 }); }
function mode600(path: string, contents: string): void { writeFileSync(path, contents, { mode: 0o600 }); }

export function assertLocalBindingInventory(config: Record<string, unknown>): void {
  for (const key of ['ai', 'vectorize', 'workflows', 'queues', 'services', 'service_bindings']) {
    if (Object.hasOwn(config, key)) fail(`local configuration must not declare ${key}`);
  }
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.remote === true) fail('local configuration must not declare a remote binding');
    for (const nested of Object.values(record)) walk(nested);
  };
  walk(config);
  if ((config.observability as { enabled?: unknown } | undefined)?.enabled !== false) fail('local configuration must disable observability');
}

function localEnvironment(taskRoot: string): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const name of ['HOME', 'PATH', 'LANG', 'TERM', 'USER', 'LOGNAME', 'SHELL']) if (process.env[name]) base[name] = process.env[name];
  for (const [name, value] of Object.entries(process.env)) if (name.startsWith('LC_')) base[name] = value;
  return {
    ...base,
    WRANGLER_SEND_METRICS: 'false', TZ: 'UTC', TMPDIR: join(taskRoot, 'tmp'),
    XDG_CONFIG_HOME: join(taskRoot, 'config'), XDG_CACHE_HOME: join(taskRoot, 'cache'),
    VITE_API_URL: 'https://api.beta.local.invalid', VITE_WIDGET_KEY: 'local-rehearsal-widget-key',
  };
}

async function portAvailable(): Promise<boolean> {
  const probe = createServer();
  return new Promise(resolvePromise => {
    probe.once('error', () => resolvePromise(false));
    probe.listen(8787, '127.0.0.1', () => probe.close(() => resolvePromise(true)));
  });
}

async function waitForHealth(child: ManagedService): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) fail('owned local Worker stopped before readiness');
    try {
      const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch { /* wait only for the owned loopback Worker */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  fail('owned local Worker did not become ready');
}

function responseStatus(response: Response, expected: number, name: string): void {
  if (response.status !== expected) fail(`${name} returned ${response.status}`);
}

async function request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  return fetch(`${origin}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(5_000) });
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<{ response: Response; body: T }> {
  const response = await request(path, { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { response, body: await response.json() as T };
}

function totp(uri: string, source: Source): string {
  const OTPAuth = createRequire(join(sourceServer(source), 'package.json'))('otpauth') as { URI: { parse: (uri: string) => { generate: () => string } }; TOTP: new (...args: never[]) => { generate: () => string } };
  const parsed = OTPAuth.URI.parse(uri);
  assert.ok(parsed instanceof OTPAuth.TOTP, 'fixture MFA provisioning URI must contain a TOTP secret');
  return parsed.generate();
}

async function loadBootstrap(source: Source, encryptionKey: string): Promise<Bootstrap> {
  const module = await import(pathToFileURL(join(sourceServer(source), 'scripts/local-tenant-fixture.ts')).href) as { createLocalFixtureBootstrap: (env: { MFA_ENCRYPTION_KEY: string }) => Promise<Bootstrap> };
  return module.createLocalFixtureBootstrap({ MFA_ENCRYPTION_KEY: encryptionKey });
}

async function stateSnapshot(source: Source, state: string, customerToken: string, staffToken: string, ticketId: string): Promise<RuntimeSnapshot> {
  const detail = await request(`/api/v1/customer/tickets/${ticketId}`, { token: customerToken });
  responseStatus(detail, 200, 'authorized customer detail');
  const history = await request(`/api/tickets/${ticketId}/history`, { token: staffToken });
  responseStatus(history, 200, 'authorized staff history');
  const canonical = canonicalDigest({ customerDetail: await detail.json(), staffHistory: await history.json() });
  const module = await import(pathToFileURL(join(sourceServer(source), 'scripts/local-beta-state.ts')).href) as { openLocalBetaState: (directory: string) => { prepare: (sql: string) => { get: () => unknown; all: () => unknown[] }; close: () => void } };
  const db = module.openLocalBetaState(state);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => (row as { name?: unknown }).name);
    assertRequiredSchemaTables(tables);
    // The supported local state helper verifies the precise two-tenant fixture before this bounded read.
    const row = db.prepare(`SELECT
      (SELECT count(*) FROM tickets) AS tickets,
      (SELECT count(*) FROM articles) AS articles,
      (SELECT count(*) FROM conversation_events) AS events,
      (SELECT state FROM local_beta_policy WHERE singleton=1) AS state,
      (SELECT revision FROM local_beta_policy WHERE singleton=1) AS revision,
      (SELECT tickets FROM local_beta_runs WHERE run_id=(SELECT run_id FROM local_beta_policy WHERE singleton=1)) AS beta_tickets,
      (SELECT mutations FROM local_beta_runs WHERE run_id=(SELECT run_id FROM local_beta_policy WHERE singleton=1)) AS mutations,
      (SELECT upload_attempts FROM local_beta_runs WHERE run_id=(SELECT run_id FROM local_beta_policy WHERE singleton=1)) AS upload_attempts`).get() as Record<string, unknown>;
    if (row.state !== 'running') fail('local beta admission policy is not running');
    return {
      canonical,
      tickets: safeInteger(row.tickets, 'ticket count'), articles: safeInteger(row.articles, 'article count'), events: safeInteger(row.events, 'event count'),
      admission: { state: 'running', revision: safeInteger(row.revision, 'policy revision'), tickets: safeInteger(row.beta_tickets, 'admission tickets'), mutations: safeInteger(row.mutations, 'admission mutations'), uploadAttempts: safeInteger(row.upload_attempts, 'admission upload attempts') },
    };
  } finally { db.close(); }
}

function localConfig(source: Source, taskRoot: string): string {
  const server = sourceServer(source);
  const config = JSON.parse(readFileSync(join(server, 'wrangler.local.json'), 'utf8')) as { vars?: Record<string, string>; d1_databases?: Array<{ remote?: boolean }>; r2_buckets?: Array<{ remote?: boolean }> } & Record<string, unknown>;
  if (config.vars?.ENVIRONMENT !== 'local' || !config.d1_databases?.every(binding => binding.remote === false) || !config.r2_buckets?.every(binding => binding.remote === false)) fail('source local Wrangler configuration is not local-only');
  assertLocalBindingInventory(config);
  config.vars = { ...config.vars, LOCAL_BETA_ENABLED: 'true' };
  config.main = join(server, 'scripts/local-portal-workflow-entry.ts');
  config.d1_databases = config.d1_databases.map(binding => ({ ...binding, migrations_dir: join(server, 'migrations') }));
  const configPath = join(taskRoot, 'wrangler.json');
  mode600(configPath, JSON.stringify(config));
  return configPath;
}

async function initializePolicy(lifecycle: FallbackLifecycle, source: Source, state: string, taskRoot: string, env: NodeJS.ProcessEnv): Promise<void> {
  const policyPath = join(taskRoot, 'beta-policy.json');
  mode600(policyPath, JSON.stringify({
    runId: `same-state-${randomBytes(8).toString('hex')}`,
    tenants: ['fixture-tenant-a', 'fixture-tenant-b'],
    invitations: ['fixture-tenant-a', 'fixture-tenant-b'].flatMap(tenantId => [
      { tenantId, kind: 'customer', id: 'fixture-customer' }, { tenantId, kind: 'staff', id: 'fixture-operator' },
    ]),
  }));
  await lifecycle.run(process.execPath, ['--import', 'tsx', join(sourceServer(source), 'scripts/run-local-beta-operator.ts'), 'initialize', '--local', '--persist-to', state, '--expected-revision', '0', '--policy', policyPath], sourceServer(source), env);
}

async function runSeed(lifecycle: FallbackLifecycle, source: Source, state: string, config: string, taskRoot: string, bootstrap: Bootstrap, env: NodeJS.ProcessEnv): Promise<void> {
  const wrangler = join(source.source, 'node_modules/wrangler/bin/wrangler.js');
  const sqlPath = join(taskRoot, 'fixture.sql');
  mode600(sqlPath, bootstrap.sql);
  await lifecycle.run(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'tocyn-local', '--local', '--persist-to', state, '--config', config], taskRoot, env);
  await lifecycle.run(process.execPath, [wrangler, 'd1', 'execute', 'tocyn-local', '--local', '--persist-to', state, '--file', sqlPath, '--config', config], taskRoot, env);
  await initializePolicy(lifecycle, source, state, taskRoot, env);
}

async function issueSessionsAndMutate(bootstrap: Bootstrap, source: Source): Promise<{ customerToken: string; staffToken: string; ticketId: string }> {
  const customer = bootstrap.credentials.find(credential => credential.email === 'tocyn-auth-test-a@example.invalid');
  const operator = bootstrap.credentials.find(credential => credential.email === 'fixture.operator.a@example.test');
  if (!customer || !operator?.provisioningUri || bootstrap.credentials.length !== fixturePrincipals.size || bootstrap.credentials.some(credential => !fixturePrincipals.has(credential.email))) fail('the supported four-principal local fixture is unavailable');
  if (!captureRecipients.has(customer.email)) fail('the selected fixture customer is not an approved local capture recipient');
  const requested = await postJson<{ success?: boolean }>('/api/v1/customer/auth/request', { email: customer.email, type: 'magic_link', widgetKey: 'fixture-widget-key-a' });
  responseStatus(requested.response, 200, 'customer magic-link request');
  const captured = await request('/__local/auth-capture/messages'); responseStatus(captured, 200, 'local auth capture read');
  const messages = await captured.json() as Array<{ to?: string; loginLink?: string }>;
  const link = messages.find(message => message.to === customer.email)?.loginLink;
  if (messages.some(message => typeof message.to !== 'string' || !captureRecipients.has(message.to))) fail('local capture produced an unapproved recipient');
  const opaque = link && new URL(link).searchParams.get('token');
  if (!opaque || !/^[0-9a-f]{64}$/.test(opaque)) fail('local capture did not yield an opaque customer challenge');
  const verified = await postJson<{ token?: string }>('/api/v1/customer/auth/verify', { token: opaque, widgetKey: 'fixture-widget-key-a' });
  responseStatus(verified.response, 200, 'customer challenge verification');
  if (!verified.body.token) fail('customer verification did not issue a session');
  const intake = await postJson<{ ticket?: { id?: string } }>('/api/v1/customer/tickets', { subject: 'Synthetic fallback intake', message: 'Synthetic persisted customer conversation.' }, verified.body.token);
  responseStatus(intake.response, 201, 'customer intake');
  const ticketId = intake.body.ticket?.id;
  if (!ticketId) fail('customer intake did not create a ticket');
  const followUp = await postJson<{ id?: string }>(`/api/v1/customer/tickets/${ticketId}/messages`, { message: 'Synthetic customer follow-up.' }, verified.body.token);
  responseStatus(followUp.response, 201, 'customer follow-up');
  const login = await postJson<{ token?: string; mfa_required?: boolean }>('/api/auth/login', { email: operator.email, password: operator.password });
  responseStatus(login.response, 200, 'staff password login');
  if (!login.body.token || login.body.mfa_required !== true) fail('staff login did not issue an MFA challenge');
  const mfa = await postJson<{ token?: string }>('/api/auth/mfa/verify', { code: totp(operator.provisioningUri, source) }, login.body.token);
  responseStatus(mfa.response, 200, 'staff MFA verification');
  if (!mfa.body.token) fail('staff MFA verification did not issue a session');
  const reply = await postJson<{ id?: string }>(`/api/tickets/${ticketId}/articles`, { body: 'Synthetic staff reply.', is_internal: false }, mfa.body.token);
  responseStatus(reply.response, 201, 'staff reply');
  const transition = await request(`/api/tickets/${ticketId}`, { method: 'PATCH', token: mfa.body.token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pending' }) });
  responseStatus(transition, 200, 'staff state transition');
  return { customerToken: verified.body.token, staffToken: mfa.body.token, ticketId };
}

async function startWorker(lifecycle: FallbackLifecycle, source: Source, state: string, config: string, taskRoot: string, env: NodeJS.ProcessEnv): Promise<ManagedService> {
  if (!lifecycle.startService || !lifecycle.stopService) fail('rehearsal lifecycle does not provide the approved managed-service interface');
  const wrangler = join(source.source, 'node_modules/wrangler/bin/wrangler.js');
  const child = await lifecycle.startService(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', state, '--config', config], taskRoot, env);
  await waitForHealth(child);
  return child;
}

export async function runSameStateFallback({ candidate, knownGood, taskRoot, lifecycle }: { candidate: Source; knownGood: Source; taskRoot: string; lifecycle: FallbackLifecycle }) {
  if (!isAbsolute(taskRoot) || !lstatSync(taskRoot).isDirectory()) fail('task root must be an existing absolute runner-owned directory');
  if (!await portAvailable()) return unavailableFallbackReceipt({ candidate: candidate.revision, knownGood: knownGood.revision, reason: 'loopback_port_unavailable' });
  const candidatePath = assertCleanSource(candidate);
  const knownGoodPath = assertCleanSource(knownGood);
  let migrations;
  try { migrations = assertCompatibleMigrations(candidatePath, knownGoodPath); }
  catch { return unavailableFallbackReceipt({ candidate: candidate.revision, knownGood: knownGood.revision, reason: 'migration_manifest_incompatible' }); }
  const state = join(taskRoot, 'same-state'); mode700(state);
  for (const name of ['tmp', 'config', 'cache']) mode700(join(taskRoot, name));
  const env = localEnvironment(taskRoot);
  const secrets = { JWT_SECRET: secret(), APP_MASTER_KEY: secret(), MFA_ENCRYPTION_KEY: secret() };
  mode600(join(taskRoot, '.dev.vars'), [...Object.entries(secrets).map(([name, value]) => `${name}=${value}`), `LOCAL_TEST_CLOCK_MS=${fixedClock}`, 'LOCAL_TEST_CAPTURE_FAILURES=0'].join('\n') + '\n');
  const candidateConfig = localConfig(candidate, taskRoot);
  const bootstrap = await loadBootstrap(candidate, secrets.MFA_ENCRYPTION_KEY);
  await runSeed(lifecycle, candidate, state, candidateConfig, taskRoot, bootstrap, env);
  let candidateWorker: ManagedService | undefined;
  let knownGoodWorker: ManagedService | undefined;
  try {
    candidateWorker = await startWorker(lifecycle, candidate, state, candidateConfig, taskRoot, env);
    const sessions = await issueSessionsAndMutate(bootstrap, candidate);
    const candidateSnapshot = await stateSnapshot(candidate, state, sessions.customerToken, sessions.staffToken, sessions.ticketId);
    assert.ok(candidateSnapshot.articles >= 3 && candidateSnapshot.events >= 4 && candidateSnapshot.admission.mutations >= 4, 'candidate must persist the expected canonical/audit/admission state');
    await lifecycle.stopService!(candidateWorker); candidateWorker = undefined;
    if (!await portAvailable()) fail('candidate Worker did not release the loopback port');
    const knownGoodConfig = localConfig(knownGood, taskRoot);
    knownGoodWorker = await startWorker(lifecycle, knownGood, state, knownGoodConfig, taskRoot, env);
    const knownGoodSnapshot = await stateSnapshot(knownGood, state, sessions.customerToken, sessions.staffToken, sessions.ticketId);
    const preserved = assertPreservedFallbackState(candidateSnapshot, knownGoodSnapshot);
    return passedFallbackReceipt({ candidate: candidate.revision, knownGood: knownGood.revision, migrations: migrations.digest, snapshot: preserved });
  } finally {
    if (candidateWorker) await lifecycle.stopService!(candidateWorker);
    if (knownGoodWorker) await lifecycle.stopService!(knownGoodWorker);
  }
}
