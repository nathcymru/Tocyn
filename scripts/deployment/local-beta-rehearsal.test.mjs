import registry from './rehearsal-process-registry.cjs';
import { killIfPresent } from './fixtures/rehearsal-test-cleanup.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { receiptCommand, assertRehearsalPlatform, assertCleanRevision, buildParkArtifact, compareArtifactFiles, localEnvironment, pinnedFrontendEnvironment, RehearsalLifecycle, rehearsalPlan } from './local-beta-rehearsal.mjs';
import { FAILED_OUTPUT_LIMIT } from './rehearsal-failed-output.mjs';

import { pythonPtyAvailable, assertPythonPty } from './rehearsal-prerequisites.mjs';

const sha = 'a'.repeat(40);
const unsupportedPlatform = !['darwin', 'linux'].includes(process.platform);
const processFixture = fileURLToPath(new URL('./fixtures/rehearsal-process.mjs', import.meta.url));

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

test('owned child failure is redacted and cleanup terminates its process group', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-lifecycle-'));
  const receipt = { commands: [] };
  const lifecycle = new RehearsalLifecycle(directory, receipt);
  t.after(async () => { await lifecycle.cleanup(); });
  const failed = lifecycle.run(process.execPath, ['-e', 'process.exit(7)'], directory, { ...process.env, PRIVATE_SENTINEL: 'do-not-report' });
  await assert.rejects(failed, /local command failed/);
  assert.equal(JSON.stringify(receipt).includes('do-not-report'), false);
  assert.equal(JSON.stringify(receipt).includes(directory), false);
  assert.equal(JSON.stringify(receipt).includes(process.execPath), false);
  assert.equal(receipt.commands[0].exitCode, 7);
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

test('terminal Ctrl-C cleans an npm-owned nested fixture and preserves an unrelated process', { skip: unsupportedPlatform ? 'POSIX process ownership is unsupported on this host' : !pythonPtyAvailable() ? 'python3/pty unavailable; optional PTY execution skipped' : false }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-signal-'));
  const task = join(directory, 'task'); const fixture = join(directory, 'fixture'); const receiptPath = join(directory, 'receipt.json');
  let sentinel; let terminal;
  t.after(async () => {
    const registry = (await import('./rehearsal-process-registry.cjs')).default;
    const { readdirSync } = await import('node:fs');
    const records = existsSync(join(task, 'processes')) ? readdirSync(join(task, 'processes')).flatMap(name => registry.read(join(task, 'processes', name))) : [];
    for (const record of records) if (registry.snapshot().some(info => info.pid === record.pid && info.start === record.start && !info.zombie)) killIfPresent(record.pid);
    if (terminal?.exitCode === null) terminal.kill('SIGKILL');
    if (sentinel?.exitCode === null) sentinel.kill('SIGKILL');
    await waitFor(() => !registry.snapshot().some(info => !info.zombie && records.some(record => record.pid === info.pid && record.start === info.start)), 'test recovery termination');
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: { fixture: 'node fixture.mjs' } }));
  copyFileSync(processFixture, join(fixture, 'fixture.mjs'));
  sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  terminal = spawn('python3', ['-c', ptyBridge(), process.execPath, processFixture, 'controller', task, fixture, receiptPath], { env: { ...process.env, REHEARSAL_FIXTURE_MODE: 'npm-nested', GRANDCHILD_PID: join(task, 'grandchild.pid'), READY: join(task, 'ready') }, stdio: ['pipe', 'pipe', 'pipe'] });
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

test('leader exit retains ownership of detached and same-group children', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-leader-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  const pids = join(directory, 'pids.json');
  const service = lifecycle.startService(process.execPath, [processFixture, 'leader', pids], directory, process.env);
  assert.equal((await service.exited).code, 0);
  const children = JSON.parse(readFileSync(pids, 'utf8'));
  await lifecycle.stopService(service);
  for (const pid of children) await waitFor(() => !processAlive(pid), 'orphan child exit');
  assert.equal(existsSync(task), true, 'service stop preserves shared state');
  const second = lifecycle.startService(process.execPath, ['-e', 'setInterval(()=>{},1000)'], directory, process.env);
  await lifecycle.stopService(second);
  assert.equal(lifecycle.receipt.commands.filter(value => value.result === 'stopped').length, 2);
});

test('closing rejects a late detached spawn before it can escape ownership', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-late-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  const ready = join(directory, 'ready'); const result = join(directory, 'result');
  const service = lifecycle.startService(process.execPath, [processFixture, 'late', ready, result], directory, process.env);
  await waitFor(() => existsSync(ready), 'late-spawn fixture');
  await lifecycle.stopService(service);
  assert.equal(readFileSync(result, 'utf8'), 'rejected');
});

