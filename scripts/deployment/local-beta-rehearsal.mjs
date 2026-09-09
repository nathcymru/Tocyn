import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import registry from './rehearsal-process-registry.cjs';
import { assertPythonPty } from './rehearsal-prerequisites.mjs';
import { FailedCommandOutput } from './rehearsal-failed-output.mjs';
import { createServer } from 'node:net';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactFiles, digest, verifyReleaseArtifact } from './verify-release-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const inheritedEnvironment = new Set(['HOME', 'PATH', 'LANG', 'TERM', 'USER', 'LOGNAME', 'SHELL', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']);
const requiredAcceptanceCommands = [
  ['npm', ['run', 'typecheck', '--workspace=apps/server']],
  ['npm', ['exec', '--offline', '--no', '--workspace=apps/server', '--', 'eslint', '.']],
  ['npm', ['run', 'typecheck:local-tenants', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:local-beta', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:local-portal-workflow', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:operator-workflow', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:tenant-isolation-core', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:tenant-isolation-storage-background', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-auth', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-portal-workflow', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-tenants', '--workspace=apps/server']],
  ['npm', ['run', 'test:operator-workflow', '--workspace=apps/server']],
  ['npm', ['run', 'test:tenant-isolation-core', '--workspace=apps/server']],
  ['npm', ['run', 'test:tenant-isolation-storage-background', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-tenant-realtime', '--workspace=apps/server']],
  ['npm', ['run', 'test:canonical-conversation-atomic', '--workspace=apps/server']],
  ['npm', ['run', 'test:ticket-mutation-replay', '--workspace=apps/server']],
  ['npm', ['run', 'test:conversation-audit', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-beta', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-beta-runtime', '--workspace=apps/server']],
  ['npm', ['run', 'lint', '--workspace=apps/portal']],
  ['npm', ['run', 'build', '--workspace=apps/widget']],
];
const artifactBuildCommands = [
  ['npm', ['run', 'build', '--workspace=apps/dashboard']],
  ['npm', ['run', 'build', '--workspace=apps/portal']],
];

function fail(message) { throw new Error(`Local beta rehearsal rejected: ${message}`); }
export function assertRehearsalPlatform(platform = process.platform) {
  if (!['darwin', 'linux'].includes(platform)) fail('local rehearsal process ownership requires macOS or Linux');
}
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

export function localEnvironment(base, taskRoot) {
  if (!isAbsolute(taskRoot)) fail('task root must be absolute');
  const env = {};
  for (const [name, value] of Object.entries(base)) if (inheritedEnvironment.has(name) || name.startsWith('LC_')) env[name] = value;
  return { ...env, WRANGLER_SEND_METRICS: 'false', TMPDIR: join(taskRoot, 'tmp'), XDG_CONFIG_HOME: join(taskRoot, 'config'), XDG_CACHE_HOME: join(taskRoot, 'cache'), TZ: 'UTC' };
}

export function pinnedFrontendEnvironment(env) {
  return { ...env, VITE_API_URL: 'https://api.beta.local.invalid', VITE_WIDGET_KEY: 'local-rehearsal-widget-key' };
}

export function assertCleanRevision(source, revision) {
  if (!/^[0-9a-f]{40}$/i.test(revision || '')) fail('revision must be a full immutable SHA');
  try { git(source, ['cat-file', '-e', `${revision}^{commit}`]); } catch { fail('declared revision is not a local commit'); }
  if (git(source, ['rev-parse', 'HEAD']) !== revision) fail('checked-out HEAD does not match the declared revision');
  if (git(source, ['status', '--porcelain', '--untracked-files=all'])) fail('source checkout is not clean');
}

export function compareArtifactFiles(first, second) {
  const left = artifactFiles(first); const right = artifactFiles(second);
  if (JSON.stringify(left) !== JSON.stringify(right)) fail('park artifacts do not contain the same file manifest');
  for (const name of left) {
    const leftDigest = digest(readFileSync(join(first, name)));
    const rightDigest = digest(readFileSync(join(second, name)));
    if (leftDigest !== rightDigest) fail(`park artifact differs at ${name}`);
  }
  return { files: left.length, bytes: left.reduce((size, name) => size + statSync(join(first, name)).size, 0) };
}

export function rehearsalPlan(revision, knownGoodRevision) {
  if (!/^[0-9a-f]{40}$/i.test(revision || '') || !/^[0-9a-f]{40}$/i.test(knownGoodRevision || '')) fail('candidate and known-good revisions must be full immutable SHAs');
  return Object.freeze({
    mode: 'local-only-park', candidate: revision, knownGood: knownGoodRevision,
    acceptanceCommands: requiredAcceptanceCommands.map(([command, args]) => [command, ...args]),
    artifactBuildCommands: artifactBuildCommands.map(([command, args]) => [command, ...args]),
    artifactCommands: ['prepare', 'wrangler-dry-run', 'package', 'verify-release-artifact', 'wrangler-no-bundle-dry-run'],
    forbidden: ['--remote', 'finalize', 'verify-provider-resources', 'verify-rollback', 'publish-pages', 'provider credentials'],
    fallback: 'Start candidate and known-good local fixtures only with the same nonempty compatible synthetic conversation state; stop and report incompatible schemas rather than treating a fresh empty state as rollback.',
  });
}

async function portFree(port) {
  const probe = createServer();
  return new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolvePromise()));
  });
}

