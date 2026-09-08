import assert from 'node:assert/strict';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createLocalFixtureBootstrap } from './local-tenant-fixture';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(serverRoot, '../..');
const wrangler = join(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js');
const apiOrigin = 'http://localhost:8787';
let temporary: string | undefined;
let state: string | undefined;
let configPath: string | undefined;
let workerLog: number | undefined;
let child: ChildProcess | undefined;
let cleanupPromise: Promise<void> | undefined;

function localSecret(): string {
  return randomBytes(32).toString('hex');
}

function interactiveAllowed(): boolean {
  return process.argv.slice(2).join(' ') === '--interactive-credentials'
    && process.stdin.isTTY === true
    && process.stdout.isTTY === true
    && process.stderr.isTTY === true
    && process.env.CI === undefined;
}

function localEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  for (const name of Object.keys(env)) {
    if (/^(CLOUDFLARE_|CF_API_|RESEND_)/.test(name)) delete env[name];
  }
  return env;
}

async function stopWorker(): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const running = () => !!child?.pid && child.exitCode === null && child.signalCode === null;
  const signal = (value: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32') process.kill(-child!.pid!, value);
      else child!.kill(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const wait = async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([once(child!, 'exit'), new Promise<void>(resolve => { timer = setTimeout(resolve, 1_500); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  signal('SIGTERM');
  if (running()) await wait();
  if (running()) {
    signal('SIGKILL');
    if (running()) await wait();
  }
}

async function cleanup(): Promise<void> {
  if (!cleanupPromise) cleanupPromise = (async () => {
    try {
      await stopWorker();
    } finally {
      if (workerLog !== undefined) {
        try { closeSync(workerLog); } catch { /* Already closed. */ }
        workerLog = undefined;
      }
      if (temporary) rmSync(temporary, { recursive: true, force: true });
    }
  })();
  return cleanupPromise;
}

async function freeLoopbackPort(): Promise<void> {
  const probe = createServer();
  await new Promise<void>((accept, reject) => {
    probe.once('error', reject);
    probe.listen(8787, '127.0.0.1', accept);
  });
  await new Promise<void>(accept => probe.close(() => accept()));
}

function localWrangler(args: string[]): void {
  if (!temporary || !configPath) throw new Error('Local fixture state is not initialized');
  const result = spawnSync(process.execPath, [wrangler, ...args, '--config', configPath], {
    cwd: temporary, env: localEnvironment(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('A local Wrangler setup command failed; fixture state was removed without showing setup output');
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child?.exitCode !== null) throw new Error('Local Worker stopped before becoming ready');
    try {
      const response = await fetch(`${apiOrigin}/health`, { redirect: 'error', signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch { /* Only wait for this run-owned loopback Worker. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Local Worker did not become ready');
}

async function main(): Promise<void> {
  if (!interactiveAllowed()) {
    throw new Error('Refusing to reveal synthetic credentials: use exactly --interactive-credentials from an interactive non-CI terminal');
  }
  temporary = mkdtempSync(join(tmpdir(), 'tocyn-local-tenants-'));
  state = join(temporary, 'state');
  configPath = join(temporary, 'wrangler.json');
  await freeLoopbackPort();
  const config = JSON.parse(readFileSync(join(serverRoot, 'wrangler.local.json'), 'utf8'));
  assert.equal(config.vars?.ENVIRONMENT, 'local');
  assert.ok(config.d1_databases?.every((binding: { remote?: boolean }) => binding.remote === false));
  assert.ok(config.r2_buckets?.every((binding: { remote?: boolean }) => binding.remote === false));
  config.main = join(serverRoot, 'src/local-index.ts');
  config.d1_databases[0].migrations_dir = join(serverRoot, 'migrations');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });

  const secrets = { JWT_SECRET: localSecret(), APP_MASTER_KEY: localSecret(), MFA_ENCRYPTION_KEY: localSecret() };
  writeFileSync(join(temporary, '.dev.vars'), Object.entries(secrets).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  localWrangler(['d1', 'migrations', 'apply', 'tocyn-local', '--local', '--persist-to', state]);
  const bootstrap = await createLocalFixtureBootstrap(secrets);
  const fixtureSql = join(temporary, 'fixture.sql');
  writeFileSync(fixtureSql, bootstrap.sql, { mode: 0o600 });
  localWrangler(['d1', 'execute', 'tocyn-local', '--local', '--persist-to', state, '--file', fixtureSql]);
  rmSync(fixtureSql, { force: true });

  workerLog = openSync(join(temporary, 'runtime.log'), 'w', 0o600);
  child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', state, '--config', configPath], {
    cwd: temporary, env: localEnvironment(), stdio: ['ignore', workerLog, workerLog], detached: process.platform !== 'win32',
  });
  await waitForHealth();
  process.stdout.write('\nSynthetic local fixture is ready at http://localhost:8787 (bound to 127.0.0.1).\n');
  process.stdout.write('Passwords and operator enrollment URIs appear once below. They are synthetic, terminal-only values; no API key is printed.\n\n');
  for (const credential of bootstrap.credentials) {
    process.stdout.write(`Email: ${credential.email}\nPassword: ${credential.password}\n`);
    if (credential.portalLoginUrl) process.stdout.write(`Portal login URL: ${credential.portalLoginUrl}\n`);
    if (credential.provisioningUri) process.stdout.write(`Operator TOTP enrollment URI: ${credential.provisioningUri}\n`);
    process.stdout.write('\n');
  }
  process.stdout.write('Use the existing API/portal/dashboard routes. Stop this command to erase its run-owned state.\n');
  await once(child, 'exit');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

void main().catch(error => {
  console.error(`Local tenant fixture did not start: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}).finally(cleanup);
