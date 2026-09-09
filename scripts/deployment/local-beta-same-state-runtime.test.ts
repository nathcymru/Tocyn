import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { createLocalFixtureBootstrap } from '../../apps/server/scripts/local-tenant-fixture';
import { assertLocalBindingInventory, assertRuntimeSchema } from './local-beta-same-state-runtime';

test('same-state fallback recognizes the real four-principal fixture while capture remains customer-only', async () => {
  const bootstrap = await createLocalFixtureBootstrap({ MFA_ENCRYPTION_KEY: 'a'.repeat(64) });
  assert.deepEqual(bootstrap.credentials.map(credential => credential.email).sort(), [
    'fixture.operator.a@example.test', 'fixture.operator.b@example.test',
    'tocyn-auth-test-a@example.invalid', 'tocyn-auth-test-b@example.invalid',
  ]);
  assert.ok(bootstrap.credentials.find(credential => credential.email === 'fixture.operator.a@example.test')?.provisioningUri);
  assert.ok(bootstrap.credentials.find(credential => credential.email === 'tocyn-auth-test-a@example.invalid')?.portalLoginUrl);
});

test('same-state fallback rejects remote, AI, Vectorize, workflow, queue, and service bindings', () => {
  const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../apps/server/wrangler.local.json'), 'utf8')) as Record<string, unknown>;
  assert.doesNotThrow(() => assertLocalBindingInventory(config));
  for (const [name, value] of [['ai', { binding: 'AI' }], ['vectorize', [{ binding: 'INDEX' }]], ['workflows', [{ binding: 'WORKFLOW' }]], ['queues', { producers: [] }], ['services', [{ binding: 'SERVICE' }]]] as const) {
    assert.throws(() => assertLocalBindingInventory({ ...config, [name]: value }), new RegExp(name));
  }
  assert.throws(() => assertLocalBindingInventory({ ...config, d1_databases: [{ remote: true }] }), /remote binding/);
});


test('runtime schema inspection identifies a real missing table before any Worker starts', async t => {
  const source = resolve(import.meta.dirname, '../..');
  const state = mkdtempSync(join(tmpdir(), 'tocyn-fallback-schema-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const directory = join(state, 'v3/d1/miniflare-D1DatabaseObject');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const Database = createRequire(join(source, 'apps/server/package.json'))('better-sqlite3');
  const db = new Database(join(directory, 'synthetic.sqlite'));
  try {
    db.exec('CREATE TABLE users(tenant_id TEXT,id TEXT,role TEXT)');
    for (const tenant of ['fixture-tenant-a', 'fixture-tenant-b']) {
      db.prepare('INSERT INTO users VALUES(?,?,?)').run(tenant, 'fixture-customer', 'customer');
      db.prepare('INSERT INTO users VALUES(?,?,?)').run(tenant, 'fixture-operator', 'admin');
    }
    db.exec('CREATE TABLE tickets(id TEXT); CREATE TABLE articles(id TEXT); CREATE TABLE conversation_events(id TEXT); CREATE TABLE local_beta_runs(id TEXT); CREATE TABLE local_beta_policy(id TEXT); CREATE TABLE local_beta_invitations(id TEXT); CREATE TABLE ticket_mutation_receipts(id TEXT);');
    const input = { source, revision: 'a'.repeat(40) };
    await assertRuntimeSchema(input, state);
    db.exec('DROP TABLE conversation_events');
    await assert.rejects(assertRuntimeSchema(input, state), { name: 'RuntimeSchemaIncompatibleError' });
    // A missing/malformed fixture identity is a failure, not an inferred schema result.
    db.exec('DELETE FROM users');
    await assert.rejects(assertRuntimeSchema(input, state), /Approved local two-tenant fixture required/);
  } finally { db.close(); }
});