const preload = fileURLToPath(new URL('./rehearsal-process-preload.cjs', import.meta.url));
const delay = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

// Receipt labels contain only known step names, never argv, paths, fixture code or values.
export function receiptCommand(command, args) {
  const executable = basename(command);
  if (executable === 'npm' || executable === 'npm.cmd') {
    const scripts = new Set(requiredAcceptanceCommands.filter(([tool, argv]) => tool === 'npm' && argv[0] === 'run').map(([, argv]) => argv[1]));
    if (args[0] === 'run' && scripts.has(args[1])) return `npm run ${args[1]}`;
    if (JSON.stringify(args) === JSON.stringify(['exec', '--offline', '--no', '--workspace=apps/server', '--', 'eslint', '.'])) return 'server ESLint';
    if (args[0] === 'ci') return 'npm ci';
    if (args[0] === 'rebuild' && args[1] === 'better-sqlite3') return 'npm rebuild better-sqlite3';
    return 'npm command';
  }
  if (executable === 'git' && args[0] === 'worktree' && args[1] === 'add') return 'git worktree add';
  if (executable === 'node' || executable === 'node.exe') {
    if (args.some(value => basename(value) === 'wrangler.js')) {
      if (args.includes('deploy') && args.includes('--dry-run')) return 'wrangler deploy dry-run';
      if (args.includes('dev') && args.includes('--local')) return 'wrangler dev local';
      if (args.includes('migrations') && args.includes('--local')) return 'wrangler local migrations';
      if (args.includes('execute') && args.includes('--local')) return 'wrangler local seed';
    }
    for (const name of ['isolated-release.mjs', 'verify-release-artifact.mjs', 'run-local-beta-operator.ts', 'local-beta-fallback-command.mjs']) {
      if (args.some(value => basename(value) === name)) return `node ${name}`;
    }
    return args.includes('--test') ? 'node tests' : 'node fixture';
  }
  return 'local process';
}

export class RehearsalLifecycle {
  constructor(taskRoot, receipt, { failedOutputDirectory, ownsFailedOutputDirectory = false } = {}) {
    assertRehearsalPlatform();
    registry.checkDirectory(taskRoot);
    if (ownsFailedOutputDirectory && !failedOutputDirectory) fail('owned failed-output directory requires a destination');
    this.taskRoot = taskRoot; this.receipt = receipt; this.scopes = new Map(); this.interrupted = false; this.cleanupPromise = undefined;
    if (failedOutputDirectory) registry.checkDirectory(failedOutputDirectory);
    this.failedOutputDirectory = failedOutputDirectory;
    this.ownsFailedOutputDirectory = ownsFailedOutputDirectory;
    this.registryRoot = join(taskRoot, 'processes');
    mkdirSync(this.registryRoot, { mode: 0o700 });
  }

