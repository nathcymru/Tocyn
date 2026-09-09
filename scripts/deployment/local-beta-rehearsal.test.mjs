import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCleanRevision, compareArtifactFiles, localEnvironment, pinnedFrontendEnvironment, RehearsalLifecycle, rehearsalPlan } from './local-beta-rehearsal.mjs';

const sha = 'a'.repeat(40);

test('local-only rehearsal plan retains the protected-operation boundary', () => {
  const plan = rehearsalPlan(sha, 'b'.repeat(40));
  assert.equal(plan.mode, 'local-only-park');
  for (const required of ['test:local-portal-workflow', 'typecheck:operator-workflow', 'test:operator-workflow', 'test:tenant-isolation-core', 'test:tenant-isolation-storage-background']) assert.ok(plan.acceptanceCommands.some(command => command.includes(required)));
  for (const forbidden of ['--remote', 'finalize', 'verify-provider-resources', 'verify-rollback', 'publish-pages']) assert.ok(plan.forbidden.includes(forbidden));
  assert.match(plan.fallback, /nonempty compatible synthetic conversation state/);
});

test('CLI rejects a remote selector instead of silently ignoring it', () => {
  const runner = fileURLToPath(new URL('./local-beta-rehearsal.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [runner, 'plan', '--revision', sha, '--known-good', sha, '--remote', 'true'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local-only allowlist/);
});

test('task environment uses a minimal allowlist without repurposing HOME', () => {
  const taskRoot = join(tmpdir(), 'tocyn-rehearsal-env');
  const env = localEnvironment({ HOME: '/keep-home', PATH: process.env.PATH, LANG: 'en_GB.UTF-8', CLOUDFLARE_API_TOKEN: 'secret', OPENAI_API_KEY: 'secret', CUSTOM_DEPLOY_KEY: 'secret', VITE_API_URL: 'https://inherited.invalid', VITE_WIDGET_KEY: 'sentinel-do-not-package', TOCYN_D1_DATABASE_ID: 'unsafe' }, taskRoot);
  assert.equal(env.HOME, '/keep-home');
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.LANG, 'en_GB.UTF-8');
  for (const name of ['CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY', 'CUSTOM_DEPLOY_KEY', 'VITE_API_URL', 'VITE_WIDGET_KEY', 'TOCYN_D1_DATABASE_ID']) assert.equal(env[name], undefined);
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
  assert.equal(env.XDG_CONFIG_HOME, join(taskRoot, 'config'));
  assert.equal(env.XDG_CACHE_HOME, join(taskRoot, 'cache'));
  assert.equal(env.TMPDIR, join(taskRoot, 'tmp'));
  const frontend = pinnedFrontendEnvironment(env);
  assert.equal(frontend.VITE_API_URL, 'https://api.beta.local.invalid');
  assert.equal(frontend.VITE_WIDGET_KEY, 'local-rehearsal-widget-key');
  assert.equal(JSON.stringify(frontend).includes('sentinel-do-not-package'), false);
});

test('clean revision check rejects a modified checkout', t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-git-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = args => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(git(['init', '-b', 'main']).status, 0);
  writeFileSync(join(directory, 'tracked.txt'), 'clean\n');
  assert.equal(git(['add', 'tracked.txt']).status, 0);
  assert.equal(git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture']).status, 0);
  const revision = git(['rev-parse', 'HEAD']).stdout.trim();
  assert.doesNotThrow(() => assertCleanRevision(directory, revision));
  writeFileSync(join(directory, 'tracked.txt'), 'changed\n');
  assert.throws(() => assertCleanRevision(directory, revision), /not clean/);
});

test('owned child failure is redacted and cleanup terminates its process group', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-lifecycle-'));
  const receipt = { commands: [] };
  const lifecycle = new RehearsalLifecycle(directory, receipt);
  t.after(async () => { await lifecycle.cleanup(); });
  const failed = lifecycle.run(process.execPath, ['-e', 'process.exit(7)'], directory, { ...process.env, PRIVATE_SENTINEL: 'do-not-report' });
  await assert.rejects(failed, /local command failed/);
  assert.equal(JSON.stringify(receipt).includes('do-not-report'), false);
  const running = lifecycle.run(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], directory, process.env);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 30));
  await lifecycle.cleanup();
  await assert.rejects(running, /local command failed/);
  assert.equal(existsSync(directory), false);
});

function ptyBridge() {
  return `import os, pty, select, signal, sys
pid, fd = pty.fork()
if pid == 0:
  os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
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
if os.WIFEXITED(status): sys.exit(os.WEXITSTATUS(status))
if os.WIFSIGNALED(status): sys.exit(128 + os.WTERMSIG(status))`;
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20));
  }
  assert.fail(`timed out waiting for ${description}`);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