test('incomplete registration preserves task state and does not claim disposal', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-incomplete-'));
  const output = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-incomplete-output-'));
  const lifecycle = new RehearsalLifecycle(directory, { commands: [] }, { failedOutputDirectory: output, ownsFailedOutputDirectory: true });
  t.after(() => { rmSync(directory, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true }); });
  const handle = lifecycle.startService(process.execPath, ['-e', 'process.exit(0)'], directory, process.env);
  await handle.exited;
  const { readdirSync } = await import('node:fs');
  const scope = join(directory, 'processes', readdirSync(join(directory, 'processes'))[0]);
  writeFileSync(join(scope, 'failed'), 'synthetic registration failure', { mode: 0o600 });
  await assert.rejects(lifecycle.cleanup(), /registration incomplete/);
  assert.equal(existsSync(directory), true);
  assert.equal(readdirSync(output).length, 1);
});

test('outer ownership survives an inner lifecycle leader and loader environment changes', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-inner-'));
  const task = join(directory, 'task'); mkdirSync(task, { mode: 0o700 });
  const inner = join(task, 'inner'); mkdirSync(inner, { mode: 0o700 });
  const lifecycle = new RehearsalLifecycle(task, { commands: [] });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  const pids = join(directory, 'pids');
  const outer = lifecycle.startService(process.execPath, [processFixture, 'inner', inner, directory, pids], directory, process.env);
  await waitFor(() => existsSync(pids), 'inner detached child');
  const nested = Number(readFileSync(pids, 'utf8'));
  await lifecycle.stopService(outer);
  await waitFor(() => !processAlive(nested), 'outer-owned inner child exit');
});

