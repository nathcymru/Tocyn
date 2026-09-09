import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('task environment removes provider credentials without repurposing HOME', () => {
  const taskRoot = join(tmpdir(), 'tocyn-rehearsal-env');
  const env = localEnvironment({ HOME: '/keep-home', CLOUDFLARE_API_TOKEN: 'secret', CF_API_TOKEN: 'secret', RESEND_API_KEY: 'secret', TOCYN_ACCESS_CLIENT_ID: 'secret', TOCYN_D1_DATABASE_ID: 'unsafe', PATH: process.env.PATH }, taskRoot);
  assert.equal(env.HOME, '/keep-home');
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'RESEND_API_KEY', 'TOCYN_ACCESS_CLIENT_ID', 'TOCYN_D1_DATABASE_ID']) assert.equal(env[name], undefined);
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
  assert.equal(env.XDG_CONFIG_HOME, join(taskRoot, 'config'));
  assert.equal(env.XDG_CACHE_HOME, join(taskRoot, 'cache'));
  assert.equal(env.TMPDIR, join(taskRoot, 'tmp'));
  const unpinned = localEnvironment({ VITE_API_URL: 'https://inherited.invalid', VITE_WIDGET_KEY: 'sentinel-do-not-package', PATH: process.env.PATH }, taskRoot);
  assert.equal(unpinned.VITE_API_URL, undefined); assert.equal(unpinned.VITE_WIDGET_KEY, undefined);
  const frontend = pinnedFrontendEnvironment(unpinned);
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

test('repeated Ctrl-C removes only the runner-owned process tree and state', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-rehearsal-signal-'));
  const task = join(directory, 'task'); const receiptPath = join(directory, 'receipt.json');
  const moduleUrl = pathToFileURL(fileURLToPath(new URL('./local-beta-rehearsal.mjs', import.meta.url))).href;
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const program = `import { mkdirSync, writeFileSync } from 'node:fs'; import { RehearsalLifecycle, installSignalCleanup } from ${JSON.stringify(moduleUrl)}; const task=process.env.TASK; mkdirSync(task); const receipt={commands:[],cleanup:'pending'}; const lifecycle=new RehearsalLifecycle(task,receipt); installSignalCleanup(lifecycle,receipt,process.env.RECEIPT); void lifecycle.run(process.execPath,['-e','setInterval(() => {}, 1000)'],task,process.env); process.stdout.write('ready\\n');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, TASK: task, RECEIPT: receiptPath }, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 50 && !output.includes('ready'); attempt++) await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  assert.match(output, /ready/);
  const exited = once(child, 'exit');
  child.kill('SIGINT'); await new Promise(resolvePromise => setTimeout(resolvePromise, 10)); child.kill('SIGINT');
  const [code] = await exited;
  assert.equal(code, 130);
  assert.equal(existsSync(task), false);
  const receipt = JSON.parse(await (await import('node:fs/promises')).readFile(receiptPath, 'utf8'));
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