  startService(command, args, cwd, env) {
    if (this.interrupted || this.cleanupPromise) fail('local rehearsal is closing');
    if (this.scopes.size >= 128) fail('local rehearsal command limit exceeded');
    const directory = join(this.registryRoot, randomUUID());
    mkdirSync(directory, { mode: 0o700 });
    const scope = { directory, started: Date.now(), command: receiptCommand(command, args), child: undefined, stopped: false, stopPromise: undefined };
    if (this.failedOutputDirectory) scope.output = new FailedCommandOutput(this.failedOutputDirectory);
    // Register the scope before spawning; even a spawn/registration failure remains cleanup-owned.
    const handle = {
      get pid() { return scope.child?.pid; },
      get exitCode() { return scope.child?.exitCode ?? null; },
      get signalCode() { return scope.child?.signalCode ?? null; },
    };
    this.scopes.set(handle, scope);
    scope.child = spawn(command, args, { cwd, env: { ...env, TOCYN_REHEARSAL_PROCESS_REGISTRY: directory, TOCYN_REHEARSAL_ANCESTOR_REGISTRIES: '[]', NODE_OPTIONS: `--require=${JSON.stringify(preload)}` }, stdio: scope.output ? ['ignore', 'pipe', 'pipe'] : 'ignore', detached: true });
    if (scope.output) {
      scope.child.stdout.on('data', chunk => scope.output.append('stdout', chunk));
      scope.child.stderr.on('data', chunk => scope.output.append('stderr', chunk));
      scope.outputClosed = new Promise(resolvePromise => scope.child.once('close', resolvePromise));
    }
    handle.exited = new Promise(resolvePromise => {
      scope.child.once('error', () => resolvePromise({ code: null, signal: null }));
      scope.child.once('exit', (code, signal) => resolvePromise({ code, signal }));
    });
    try { if (scope.child.pid) registry.register(directory, scope.child.pid); }
    catch (error) { registry.markFailed(directory); throw error; }
    return handle;
  }

  async run(command, args, cwd, env) {
    const handle = this.startService(command, args, cwd, env);
    const scope = this.scopes.get(handle);
    const { code, signal } = await handle.exited;
    // Leader exit never removes ownership. Finish all descendants before the next command.
    const passed = code === 0 && !signal;
    let diagnostics;
    try {
      await this.stopScope(scope);
      diagnostics = await this.finishOutput(scope, !passed);
    } catch (error) {
      this.retainOutputAfterFailure(scope);
      throw error;
    }
    this.receipt.commands.push({ command: scope.command, durationMs: Date.now() - scope.started, result: passed ? 'passed' : 'failed', exitCode: code, signal, ...(diagnostics ? { diagnostics } : {}) });
    if (!passed) fail(`local command failed: ${scope.command}`);
  }

  retainOutputAfterFailure(scope) {
    try {
      scope.output?.finish(true);
      if (scope.output?.unavailable) this.receipt.diagnostics = 'unavailable';
    }
    catch { this.receipt.diagnostics = 'unavailable'; }
  }

  async stopService(handle) {
    const scope = this.scopes.get(handle);
    if (!scope) fail('service does not belong to this rehearsal');
    const alreadyExited = handle.exitCode !== null || handle.signalCode !== null;
    await this.stopScope(scope);
    const diagnostics = await this.finishOutput(scope, alreadyExited);
    if (!scope.reportedStop) {
      this.receipt.commands.push({ command: scope.command, durationMs: Date.now() - scope.started, result: 'stopped', ...(diagnostics ? { diagnostics } : {}) });
      scope.reportedStop = true;
    }
  }