test('terminal Ctrl-C cleans an npm-owned nested fixture and preserves an unrelated process', { skip: process.platform === 'win32' }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-signal-'));
  const task = join(directory, 'task'); const fixture = join(directory, 'fixture'); const receiptPath = join(directory, 'receipt.json');
  const moduleUrl = pathToFileURL(fileURLToPath(new URL('./local-beta-rehearsal.mjs', import.meta.url))).href;
  let sentinel; let terminal;
  t.after(async () => {
    const registry = (await import('./rehearsal-process-registry.cjs')).default;
    const { readdirSync } = await import('node:fs');
    const records = existsSync(join(task, 'processes')) ? readdirSync(join(task, 'processes')).flatMap(name => registry.read(join(task, 'processes', name))) : [];
    for (const record of records) if (registry.snapshot().some(info => info.pid === record.pid && info.start === record.start && !info.zombie)) process.kill(record.pid, 'SIGKILL');
    if (terminal?.exitCode === null) terminal.kill('SIGKILL');
    if (sentinel?.exitCode === null) sentinel.kill('SIGKILL');
    await waitFor(() => !registry.snapshot().some(info => !info.zombie && records.some(record => record.pid === info.pid && record.start === info.start)), 'test recovery termination');
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: { fixture: 'node fixture.mjs' } }));
  writeFileSync(join(fixture, 'fixture.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const nested = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); nested.unref(); writeFileSync(process.env.GRANDCHILD_PID, String(nested.pid)); process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); writeFileSync(process.env.READY, 'ready'); setInterval(() => {}, 1000);`);
  const program = `import { mkdirSync } from 'node:fs'; import { RehearsalLifecycle, installSignalCleanup } from ${JSON.stringify(moduleUrl)}; const task=process.env.TASK; mkdirSync(task,{mode:0o700}); const receipt={commands:[],cleanup:'pending'}; const lifecycle=new RehearsalLifecycle(task,receipt); installSignalCleanup(lifecycle,receipt,process.env.RECEIPT); void lifecycle.run('npm',['run','fixture'],process.env.FIXTURE,{ ...process.env, GRANDCHILD_PID: process.env.GRANDCHILD_PID, READY: process.env.READY }).catch(() => {});`;
  sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  terminal = spawn('python3', ['-c', ptyBridge(), process.execPath, '--input-type=module', '-e', program], { env: { ...process.env, TASK: task, RECEIPT: receiptPath, FIXTURE: fixture, GRANDCHILD_PID: join(task, 'grandchild.pid'), READY: join(task, 'ready') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; terminal.stdout.on('data', chunk => { output += chunk; });
  await waitFor(() => existsSync(join(task, 'ready')), 'nested fixture readiness');
  const grandchildPid = Number(readFileSync(join(task, 'grandchild.pid'), 'utf8'));
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 1);
  const exited = once(terminal, 'exit');
  terminal.stdin.write('\x03');
  await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  terminal.stdin.write('\x03');
  const [code] = await exited;
  assert.equal(code, 130, output);
  await waitFor(() => !processAlive(grandchildPid), 'owned nested fixture termination');
  assert.equal(existsSync(task), false);
  assert.equal(processAlive(sentinel.pid), true);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.deepEqual({ interrupted: receipt.interrupted, cleanup: receipt.cleanup }, { interrupted: 'SIGINT', cleanup: 'disposed' });
});

test('artifact comparison requires byte-identical manifests and contents', t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-artifact-'));
  const first = join(directory, 'first'); const second = join(directory, 'second');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const target of [first, second]) { mkdirSync(join(target, 'worker'), { recursive: true }); writeFileSync(join(target, 'worker/index.js'), 'export default {}\n'); }
  assert.deepEqual(compareArtifactFiles(first, second), { files: 1, bytes: 18 });
  writeFileSync(join(second, 'worker/index.js'), 'export default { changed: true }\n');
  assert.throws(() => compareArtifactFiles(first, second), /park artifact differs/);
  writeFileSync(join(second, 'extra.txt'), 'extra\n');
  assert.throws(() => compareArtifactFiles(first, second), /same file manifest/);
});

test('leader exit retains ownership of detached and same-group children', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-leader-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  const pids = join(directory, 'pids.json');
  const program = `const {spawn}=require('node:child_process'); const children=[false,true].map(detached=>{const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached,stdio:'ignore',env:{PATH:process.env.PATH}});p.unref();return p.pid});require('node:fs').writeFileSync(${JSON.stringify(pids)},JSON.stringify(children));process.exit(0)`;
  const service = lifecycle.startService(process.execPath, ['-e', program], directory, process.env);
  assert.equal((await service.exited).code, 0);
  const children = JSON.parse(readFileSync(pids, 'utf8'));
  await lifecycle.stopService(service);
  for (const pid of children) await waitFor(() => !processAlive(pid), 'orphan child exit');
  assert.equal(existsSync(task), true, 'service stop preserves shared state');
  const second = lifecycle.startService(process.execPath, ['-e', 'setInterval(()=>{},1000)'], directory, process.env);
  await lifecycle.stopService(second);
  assert.equal(lifecycle.receipt.commands.filter(value => value.result === 'stopped').length, 2);
});

