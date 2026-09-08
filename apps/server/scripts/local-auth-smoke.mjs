import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is a disposable acceptance rehearsal, not #58's interactive provisioning.
// It never reads or mutates existing local state or contacts a remote provider.
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(serverRoot, '../..');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const api = 'http://localhost:8787';
const portal = 'http://localhost:5174';
const temporary = mkdtempSync(join(tmpdir(), 'tocyn-local-auth-'));
const state = join(temporary, 'state');
const configPath = join(temporary, 'wrangler.json');
const log = openSync(join(temporary, 'runtime.log'), 'w', 0o600);
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', VITE_API_URL: api };
for (const name of Object.keys(env)) {
  if (/^(CLOUDFLARE_|CF_API_|RESEND_)/.test(name)) delete env[name];
}
const children = new Set();
const started = Date.now();
let interrupted = false;
let cleanupPromise;

function cli(args) {
  if (interrupted) throw new Error('Local rehearsal interrupted');
  const result = spawnSync(process.execPath, [wrangler, ...args, '--config', configPath], {
    cwd: serverRoot, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Local Wrangler ${args.slice(0, 3).join(' ')} failed; no runtime output or credentials are emitted`);
  return result.stdout;
}

async function freePort(port) {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', accept);
  });
  await new Promise(accept => probe.close(accept));
}

function start(args, cwd = serverRoot) {
  if (interrupted) throw new Error('Local rehearsal interrupted');
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', log, log], detached: process.platform !== 'win32' });
  children.add(child);
  return child;
}

async function stop(child) {
  const running = () => child.pid && child.exitCode === null && child.signalCode === null;
  const signal = value => {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, value);
      else child.kill(value);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const waitExit = async () => {
    let timer;
    try {
      await Promise.race([once(child, 'exit'), new Promise(accept => { timer = setTimeout(accept, 1500); })]);
    } finally { clearTimeout(timer); }
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

function cleanup() {
  if (!cleanupPromise) cleanupPromise = (async () => {
    try {
      await Promise.allSettled([...children].map(stop));
    } finally {
      try { closeSync(log); }
      finally { rmSync(temporary, { recursive: true, force: true }); }
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

async function ready(origin, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Local rehearsal process exited before readiness');
    try {
      const response = await fetch(origin, { redirect: 'error', signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* Wait only for this newly started loopback process. */ }
    await new Promise(accept => setTimeout(accept, 200));
  }
  throw new Error('Local rehearsal process did not become ready');
}

function request(path, { method = 'GET', body, key, token, origin = api } = {}) {
  assert.ok(path.startsWith('/'));
  return fetch(`${api}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'X-Widget-Key': key } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function bytes(directory) {
  return readdirSync(directory).reduce((total, name) => {
    const path = join(directory, name);
    return total + (statSync(path).isDirectory() ? bytes(path) : statSync(path).size);
  }, 0);
}

try {
  await freePort(8787);
  await freePort(5174);
  const config = JSON.parse(readFileSync(join(serverRoot, 'wrangler.local.json'), 'utf8'));
  assert.equal(config.vars.ENVIRONMENT, 'local');
  assert.equal(config.vars.PORTAL_URL, portal);
  assert.ok(config.d1_databases.every(binding => binding.remote === false));
  assert.ok(config.r2_buckets.every(binding => binding.remote === false));
  config.main = join(serverRoot, 'src/local-index.ts');
  config.d1_databases[0].migrations_dir = join(serverRoot, 'migrations');
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(join(temporary, '.dev.vars'), `JWT_SECRET=${randomBytes(32).toString('hex')}\nAPP_MASTER_KEY=${randomBytes(32).toString('hex')}\nMFA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  cli(['d1', 'migrations', 'apply', 'tocyn-local', '--local', '--persist-to', state]);
  const fixture = join(temporary, 'fixture.sql');
  writeFileSync(fixture, `INSERT INTO tenant_config(tenant_id,key,value) VALUES
    ('local-smoke-a','widget.public_key','local-smoke-a-key'),
    ('local-smoke-b','widget.public_key','local-smoke-b-key'),
    ('local-smoke-a','TICKET_PREFIX','LOCAL-A'),
    ('local-smoke-b','TICKET_PREFIX','LOCAL-B');`);
  cli(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', state, '--file', fixture]);
  const before = bytes(state);
  const workerArgs = [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', state, '--config', configPath];
  let worker = start(workerArgs);
  const frontend = start([join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], join(root, 'apps/portal'));
  await Promise.all([ready(`${api}/health`, worker), ready(portal, frontend)]);

  const capturePage = await fetch(`${portal}/__local/auth-capture`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  assert.equal(capturePage.status, 200);
  assert.ok((await capturePage.text()).includes('<html'), 'Capture UI must be served by the portal');
  const apiPage = await request('/__local/auth-capture');
  assert.equal(apiPage.status, 404, 'API Worker must not serve the capture UI');

  for (const suffix of ['a', 'b']) {
    const result = await request('/api/v1/customer/config', { key: `local-smoke-${suffix}-key` });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).TICKET_PREFIX, `LOCAL-${suffix.toUpperCase()}`);
  }
  const authPath = '/api/v1/customer/auth/';
  const authRequest = await request(`${authPath}request`, { method: 'POST', key: 'local-smoke-a-key', body: { email: 'tocyn-auth-test@example.invalid', type: 'magic_link' }, origin: portal });
  assert.equal(authRequest.status, 200);
  assert.equal(authRequest.headers.get('access-control-allow-origin'), portal);
  const captured = await request('/__local/auth-capture/messages');
  assert.equal(captured.headers.get('cache-control'), 'no-store');
  const messages = await captured.json();
  assert.equal(messages.length, 1);
  assert.ok(typeof messages[0].loginLink === 'string', 'Capture must provide the actual portal verification link');
  const link = new URL(messages[0].loginLink);
  assert.equal(link.origin, portal);
  assert.equal(link.pathname, '/verify');
  const portalPage = await fetch(`${portal}/verify`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  assert.equal(portalPage.status, 200);
  assert.ok((await portalPage.text()).includes('<html'), 'Real portal verification route must serve the frontend');
  const plainToken = link.searchParams.get('token');
  assert.ok(plainToken && /^[0-9a-f]{64}$/.test(plainToken));
  const wrongTenant = await request(`${authPath}verify`, { method: 'POST', key: 'local-smoke-b-key', body: { token: plainToken } });
  assert.equal(wrongTenant.status, 401);
  const verified = await request(`${authPath}verify`, { method: 'POST', key: 'local-smoke-a-key', body: { token: plainToken } });
  assert.equal(verified.status, 200);
  const identity = await verified.json();
  assert.equal(identity.user.tenant_id, 'local-smoke-a');
  assert.ok(typeof identity.token === 'string' && identity.token.length > 100);
  const replay = await request(`${authPath}verify`, { method: 'POST', key: 'local-smoke-a-key', body: { token: plainToken } });
  assert.equal(replay.status, 401);
  const me = await request(`${authPath}me`, { token: identity.token });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.tenant_id, 'local-smoke-a');
  const wrongIdentity = await request(`${authPath}request`, { method: 'POST', key: 'local-smoke-b-key', body: { email: 'tocyn-auth-test@example.invalid', type: 'magic_link' } });
  assert.equal(wrongIdentity.status, 400);
  const hostileReset = await request('/__local/auth-capture/reset', { method: 'POST', origin: 'https://hostile.example.invalid' });
  assert.equal(hostileReset.status, 403);
  assert.equal((await (await request('/__local/auth-capture/messages')).json()).length, 1);
  assert.equal((await request('/__local/auth-capture/reset', { method: 'POST' })).status, 204);
  assert.equal((await (await request('/__local/auth-capture/messages')).json()).length, 0);
  const nextMessage = await request(`${authPath}request`, { method: 'POST', key: 'local-smoke-a-key', body: { email: 'tocyn-auth-test@example.invalid', type: 'magic_link' } });
  assert.equal(nextMessage.status, 200);
  assert.equal((await (await request('/__local/auth-capture/messages')).json()).length, 1);

  // Restart with the same temporary local storage: signed session and tenant state
  // survive, while capture is intentionally empty. No schema downgrade is claimed.
  await stop(worker);
  worker = start(workerArgs);
  await ready(`${api}/health`, worker);
  const recovered = await request(`${authPath}me`, { token: identity.token });
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).user.tenant_id, 'local-smoke-a');
  assert.equal((await (await request('/__local/auth-capture/messages')).json()).length, 0);
  const after = bytes(state);
  console.log(JSON.stringify({ result: 'passed', runtime: 'local-only', realAuthRoundTrip: true,
    wrongTenantAndReplayDenied: true, hostileResetDenied: true, localRestartRecovery: true,
    capturedMessages: 2, finalCaptureMessages: 0, stateBytesBefore: before, stateBytesAfter: after,
    elapsedMs: Date.now() - started, externalMail: 'disabled by local capture profile; no network counter claimed' }));
} catch (error) {
  console.error(`Local auth rehearsal failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
