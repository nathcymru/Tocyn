import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OTPAuth from 'otpauth';
import { createLocalFixtureBootstrap } from './local-tenant-fixture.ts';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serverRoot, '../..');
const wrangler = join(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');
const temporary = mkdtempSync(join(tmpdir(), 'tocyn-local-realtime-'));
const state = join(temporary, 'state');
const configPath = join(temporary, 'wrangler.json');
const workerLog = openSync(join(temporary, 'runtime.log'), 'w', 0o600);
const started = Date.now();
const children = new Set();
const sockets = new Set();
let cleanupPromise;
let interrupted = false;
let phase = 'initializing';
let report;

function localSecret() {
  return randomBytes(32).toString('hex');
}

function redactedWorkerDiagnostic() {
  try {
    const output = readFileSync(join(temporary, 'runtime.log'), 'utf8');
    return {
      started: /Ready|listening/i.test(output),
      configuration: /config(?:uration)?|binding/i.test(output),
      durableObject: /durable[ _-]?object|NotificationDO/i.test(output),
      genericError: /error|failed/i.test(output),
    };
  } catch {
    return { unavailable: true };
  }
}

function localEnvironment() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  for (const name of Object.keys(env)) {
    if (/^(CLOUDFLARE_|CF_API_|RESEND_)/.test(name)) delete env[name];
  }
  return env;
}

async function requireLocalRealtimePort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(8787, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string' && address.port === 8787, 'Local realtime port is unavailable');
  await new Promise(resolvePromise => probe.close(resolvePromise));
  return 8787;
}

function localWrangler(args) {
  if (interrupted) throw new Error('Local realtime rehearsal interrupted');
  const result = spawnSync(process.execPath, [wrangler, ...args, '--config', configPath], {
    cwd: temporary, env: localEnvironment(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 60_000,
  });
  if (result.status !== 0) throw new Error('A local Wrangler setup command failed');
}

function startWorker(port) {
  const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--config', configPath], {
    cwd: temporary, env: localEnvironment(), stdio: ['ignore', workerLog, workerLog], detached: process.platform !== 'win32',
  });
  children.add(child);
  return child;
}

