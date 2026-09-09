import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import registry from './rehearsal-process-registry.cjs';
import { killIfPresent } from './fixtures/rehearsal-test-cleanup.mjs';
import { assertPythonPty } from './rehearsal-prerequisites.mjs';
import { localEnvironment } from './local-beta-rehearsal.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
async function waitFor(predicate, message, limit = 15000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(50); }
  assert.fail(message);
}
async function portFree() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(8787, '127.0.0.1', () => server.close(resolvePromise)); });
}
const bridge = `import os, pty, select, sys
pid, fd = pty.fork()
if pid == 0: os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
while True:
  ready, _, _ = select.select([fd, sys.stdin], [], [])
  if fd in ready:
    try: data = os.read(fd, 4096)
    except OSError: data = b''
    if not data: break
    os.write(sys.stdout.fileno(), data)
  if sys.stdin in ready:
    data = os.read(sys.stdin.fileno(), 4096)
    if data: os.write(fd, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))`;

test('actual nested local Wrangler stops through repeated npm/PTY interruption', { skip: process.env.TOCYN_REHEARSAL_WRANGLER_TEST !== '1', timeout: 40000 }, async t => {
  assert.ok(['darwin', 'linux'].includes(process.platform));
  assertPythonPty();
  await portFree();
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-wrangler-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  for (const name of ['tmp', 'config', 'cache']) mkdirSync(join(task, name), { mode: 0o700 });
  const fixture = join(directory, 'fixture'); mkdirSync(fixture, { mode: 0o700 });
  const failedOutput = join(directory, 'failed-output'); mkdirSync(failedOutput, { mode: 0o700 });
  const config = JSON.parse(readFileSync(join(root, 'apps/server/wrangler.local.json'), 'utf8'));
  config.main = join(root, 'apps/server/src/local-index.ts');
  config.d1_databases = config.d1_databases.map(binding => ({ ...binding, migrations_dir: join(root, 'apps/server/migrations') }));
  writeFileSync(join(task, 'wrangler.json'), JSON.stringify(config), { mode: 0o600 });
  const ready = join(task, 'ready'); const receiptPath = join(directory, 'receipt.json');
  const wranglerArgs = [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', join(task, 'state'), '--config', join(task, 'wrangler.json')];
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: { fixture: 'node fixture.mjs' } }), { mode: 0o600 });
  const processFixture = fileURLToPath(new URL('./fixtures/rehearsal-process.mjs', import.meta.url));
  copyFileSync(processFixture, join(fixture, 'fixture.mjs'));
  let owned = []; let terminal; let sentinel;
  t.after(async () => {
    // Test failure recovery is restricted to recorded identities, never arbitrary port owners.
    if (existsSync(join(task, 'processes'))) {
      for (const name of readdirSync(join(task, 'processes'))) owned.push(...registry.read(join(task, 'processes', name)));
    }
    if (terminal?.exitCode === null) {
      terminal.stdin.write('\x03');
      for (let attempt = 0; attempt < 60 && terminal.exitCode === null; attempt += 1) await delay(100);
    }
    for (const record of owned) if (registry.snapshot().some(info => info.pid === record.pid && info.start === record.start && !info.zombie)) killIfPresent(record.pid);
    if (terminal?.exitCode === null) terminal.kill('SIGKILL');
    if (sentinel?.exitCode === null) sentinel.kill('SIGKILL');
    await waitFor(() => !registry.snapshot().some(info => !info.zombie && owned.some(record => record.pid === info.pid && record.start === info.start)), 'test recovery stops owned processes');
    rmSync(directory, { recursive: true, force: true });
  });
  sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  terminal = spawn('python3', ['-c', bridge, process.execPath, processFixture, 'controller', task, fixture, receiptPath], { env: { ...localEnvironment(process.env, task), REHEARSAL_FIXTURE_MODE: 'wrangler', WRANGLER_ARGS: JSON.stringify(wranglerArgs), READY: ready, REHEARSAL_FAILED_OUTPUT_DIRECTORY: failedOutput }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; terminal.stdout.on('data', chunk => { output += chunk; }); terminal.stderr.on('data', chunk => { output += chunk; });
  await waitFor(() => existsSync(ready), 'actual local Wrangler readiness');
  for (const name of readdirSync(join(task, 'processes'))) owned.push(...registry.read(join(task, 'processes', name)));
  const active = registry.snapshot().filter(info => owned.some(record => record.pid === info.pid && record.start === info.start));
  const executables = execFileSync('/bin/ps', ['-p', active.map(info => info.pid).join(','), '-o', 'comm='], { encoding: 'utf8' });
  assert.match(executables, /workerd/, 'the registered tree includes the actual local Worker engine');
  const exited = once(terminal, 'exit'); terminal.stdin.write('\x03'); await delay(15); terminal.stdin.write('\x03');
  const [code] = await exited;
  assert.equal(code, 130, output);
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).cleanup, 'disposed');
  assert.equal(existsSync(task), false);
  assert.equal(readdirSync(failedOutput).length, 1, 'interrupted command retains one bounded private diagnostic');
  await waitFor(() => !registry.snapshot().some(info => !info.zombie && owned.some(record => record.pid === info.pid && record.start === info.start)), 'all observed Wrangler descendants stopped');
  await portFree();
  assert.equal(sentinel.exitCode, null);
  process.kill(sentinel.pid, 0);
  t.diagnostic(JSON.stringify({ interruption: 'completed', localHealth: 200, registeredProcesses: owned.length, cleanup: 'disposed', loopbackPortReleased: true, unrelatedProcessPreserved: true, privateInterruptedOutput: 'retained-and-test-disposed' }));
});