  async finishOutput(scope, failed) {
    if (!scope.output || scope.output.finished) return scope.output?.result;
    // Stop verified descendants before waiting for their inherited output pipes.
    let timer;
    try {
      await Promise.race([scope.outputClosed, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned command output did not settle')), 2000);
      })]);
      return scope.output.finish(failed);
    } finally { clearTimeout(timer); }
  }

  stopScope(scope) {
    if (!scope.stopPromise) scope.stopPromise = this.closeScope(scope);
    return scope.stopPromise;
  }

  async closeScope(scope) {
    const hardDeadline = Date.now() + 10000;
    const checkDeadline = () => { if (Date.now() >= hardDeadline) fail('owned process verification timed out'); };
    registry.privateWrite(join(scope.directory, 'closing'), 'closing');
    // No new instrumented spawn may begin after closing. An in-progress registration
    // must finish before TERM, otherwise we retain the registry and report incomplete.
    const unlockedAt = Date.now() + 2000;
    while (readdirSync(scope.directory).some(name => name.startsWith('spawning-'))) {
      if (Date.now() >= unlockedAt) fail('owned process registration did not settle');
      await delay(25);
    }
    const owned = new Map();
    const liveOwned = () => {
      checkDeadline();
      const processes = registry.snapshot();
      for (const record of registry.read(scope.directory)) owned.set(`${record.pid}:${record.start}`, record);
      const known = processes.filter(info => owned.has(`${info.pid}:${info.start}`));
      // Capture non-Node leaves while their verified parent/group is still present.
      // Signal individual identities, never an unverified recycled process-group ID.
      const groups = new Set(known.map(info => info.pgid));
      const parents = new Set(known.map(info => info.pid));
      let changed = true;
      while (changed) {
        changed = false;
        for (const info of processes) if (!owned.has(`${info.pid}:${info.start}`) && (parents.has(info.ppid) || groups.has(info.pgid))) {
          registry.record(scope.directory, info); owned.set(`${info.pid}:${info.start}`, info); parents.add(info.pid); changed = true;
        }
      }
      return processes.filter(info => !info.zombie && owned.has(`${info.pid}:${info.start}`));
    };
    const signalKnown = (records, signal) => {
      // Recheck immediately before each signal; only matching OS start identities qualify.
      for (const record of records) {
        checkDeadline();
        const current = registry.snapshot().find(info => info.pid === record.pid);
        if (!current || current.start !== record.start || current.zombie) continue;
        try { process.kill(record.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    };
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const deadline = Date.now() + 2000;
      let sent = new Set();
      do {
        const living = liveOwned();
        if (!living.length) {
          // Preloads register before main; repeated scans also catch delayed startup.
          await delay(50);
          if (!liveOwned().length) { scope.stopped = true; return; }
        }
        const fresh = living.filter(info => !sent.has(`${info.pid}:${info.start}`));
        signalKnown(fresh, signal);
        sent = new Set([...sent, ...fresh.map(info => `${info.pid}:${info.start}`)]);
        await delay(25);
      } while (Date.now() < deadline);
    }
    if (liveOwned().length) fail('owned process tree did not terminate');
    scope.stopped = true;
  }

  cleanup() {
    this.interrupted = true;
    if (!this.cleanupPromise) this.cleanupPromise = (async () => {
      const stopped = await Promise.allSettled([...this.scopes.values()].map(scope => this.stopScope(scope)));
      const failure = stopped.find(result => result.status === 'rejected');
      // A command interrupted before its caller can finish still leaves private evidence.
      const outputs = await Promise.allSettled([...this.scopes.values()].filter(scope => scope.output && !scope.output.finished).map(async scope => {
        if (failure) this.retainOutputAfterFailure(scope);
        else await this.finishOutput(scope, true);
      }));
      const outputFailure = outputs.find(result => result.status === 'rejected');
      if (outputFailure || [...this.scopes.values()].some(scope => scope.output?.unavailable)) this.receipt.diagnostics = 'unavailable';
      if (failure?.status === 'rejected') throw failure.reason;
      if (outputFailure?.status === 'rejected') throw outputFailure.reason;
      if (this.ownsFailedOutputDirectory) {
        try { if (!readdirSync(this.failedOutputDirectory).length) rmSync(this.failedOutputDirectory, { recursive: true }); }
        catch { this.receipt.diagnostics = 'unavailable'; fail('private diagnostics cleanup could not be completed'); }
      }
      for (const name of ['candidate', 'comparison', 'known-good']) {
        const worktree = join(this.taskRoot, name);
        if (statExists(worktree)) {
          try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'ignore' }); } catch { /* rmSync below removes runner-owned paths. */ }
        }
      }
      rmSync(this.taskRoot, { recursive: true, force: true });
    })();
    return this.cleanupPromise;
  }
}