async function stop(child) {
  const running = () => child?.pid && child.exitCode === null && child.signalCode === null;
  const signal = value => {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, value);
      else child.kill(value);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  };
  const waitExit = async () => {
    let timer;
    try {
      await Promise.race([once(child, 'exit'), new Promise(resolvePromise => { timer = setTimeout(resolvePromise, 1_500); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  if (running()) {
    signal('SIGTERM');
    if (running()) await waitExit();
    if (running()) {
      signal('SIGKILL');
      if (running()) await waitExit();
    }
  }
  children.delete(child);
}

async function cleanup() {
  if (!cleanupPromise) cleanupPromise = (async () => {
    try {
      for (const socket of sockets) {
        try { socket.close(); } catch { /* Socket may already be closed. */ }
      }
      await Promise.allSettled([...children].map(stop));
    } finally {
      try { closeSync(workerLog); } catch { /* Already closed. */ }
      rmSync(temporary, { recursive: true, force: true });
    }
  })();
  return cleanupPromise;
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    interrupted = true;
    void cleanup().finally(() => process.exit(code));
  });
}

async function waitForHealth(origin, child) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error('Local Worker exited before readiness');
    try {
      const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch { /* Wait only for this run-owned loopback Worker. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 150));
  }
  throw new Error('Local Worker did not become ready');
}

async function request(origin, path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response;
}

function currentOtp(provisioningUri) {
  const totp = OTPAuth.URI.parse(provisioningUri);
  assert.ok(totp instanceof OTPAuth.TOTP, 'Synthetic operator MFA credential is invalid');
  return totp.generate();
}

async function operatorToken(origin, credential) {
  const login = await request(origin, '/api/auth/login', {
    method: 'POST', body: { email: credential.email, password: credential.password },
  });
  assert.equal(login.status, 200, 'Operator password login failed');
  const challenge = await login.json();
  assert.equal(challenge.mfa_required, true, 'Operator MFA challenge missing');
  assert.equal(typeof challenge.token, 'string');
  const verified = await request(origin, '/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: currentOtp(credential.provisioningUri) },
  });
  assert.equal(verified.status, 200, 'Operator MFA verification failed');
  const result = await verified.json();
  assert.equal(typeof result.token, 'string');
  return result.token;
}

async function openSocket(url) {
  assert.equal(typeof WebSocket, 'function', 'Node 22 WebSocket client is unavailable');
  const messages = [];
  let closed;
  const socket = new WebSocket(url);
  sockets.add(socket);
  socket.addEventListener('message', event => {
    try { messages.push(JSON.parse(String(event.data))); } catch { /* Unrecognized protocol data is not evidence. */ }
  });
  socket.addEventListener('close', event => { closed = event.code; });
  await new Promise((resolvePromise, reject) => {
    let timer = setTimeout(() => reject(new Error('Local WebSocket did not open')), 5_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Local WebSocket connection failed')); }, { once: true });
  });
  return { socket, messages, closeCode: () => closed };
}

async function waitFor(predicate, reason) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(reason);
}

try {
  phase = 'checking local loopback port';
  const port = await requireLocalRealtimePort();
  const origin = `http://127.0.0.1:${port}`;
  const config = JSON.parse(readFileSync(join(serverRoot, 'wrangler.local.json'), 'utf8'));
  assert.equal(config.vars?.ENVIRONMENT, 'local');
  assert.ok(config.d1_databases?.every(binding => binding.remote === false));
  assert.ok(config.r2_buckets?.every(binding => binding.remote === false));
  assert.ok(config.durable_objects?.bindings?.some(binding => binding.name === 'NOTIFICATION_DO' && binding.class_name === 'NotificationDO'));
  config.main = join(serverRoot, 'src/local-index.ts');
  config.d1_databases[0].migrations_dir = join(serverRoot, 'migrations');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });

  const secrets = { JWT_SECRET: localSecret(), APP_MASTER_KEY: localSecret(), MFA_ENCRYPTION_KEY: localSecret() };
  writeFileSync(join(temporary, '.dev.vars'), Object.entries(secrets).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', { mode: 0o600 });
  phase = 'applying local migrations';
  localWrangler(['d1', 'migrations', 'apply', 'tocyn-local', '--local', '--persist-to', state]);
  const bootstrap = await createLocalFixtureBootstrap(secrets);
  const fixtureSql = join(temporary, 'fixture.sql');
  writeFileSync(fixtureSql, bootstrap.sql, { mode: 0o600 });
  phase = 'bootstrapping local identities';
  localWrangler(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', state, '--file', fixtureSql]);
  rmSync(fixtureSql, { force: true });

  phase = 'starting local Worker';
  const worker = startWorker(port);
  await waitForHealth(origin, worker);
  const operators = bootstrap.credentials.filter(credential => credential.provisioningUri);
  assert.equal(operators.length, 2, 'Expected two synthetic MFA operators');
  phase = 'issuing local MFA tokens';
  const [tokenA, tokenB] = await Promise.all(operators.map(credential => operatorToken(origin, credential)));
  phase = 'opening local WebSockets';
  const [a, b] = await Promise.all([
    openSocket(`ws://127.0.0.1:${port}/api/realtime?token=${encodeURIComponent(tokenA)}`),
    openSocket(`ws://127.0.0.1:${port}/api/realtime?token=${encodeURIComponent(tokenB)}`),
  ]);

  phase = 'checking tenant A delivery';
  a.socket.send(JSON.stringify({ type: 'presence.update', payload: { location: 'synthetic-a' } }));
  await waitFor(() => a.messages.some(message => message?.type === 'presence.update' && message?.payload?.location === 'synthetic-a'),
    'Tenant A realtime event was not delivered');
  assert.equal(b.messages.some(message => message?.type === 'presence.update' && message?.payload?.location === 'synthetic-a'), false,
    'Tenant A realtime event crossed into tenant B');

  phase = 'revoking tenant A session';
  localWrangler(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', state, '--command',
    "UPDATE users SET session_version = session_version + 1 WHERE tenant_id = 'fixture-tenant-a' AND id = 'fixture-operator'"]);
  phase = 'checking revocation';
  a.socket.send(JSON.stringify({ type: 'presence.update', payload: { location: 'revoked-a' } }));
  await waitFor(() => a.closeCode() === 1008, 'Revoked tenant A socket was not closed');
  b.socket.send(JSON.stringify({ type: 'presence.update', payload: { location: 'synthetic-b' } }));
  await waitFor(() => b.messages.some(message => message?.type === 'presence.update' && message?.payload?.location === 'synthetic-b'),
    'Tenant B realtime event did not continue after A revocation');
  assert.equal(b.closeCode(), undefined, 'Tenant B socket unexpectedly closed after A revocation');
  assert.equal(b.messages.some(message => message?.type === 'presence.update' && ['synthetic-a', 'revoked-a'].includes(message?.payload?.location)), false,
    'Tenant A events crossed into tenant B');
  assert.equal(a.messages.some(message => message?.type === 'presence.update' && ['revoked-a', 'synthetic-b'].includes(message?.payload?.location)), false,
    'Revoked tenant A socket received an event after its authorization ended');

  report = {
    result: 'passed', runtime: 'local-only', realtimeBinding: 'local', tenants: 2,
    mfaIssuedTokens: 2, isolatedRealtimeDelivery: true, revokedSocketClosed: true,
    unaffectedTenantContinued: true, credentialOutput: false, elapsedMs: Date.now() - started,
  };
} catch {
  console.error(`Local tenant realtime rehearsal failed during ${phase}; ${JSON.stringify(redactedWorkerDiagnostic())}; credentials, tokens, and socket URLs were not reported`);
  process.exitCode = 1;
} finally {
  await cleanup();
  if (report && process.exitCode !== 1) process.stdout.write(`${JSON.stringify({ ...report, cleanup: 'disposed' })}\n`);
}
