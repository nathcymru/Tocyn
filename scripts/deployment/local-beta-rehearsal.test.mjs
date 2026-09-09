import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compareArtifactFiles, localEnvironment, rehearsalPlan } from './local-beta-rehearsal.mjs';

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