test('closing rejects a late detached spawn before it can escape ownership', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-late-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  const ready = join(directory, 'ready'); const result = join(directory, 'result');
  const program = `const {spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{try{spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(result)},'escaped')}catch{fs.writeFileSync(${JSON.stringify(result)},'rejected')}process.exit(0)});fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
  const service = lifecycle.startService(process.execPath, ['-e', program], directory, process.env);
  await waitFor(() => existsSync(ready), 'late-spawn fixture');
  await lifecycle.stopService(service);
  assert.equal(readFileSync(result, 'utf8'), 'rejected');
});

test('incomplete registration preserves task state and does not claim disposal', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-incomplete-'));
  const lifecycle = new RehearsalLifecycle(directory, { commands: [] });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const handle = lifecycle.startService(process.execPath, ['-e', 'process.exit(0)'], directory, process.env);
  await handle.exited;
  const { readdirSync } = await import('node:fs');
  const scope = join(directory, 'processes', readdirSync(join(directory, 'processes'))[0]);
  writeFileSync(join(scope, 'failed'), 'synthetic registration failure', { mode: 0o600 });
  await assert.rejects(lifecycle.cleanup(), /registration incomplete/);
  assert.equal(existsSync(directory), true);
});

test('outer ownership survives an inner lifecycle leader and loader environment changes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-inner-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  const inner = join(task, 'inner'); mkdirSync(inner, { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  const pids = join(directory, 'pids');
  const moduleUrl = new URL('./local-beta-rehearsal.mjs', import.meta.url).href;
  const childProgram = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',env:{PATH:process.env.PATH,NODE_OPTIONS:'--no-warnings'}});child.unref();require('node:fs').writeFileSync(${JSON.stringify(pids)},String(child.pid));setInterval(()=>{},1000)`;
  const program = `import {RehearsalLifecycle} from ${JSON.stringify(moduleUrl)};const inner=new RehearsalLifecycle(${JSON.stringify(inner)},{commands:[]});inner.startService(process.execPath,['-e',${JSON.stringify(childProgram)}],${JSON.stringify(directory)},process.env);process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const outer = lifecycle.startService(process.execPath, ['--input-type=module', '-e', program], directory, process.env);
  await waitFor(() => existsSync(pids), 'inner detached child');
  const nested = Number(readFileSync(pids, 'utf8'));
  await lifecycle.stopService(outer);
  await waitFor(() => !processAlive(nested), 'outer-owned inner child exit');
});

test('a PID whose recorded start identity no longer matches is never signaled', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-identity-'));
  const lifecycle = new RehearsalLifecycle(directory, { commands: [] });
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(async () => { sentinel.kill('SIGKILL'); await lifecycle.cleanup(); });
  const service = lifecycle.startService(process.execPath, ['-e', 'process.exit(0)'], directory, process.env);
  await service.exited;
  const registry = (await import('./rehearsal-process-registry.cjs')).default;
  const { readdirSync } = await import('node:fs');
  const scope = join(directory, 'processes', readdirSync(join(directory, 'processes'))[0]);
  registry.record(scope, { ...registry.snapshot().find(info => info.pid === sentinel.pid), start: 'synthetic-former-process-start' });
  await lifecycle.cleanup();
  assert.equal(processAlive(sentinel.pid), true);
});

test('the owned TypeScript loader preserves real fixture tests and releases its native children', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-loader-'));
  for (const name of ['tmp', 'config', 'cache']) mkdirSync(join(directory, name), { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(directory, { commands: [] });
  t.after(() => lifecycle.cleanup());
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await lifecycle.run(process.execPath, ['--import', 'tsx', '--test', 'scripts/deployment/local-beta-same-state-runtime.test.ts'], root, localEnvironment(process.env, directory));
  assert.equal(lifecycle.receipt.commands[0].result, 'passed');
  const registry = (await import('./rehearsal-process-registry.cjs')).default;
  const { readdirSync } = await import('node:fs');
  const records = readdirSync(join(directory, 'processes')).flatMap(name => registry.read(join(directory, 'processes', name)));
  assert.ok(records.length >= 2, 'loader/test child processes must be registered');
  assert.equal(registry.snapshot().some(info => !info.zombie && records.some(record => record.pid === info.pid && record.start === info.start)), false);
});
