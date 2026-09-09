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
  assert.ok(plan.acceptanceCommands.some(command => command.includes('test:local-portal-workflow')));
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
  let sentinel;
  t.after(() => {
    if (sentinel?.exitCode === null) sentinel.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, scripts: { fixture: 'node fixture.mjs' } }));
  writeFileSync(join(fixture, 'fixture.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const nested = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); nested.unref(); writeFileSync(process.env.GRANDCHILD_PID, String(nested.pid)); const stop = () => { try { process.kill(-nested.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } setTimeout(() => process.exit(0), 25); }; process.on('SIGINT', stop); process.on('SIGTERM', stop); writeFileSync(process.env.READY, 'ready'); setInterval(() => {}, 1000);`);
  const program = `import { mkdirSync } from 'node:fs'; import { RehearsalLifecycle, installSignalCleanup } from ${JSON.stringify(moduleUrl)}; const task=process.env.TASK; mkdirSync(task); const receipt={commands:[],cleanup:'pending'}; const lifecycle=new RehearsalLifecycle(task,receipt); installSignalCleanup(lifecycle,receipt,process.env.RECEIPT); void lifecycle.run('npm',['run','fixture'],process.env.FIXTURE,{ ...process.env, GRANDCHILD_PID: process.env.GRANDCHILD_PID, READY: process.env.READY });`;
  sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const terminal = spawn('python3', ['-c', ptyBridge(), process.execPath, '--input-type=module', '-e', program], { env: { ...process.env, TASK: task, RECEIPT: receiptPath, FIXTURE: fixture, GRANDCHILD_PID: join(task, 'grandchild.pid'), READY: join(task, 'ready') }, stdio: ['pipe', 'pipe', 'pipe'] });
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