test('a PID whose recorded start identity no longer matches is never signaled', { skip: unsupportedPlatform }, async t => {
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

test('the owned TypeScript loader preserves real fixture tests and releases its native children', { skip: unsupportedPlatform }, async t => {
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


test('the runner deliberately refuses unsupported platforms without mutating host identity', () => {
  for (const platform of ['darwin', 'linux']) assert.doesNotThrow(() => assertRehearsalPlatform(platform));
  for (const platform of ['win32', 'freebsd', 'unknown']) assert.throws(() => assertRehearsalPlatform(platform), /requires macOS or Linux/);
  if (unsupportedPlatform) assert.throws(() => assertRehearsalPlatform(), /requires macOS or Linux/);
});


test('receipts use known command labels and never serialize path or argument data', () => {
  assert.equal(receiptCommand('/private/user/runtime/node', ['/private/task/wrangler.js', 'dev', '--local', '--config', '/private/task/config.json']), 'wrangler dev local');
  assert.equal(receiptCommand('/private/user/runtime/node', ['-e', 'sensitive fixture code', '/private/task/value']), 'node fixture');
  assert.equal(receiptCommand('/private/user/npm', ['run', 'secret-value']), 'npm command');
});

test('missing Python is unavailable to optional tests and rejects explicit acceptance', () => {
  assert.equal(pythonPtyAvailable(''), false);
  assert.throws(() => assertPythonPty(''), /requires python3.*acceptance has not run/);
});


test('ownership directory errors are constant for relative and missing paths', () => {
  for (const directory of ['synthetic-private-relative', join(tmpdir(), 'synthetic-private-missing', 'ownership')]) {
    assert.throws(() => registry.checkDirectory(directory), error => {
      assert.equal(error.message, 'Invalid rehearsal ownership directory');
      assert.equal(error.message.includes(directory), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('teardown tolerates a process that exits after inspection but preserves other signal errors', { skip: unsupportedPlatform }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await once(child, 'exit');
  assert.doesNotThrow(() => killIfPresent(child.pid));
  const denied = Object.assign(new Error('synthetic denied signal'), { code: 'EPERM' });
  assert.throws(() => killIfPresent(child.pid, () => { throw denied; }), error => error === denied);
});


test('every rehearsal npm script exists in its workspace and direct tools are installed locally', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const plan = rehearsalPlan(sha, 'b'.repeat(40));
  for (const [command, ...args] of [...plan.acceptanceCommands, ...plan.artifactBuildCommands]) {
    assert.equal(command, 'npm');
    const workspace = args.find(value => value.startsWith('--workspace='))?.slice('--workspace='.length) || '.';
    const pkg = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'));
    if (args[0] === 'run') assert.equal(typeof pkg.scripts?.[args[1]], 'string', `Missing rehearsal script ${workspace}:${args[1]}`);
    else {
      assert.deepEqual(args, ['exec', '--offline', '--no', '--workspace=apps/server', '--', 'eslint', '.']);
      assert.equal(receiptCommand(command, args), 'server ESLint');
    }
  }
  for (const relative of [
    'node_modules/eslint/bin/eslint.js', 'node_modules/wrangler/bin/wrangler.js',
    'node_modules/tsx/dist/loader.mjs', 'scripts/deployment/isolated-release.mjs',
    'scripts/deployment/verify-release-artifact.mjs', 'scripts/deployment/local-beta-fallback-command.mjs',
    'apps/server/scripts/run-local-beta-operator.ts',
  ]) assert.ok(existsSync(join(root, relative)), `Missing local rehearsal tool ${relative}`);
});

test('both fresh artifact roots independently build their packaged frontend inputs', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-build-inputs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const lifecycle = { async run(command, args, cwd) {
    calls.push({ command, args, cwd });
    if (command === 'npm' && args[0] === 'run' && args[1] === 'build') {
      const workspace = args[2].slice('--workspace='.length);
      const dist = join(cwd, workspace, 'dist');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'index.html'), cwd);
    }
    if (args[0] === 'scripts/deployment/isolated-release.mjs' && args[1] === 'package') {
      for (const app of ['dashboard', 'portal']) assert.equal(readFileSync(join(cwd, 'apps', app, 'dist/index.html'), 'utf8'), cwd);
    }
  } };
  for (const label of ['candidate', 'comparison']) {
    const worktree = join(directory, label);
    mkdirSync(join(worktree, 'deployment'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('../../deployment/beta.json', import.meta.url)), join(worktree, 'deployment/beta.json'));
    await buildParkArtifact(worktree, sha, directory, label, lifecycle);
    assert.deepEqual(calls.filter(call => call.cwd === worktree && call.args[0] === 'run').map(call => call.args), [
      ['run', 'build', '--workspace=apps/dashboard'], ['run', 'build', '--workspace=apps/portal'],
    ]);
  }
  const plan = rehearsalPlan(sha, sha);
  assert.equal(plan.acceptanceCommands.filter(command => command.includes('--workspace=apps/widget') && command.includes('build')).length, 1);
  assert.equal(plan.acceptanceCommands.some(command => command.includes('build') && command.includes('--workspace=apps/dashboard')), false);
});

test('owned command output drains privately, retains only bounded failed tails and removes success buffers', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-output-'));
  const task = join(directory, 'task'); const output = join(directory, 'output');
  for (const path of [task, output]) mkdirSync(path, { mode: 0o700 });
  const receipt = { commands: [] };
  const lifecycle = new RehearsalLifecycle(task, receipt, { failedOutputDirectory: output, ownsFailedOutputDirectory: true });
  t.after(async () => { await lifecycle.cleanup(); rmSync(directory, { recursive: true, force: true }); });
  await lifecycle.run(process.execPath, [processFixture, 'output', '0', '1024'], directory, process.env);
  assert.deepEqual(readdirSync(output), []);
  await assert.rejects(lifecycle.run(process.execPath, [processFixture, 'output', '7', String(FAILED_OUTPUT_LIMIT * 3)], directory, process.env), /local command failed/);
  const [name] = readdirSync(output);
  assert.equal(readdirSync(output).length, 1);
  const bytes = readFileSync(join(output, name));
  const newline = bytes.indexOf(10);
  const metadata = JSON.parse(bytes.subarray(0, newline).toString());
  assert.equal(metadata.truncated, true);
  assert.equal(metadata.streams.stdout.capturedBytes, FAILED_OUTPUT_LIMIT / 2);
  assert.equal(metadata.streams.stderr.truncated, false);
  assert.ok(Object.values(metadata.streams).reduce((total, stream) => total + stream.capturedBytes, 0) <= FAILED_OUTPUT_LIMIT);
  assert.ok(bytes.length < FAILED_OUTPUT_LIMIT + 1024);
  assert.equal(bytes.subarray(newline + 1).includes(Buffer.from('synthetic-private-tail')), true);
  assert.equal(statSync(output).mode & 0o777, 0o700);
  assert.equal(statSync(join(output, name)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(receipt).includes(directory), false);
  assert.equal(JSON.stringify(receipt).includes('synthetic-private-tail'), false);
  assert.deepEqual(receipt.commands[1].diagnostics, { output: 'retained-private', truncated: true });
  await lifecycle.cleanup();
  assert.equal(existsSync(task), false);
  assert.equal(existsSync(join(output, name)), true);
});

test('successful lifecycle erases its private diagnostic directory and rejects symlink destinations', { skip: unsupportedPlatform }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-output-success-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const task = join(directory, 'task'); const output = join(directory, 'output');
  for (const path of [task, output]) mkdirSync(path, { mode: 0o700 });
  symlinkSync(output, join(directory, 'link'));
  assert.throws(() => new RehearsalLifecycle(task, { commands: [] }, { failedOutputDirectory: join(directory, 'link') }), /ownership directory/);
  const lifecycle = new RehearsalLifecycle(task, { commands: [] }, { failedOutputDirectory: output, ownsFailedOutputDirectory: true });
  t.after(() => lifecycle.cleanup());
  await lifecycle.run(process.execPath, [processFixture, 'output', '0'], directory, process.env);
  await lifecycle.cleanup();
  assert.equal(existsSync(output), false);
});
