import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { unstable_readConfig } from 'wrangler';

const serverRoot = resolve(import.meta.dirname, '..');
const configPaths = {
  production: resolve(serverRoot, 'wrangler.json'),
  local: resolve(serverRoot, 'wrangler.local.json'),
  evidence: resolve(serverRoot, 'wrangler.observability-evidence.json'),
};

function readConfig(kind) {
  // This is the installed Wrangler parser and schema, rather than a copied key list.
  return unstable_readConfig({ config: configPaths[kind] }, { hideWarnings: true });
}

function assertPersistenceDisabled(config, label) {
  assert.equal(config.observability.enabled, false, `${label} observability must be disabled`);
  assert.equal(config.observability.logs.enabled, false, `${label} logs must be disabled`);
  assert.equal(config.observability.logs.invocation_logs, false, `${label} invocation logs must be disabled`);
  assert.equal(config.observability.logs.persist, false, `${label} log persistence must be disabled`);
  assert.equal(config.observability.traces.enabled, false, `${label} traces must be disabled`);
  assert.equal(config.observability.traces.persist, false, `${label} trace persistence must be disabled`);
  assert.deepEqual(config.observability.logs.destinations, []);
  assert.deepEqual(config.observability.traces.destinations, []);
}

function assertLocalOnlyBindings(config, label) {
  assert.deepEqual(config.d1_databases.map(binding => [binding.binding, binding.remote]), [['DB', false]], `${label} D1 binding changed`);
  assert.deepEqual(config.r2_buckets.map(binding => [binding.binding, binding.remote]), [['ATTACHMENTS_BUCKET', false]], `${label} R2 binding changed`);
  assert.deepEqual(config.durable_objects.bindings.map(binding => binding.name), ['NOTIFICATION_DO'], `${label} Durable Object binding changed`);
  assert.deepEqual(config.vectorize, [], `${label} must not add Vectorize`);
  assert.deepEqual(config.workflows, [], `${label} must not add Workflows`);
  assert.equal(config.ai, undefined, `${label} must not add an AI provider binding`);
  for (const name of Object.keys(config.vars)) {
    assert.equal(/^(?:CLOUDFLARE_|CF_API_|RESEND_)/.test(name), false, `${label} must not add a provider variable`);
  }
}

function parseJsonLogs(logs) {
  return logs.flatMap(log => {
    try { return [JSON.parse(log.message)]; } catch { return []; }
  });
}

test('checked-in configurations parse with the installed Wrangler schema', () => {
  for (const kind of Object.keys(configPaths)) assert.ok(readConfig(kind).name);
});

test('local evidence profile is a runnable guarded local configuration with no provider or remote binding', () => {
  const local = readConfig('local');
  const evidence = readConfig('evidence');
  const raw = JSON.parse(readFileSync(configPaths.evidence, 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), ['name','main','compatibility_date','compatibility_flags','vars','d1_databases','r2_buckets','durable_objects','migrations','observability'].sort(), 'Evidence profile may not add unreviewed bindings/settings');
  assertPersistenceDisabled(local, 'local');
  assertPersistenceDisabled(evidence, 'evidence');
  assertLocalOnlyBindings(local, 'local');
  assertLocalOnlyBindings(evidence, 'evidence');
  assert.equal(evidence.main, resolve(serverRoot, 'src/local-index.ts'));
  assert.deepEqual(evidence.vars, {
    ENVIRONMENT: 'local', OBSERVABILITY_MODE: 'isolated-evidence', LOCAL_BETA_ENABLED: 'true',
    PORTAL_URL: 'http://localhost:5174',
    CORS_ORIGINS: 'http://localhost:5174,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:5173',
  });
});

test('production configuration refuses every observability persistence or enablement switch', () => {
  const production = readConfig('production');
  assertPersistenceDisabled(production, 'production');
  for (const path of [['enabled'], ['logs', 'enabled'], ['logs', 'invocation_logs'], ['logs', 'persist'], ['traces', 'enabled'], ['traces', 'persist']]) {
    const candidate = structuredClone(production);
    let target = candidate.observability;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)] = true;
    assert.throws(() => assertPersistenceDisabled(candidate, `production ${path.join('.')}`));
  }
});

test('the parsed evidence profile serves guarded local health and emits a local-only request event', async () => {
  const config = readConfig('evidence');
  const built = await build({ entryPoints: [config.main], bundle: true, format: 'esm', platform: 'neutral', external: ['node:crypto'], write: false });
  const logs = [];
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    handleStructuredLogs: log => { logs.push(log); },
    workers: [{
      name: config.name, modules: true, script: built.outputFiles[0].text,
      compatibilityFlags: config.compatibility_flags,
      d1Databases: { DB: '56046e55-5e61-48cd-9e82-6f1f2baf2d29' },
      r2Buckets: ['ATTACHMENTS_BUCKET'],
      durableObjects: { NOTIFICATION_DO: 'NotificationDO' },
      unsafeEphemeralDurableObjects: true,
      bindings: config.vars,
    }],
  }));
  try {
    const db = await miniflare.getD1Database('DB');
    await db.batch([
      db.prepare('CREATE TABLE local_beta_runs (run_id TEXT PRIMARY KEY)'),
      db.prepare('CREATE TABLE local_beta_policy (singleton INTEGER PRIMARY KEY, run_id TEXT, revision INTEGER, state TEXT)'),
      db.prepare('CREATE TABLE local_beta_tenants (run_id TEXT, tenant_id TEXT)'),
      db.prepare("INSERT INTO local_beta_runs VALUES ('evidence-run')"),
      db.prepare("INSERT INTO local_beta_policy VALUES (1, 'evidence-run', 1, 'running')"),
      db.prepare("INSERT INTO local_beta_tenants VALUES ('evidence-run', 'evidence-tenant-a')"),
      db.prepare("INSERT INTO local_beta_tenants VALUES ('evidence-run', 'evidence-tenant-b')"),
    ]);
    const response = await miniflare.dispatchFetch('http://localhost:8787/health');
    assert.equal(response.status, 200);
    await response.body?.cancel();
    const events = parseJsonLogs(logs).filter(event => event?.type === 'http.request');
    assert.deepEqual(events.map(event => [event.route, event.method, event.outcome, event.status]), [['/health', 'GET', 'success', 200]]);
    assert.equal(JSON.stringify(events).includes('evidence-run'), false);
  } finally {
    await miniflare.dispose();
  }
});