export function installSignalCleanup(lifecycle, receipt, receiptPath) {
  let handling = false;
  const onSignal = (signal, code) => {
    if (handling) return;
    handling = true;
    lifecycle.interrupted = true;
    receipt.interrupted = signal;
    void lifecycle.cleanup().then(() => {
      receipt.cleanup = 'disposed';
      writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
      process.exit(code);
    }).catch(() => {
      receipt.cleanup = 'incomplete';
      writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
      process.exit(1);
    });
  };
  const sigint = () => onSignal('SIGINT', 130); const sigterm = () => onSignal('SIGTERM', 143);
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  return () => { process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm); };
}

function syntheticPackagingEnvironment(env, worktree) {
  const manifest = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', join(worktree, 'deployment/beta.json')]));
  return pinnedFrontendEnvironment({
    ...env,
    TOCYN_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111',
    TOCYN_D1_DATABASE_NAME: manifest.resources.d1Database,
    TOCYN_ATTACHMENTS_BUCKET: manifest.resources.r2AttachmentsBucket,
    TOCYN_PORTAL_ORIGIN: 'https://portal.beta.local.invalid',
    TOCYN_DASHBOARD_ORIGIN: 'https://dashboard.beta.local.invalid',
    TOCYN_API_ORIGIN: 'https://api.beta.local.invalid',
  });
}

async function assertAvailablePorts() { await portFree(8787); await portFree(5174); }

async function runAcceptanceCommands(worktree, env, lifecycle) {
  for (const [command, args] of requiredAcceptanceCommands) {
    await assertAvailablePorts();
    await lifecycle.run(command, args, worktree, env);
    await assertAvailablePorts();
  }
}

