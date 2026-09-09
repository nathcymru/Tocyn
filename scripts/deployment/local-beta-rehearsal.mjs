import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactFiles, digest, verifyReleaseArtifact } from './verify-release-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const providerVariable = /^(?:CLOUDFLARE_|CF_|RESEND_|TOCYN_(?:ACCESS_|RESTRICTED_INGRESS_APPROVED$|D1_|ATTACHMENTS_|PORTAL_ORIGIN$|DASHBOARD_ORIGIN$|API_ORIGIN$))/;
const requiredAcceptanceCommands = [
  ['npm', ['run', 'typecheck', '--workspace=apps/server']],
  ['npm', ['run', 'lint', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:local-tenants', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:local-beta', '--workspace=apps/server']],
  ['npm', ['run', 'typecheck:local-portal-workflow', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-auth', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-portal-workflow', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-tenants', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-tenant-realtime', '--workspace=apps/server']],
  ['npm', ['run', 'test:canonical-conversation-atomic', '--workspace=apps/server']],
  ['npm', ['run', 'test:ticket-mutation-replay', '--workspace=apps/server']],
  ['npm', ['run', 'test:conversation-audit', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-beta', '--workspace=apps/server']],
  ['npm', ['run', 'test:local-beta-runtime', '--workspace=apps/server']],
  ['npm', ['run', 'lint', '--workspace=apps/portal']],
  ['npm', ['run', 'build', '--workspace=apps/dashboard']],
  ['npm', ['run', 'build', '--workspace=apps/portal']],
  ['npm', ['run', 'build', '--workspace=apps/widget']],
];

function fail(message) { throw new Error(`Local beta rehearsal rejected: ${message}`); }
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

export function localEnvironment(base, taskRoot) {
  if (!isAbsolute(taskRoot)) fail('task root must be absolute');
  const env = { ...base, WRANGLER_SEND_METRICS: 'false', TMPDIR: join(taskRoot, 'tmp'), XDG_CONFIG_HOME: join(taskRoot, 'config'), XDG_CACHE_HOME: join(taskRoot, 'cache') };
  for (const name of Object.keys(env)) if (providerVariable.test(name)) delete env[name];
  return env;
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

function run(command, args, cwd, env, receipt) {
  const started = Date.now();
  try {
    execFileSync(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
    receipt.commands.push({ command: [command, ...args].join(' '), durationMs: Date.now() - started, result: 'passed' });
  } catch {
    receipt.commands.push({ command: [command, ...args].join(' '), durationMs: Date.now() - started, result: 'failed' });
    fail(`local command failed: ${command} ${args[0] || ''}`);
  }
}

function syntheticPackagingEnvironment(env, worktree) {
  const manifest = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', join(worktree, 'deployment/beta.json')]));
  return {
    ...env,
    TOCYN_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111',
    TOCYN_D1_DATABASE_NAME: manifest.resources.d1Database,
    TOCYN_ATTACHMENTS_BUCKET: manifest.resources.r2AttachmentsBucket,
    TOCYN_PORTAL_ORIGIN: 'https://portal.beta.local.invalid',
    TOCYN_DASHBOARD_ORIGIN: 'https://dashboard.beta.local.invalid',
    TOCYN_API_ORIGIN: 'https://api.beta.local.invalid',
  };
}

async function assertAvailablePorts() { await portFree(8787); await portFree(5174); }

async function buildParkArtifact(worktree, revision, taskRoot, label, receipt) {
  const release = join(taskRoot, `${label}-release`);
  const env = syntheticPackagingEnvironment(localEnvironment(process.env, taskRoot), worktree);
  run('npm', ['ci', '--ignore-scripts', '--offline'], worktree, env, receipt);
  run('npm', ['rebuild', 'better-sqlite3', '--workspace=apps/server'], worktree, env, receipt);
  for (const [command, args] of requiredAcceptanceCommands) {
    await assertAvailablePorts();
    run(command, args, worktree, env, receipt);
    await assertAvailablePorts();
  }
  run('node', ['scripts/deployment/isolated-release.mjs', 'prepare', '--target', 'beta', '--revision', revision, '--mode', 'park', '--output', release], worktree, env, receipt);
  run(process.execPath, [join(worktree, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--outdir', join(release, 'worker'), '--metafile', join(release, 'worker-meta.json'), '--config', join(release, 'wrangler.source.json')], worktree, env, receipt);
  run('node', ['scripts/deployment/isolated-release.mjs', 'package', '--target', 'beta', '--revision', revision, '--mode', 'park', '--output', release], worktree, env, receipt);
  run('node', ['scripts/deployment/verify-release-artifact.mjs', release, 'beta'], worktree, env, receipt);
  run(process.execPath, [join(worktree, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--no-bundle', '--config', join(release, 'wrangler.deploy.json')], worktree, env, receipt);
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
  if (!process.versions.node.startsWith('22.')) fail('Node 22 is required for the local rehearsal');
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
  const receipt = { mode: plan.mode, candidate: revision, knownGood, providerReceipt: 'absent', deployment: 'not-run', mail: 'local-capture', commands: [], cleanup: 'pending' };
  try {
    const candidate = join(taskRoot, 'candidate'); const comparison = join(taskRoot, 'comparison');
    run('git', ['worktree', 'add', '--detach', candidate, revision], root, localEnvironment(process.env, taskRoot), receipt);
    run('git', ['worktree', 'add', '--detach', comparison, revision], root, localEnvironment(process.env, taskRoot), receipt);
    const first = await buildParkArtifact(candidate, revision, taskRoot, 'candidate', receipt);
    const second = await buildParkArtifact(comparison, revision, taskRoot, 'comparison', receipt);
    const comparisonReceipt = compareArtifactFiles(first, second);
    const verified = verifyReleaseArtifact(first, 'beta');
    Object.assign(receipt, { artifact: { ...comparisonReceipt, releaseDigest: verified.provenance.releaseDigest, mode: verified.provenance.mode }, fallback: plan.fallback });
  } finally {
    for (const name of ['candidate', 'comparison']) {
      const worktree = join(taskRoot, name);
      if (statExists(worktree)) {
        try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'ignore' }); } catch { /* rmSync below removes runner-owned paths. */ }
      }
    }
    rmSync(taskRoot, { recursive: true, force: true });
    receipt.cleanup = 'disposed';
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
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