export async function buildParkArtifact(worktree, revision, taskRoot, label, lifecycle, { runAcceptance = false } = {}) {
  const release = join(taskRoot, `${label}-release`);
  const env = syntheticPackagingEnvironment(localEnvironment(process.env, taskRoot), worktree);
  await lifecycle.run('npm', ['ci', '--ignore-scripts', '--offline'], worktree, env);
  await lifecycle.run('npm', ['rebuild', 'better-sqlite3', '--workspace=apps/server'], worktree, env);
  if (runAcceptance) await runAcceptanceCommands(worktree, env, lifecycle);
  // Each fresh checkout must produce its own packaged frontend inputs.
  for (const [command, args] of artifactBuildCommands) await lifecycle.run(command, args, worktree, env);
  await lifecycle.run('node', ['scripts/deployment/isolated-release.mjs', 'prepare', '--target', 'beta', '--revision', revision, '--mode', 'park', '--output', release], worktree, env);
  await lifecycle.run(process.execPath, [join(worktree, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--outdir', join(release, 'worker'), '--metafile', join(release, 'worker-meta.json'), '--config', join(release, 'wrangler.source.json')], worktree, env);
  await lifecycle.run('node', ['scripts/deployment/isolated-release.mjs', 'package', '--target', 'beta', '--revision', revision, '--mode', 'park', '--output', release], worktree, env);
  await lifecycle.run('node', ['scripts/deployment/verify-release-artifact.mjs', release, 'beta'], worktree, env);
  await lifecycle.run(process.execPath, [join(worktree, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--no-bundle', '--config', join(release, 'wrangler.deploy.json')], worktree, env);
  return release;
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]; const value = rest[index + 1];
    if (!['--revision', '--known-good', '--receipt'].includes(key) || value === undefined || values.has(key)) fail('arguments must be named exactly once from the local-only allowlist');
    values.set(key, value);
  }
  return { operation, revision: values.get('--revision'), knownGood: values.get('--known-good'), receipt: values.get('--receipt') };
}

export async function runRehearsal({ revision, knownGood, receiptPath }) {
  const plan = rehearsalPlan(revision, knownGood);
  assertRehearsalPlatform();
  if (!process.versions.node.startsWith('22.')) fail('Node 22 is required for the local rehearsal');
  assertPythonPty();
  assertCleanRevision(root, revision);
  if (!receiptPath || !isAbsolute(receiptPath) || basename(receiptPath) !== 'receipt.json') fail('receipt must be an absolute path named receipt.json');
  await assertAvailablePorts();
  const taskRoot = mkdtempSync(join(tmpdir(), 'tocyn-local-beta-rehearsal-'), { encoding: 'utf8' });
  chmodSync(taskRoot, 0o700);
  for (const directory of ['tmp', 'config', 'cache']) {
    const path = join(taskRoot, directory);
    mkdirSync(path, { mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const receipt = {
    mode: plan.mode, candidate: revision, knownGood, providerReceipt: 'absent', deployment: 'not-run', mail: 'local-capture',
    frontendInputs: { apiUrl: 'https://api.beta.local.invalid', widgetKey: 'local-rehearsal-widget-key' },
    fallback: { result: 'not-run', reason: 'local fallback has not run' }, commands: [], cleanup: 'pending',
  };
  const failedOutputDirectory = mkdtempSync(join(dirname(receiptPath), '.rehearsal-failed-output-'));
  chmodSync(failedOutputDirectory, 0o700);
  const lifecycle = new RehearsalLifecycle(taskRoot, receipt, { failedOutputDirectory, ownsFailedOutputDirectory: true });
  const removeSignalHandlers = installSignalCleanup(lifecycle, receipt, receiptPath);
  try {
    const candidate = join(taskRoot, 'candidate'); const comparison = join(taskRoot, 'comparison');
    await lifecycle.run('git', ['worktree', 'add', '--detach', candidate, revision], root, localEnvironment(process.env, taskRoot));
    await lifecycle.run('git', ['worktree', 'add', '--detach', comparison, revision], root, localEnvironment(process.env, taskRoot));
    const first = await buildParkArtifact(candidate, revision, taskRoot, 'candidate', lifecycle, { runAcceptance: true });
    const second = await buildParkArtifact(comparison, revision, taskRoot, 'comparison', lifecycle);
    const comparisonReceipt = compareArtifactFiles(first, second);
    const verified = verifyReleaseArtifact(first, 'beta');
    Object.assign(receipt, { artifact: { ...comparisonReceipt, releaseDigest: verified.provenance.releaseDigest, mode: verified.provenance.mode } });
    const knownGoodSource = join(taskRoot, 'known-good');
    const env = localEnvironment(process.env, taskRoot);
    await lifecycle.run('git', ['worktree', 'add', '--detach', knownGoodSource, knownGood], root, env);
    await lifecycle.run('npm', ['ci', '--ignore-scripts', '--offline'], knownGoodSource, env);
    await lifecycle.run('npm', ['rebuild', 'better-sqlite3', '--workspace=apps/server'], knownGoodSource, env);
    const fallbackRequest = join(taskRoot, 'fallback-request.json');
    const fallbackReceipt = join(taskRoot, 'fallback-receipt.json');
    writeFileSync(fallbackRequest, JSON.stringify({ taskRoot, receiptPath: fallbackReceipt, failedOutputDirectory,
      candidate: { source: candidate, revision }, knownGood: { source: knownGoodSource, revision: knownGood },
    }), { mode: 0o600 });
    try {
      await lifecycle.run(process.execPath, ['--import', 'tsx', join(root, 'scripts/deployment/local-beta-fallback-command.mjs'), fallbackRequest], root, env);
    } finally {
      if (statExists(fallbackReceipt)) {
        const fallback = JSON.parse(readFileSync(fallbackReceipt, 'utf8'));
        receipt.fallback = fallback.result || { result: 'failed', reason: 'local_runtime_failed' };
        receipt.fallbackCleanup = fallback.cleanup;
      }
    }

  } finally {
    try {
      await lifecycle.cleanup();
      receipt.cleanup = 'disposed';
    } catch (error) {
      receipt.cleanup = 'incomplete';
      throw error;
    } finally {
      removeSignalHandlers();
      writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    }
  }
  return receipt;
}

function statExists(path) { try { statSync(path); return true; } catch { return false; } }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  if (args.operation === 'plan') process.stdout.write(`${JSON.stringify(rehearsalPlan(args.revision, args.knownGood))}\n`);
  else if (args.operation === 'run') runRehearsal({ revision: args.revision, knownGood: args.knownGood, receiptPath: args.receipt }).then(result => process.stdout.write(`${JSON.stringify({ mode: result.mode, cleanup: result.cleanup })}\n`));
  else fail('command must be plan or run');
}
