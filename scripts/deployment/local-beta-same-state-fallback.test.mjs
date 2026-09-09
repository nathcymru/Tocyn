import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  assertCompatibleMigrations, assertPreservedFallbackState, assertRequiredSchemaTables,
  canonicalDigest, migrationManifest, passedFallbackReceipt, unavailableFallbackReceipt, runtimeSchemaUnavailableReceipt,
} from './local-beta-same-state-fallback.mjs';

const candidate = 'a'.repeat(40);
const knownGood = 'b'.repeat(40);
const coreTables = ['tickets', 'articles', 'conversation_events', 'local_beta_runs', 'local_beta_policy', 'local_beta_invitations', 'ticket_mutation_receipts'];

function source(directory, migrations) {
  const path = join(directory, 'apps/server/migrations');
  mkdirSync(path, { recursive: true });
  for (const [name, contents] of Object.entries(migrations)) writeFileSync(join(path, name), contents);
  return directory;
}

function snapshot() {
  return {
    canonical: canonicalDigest({ detail: { articles: [{ id: 'synthetic-article', body: 'synthetic' }] }, history: { events: [{ kind: 'ticket.intake' }, { kind: 'ticket.state_changed' }] } }),
    tickets: 1, articles: 3, events: 3,
    admission: { state: 'running', revision: 1, tickets: 1, mutations: 3, uploadAttempts: 0 },
  };
}

test('exact source migration manifests are required before a shared local state opens', t => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-fallback-manifest-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const migrations = { '0001_base.sql': 'CREATE TABLE tickets(id TEXT);\n', '0002_audit.sql': 'CREATE TABLE conversation_events(id TEXT);\n' };
  const first = source(join(directory, 'candidate'), migrations);
  const second = source(join(directory, 'known-good'), migrations);
  assert.deepEqual(assertCompatibleMigrations(first, second), migrationManifest(first));
  writeFileSync(join(second, 'apps/server/migrations/0002_audit.sql'), 'CREATE TABLE conversation_events(id TEXT, version INTEGER);\n');
  assert.throws(() => assertCompatibleMigrations(first, second), /migration manifests differ/);
});

test('schema inventory fails closed when the durable audit or admission contract is absent', () => {
  assert.deepEqual(assertRequiredSchemaTables(coreTables), coreTables);
  assert.throws(() => assertRequiredSchemaTables(coreTables.filter(table => table !== 'conversation_events')), /conversation_events/);
  assert.throws(() => assertRequiredSchemaTables(coreTables.filter(table => table !== 'local_beta_runs')), /local_beta_runs/);
});

test('candidate and known-good receipts compare only redacted canonical and durable counter facts', () => {
  const first = snapshot();
  const second = JSON.parse(JSON.stringify(first));
  assert.deepEqual(assertPreservedFallbackState(first, second), first);
  second.admission.mutations += 1;
  assert.throws(() => assertPreservedFallbackState(first, second), /do not preserve candidate state/);
  assert.throws(() => assertPreservedFallbackState(first, { ...first, admission: { ...first.admission, state: 'writes_stopped' } }), /state must remain running/);
});

test('fallback receipts contain hashes and counters, never raw auth or conversation inputs', () => {
  const value = snapshot();
  const receipt = passedFallbackReceipt({ candidate, knownGood, migrations: 'c'.repeat(64), snapshot: value });
  assert.deepEqual(receipt.resources, { tickets: 1, articles: 3, events: 3 });
  assert.equal(receipt.fallback, 'passed');
  assert.equal(JSON.stringify(receipt).includes('synthetic-article'), false);
  assert.equal(JSON.stringify(receipt).includes('synthetic'), false);
  assert.deepEqual(unavailableFallbackReceipt({ candidate, knownGood, reason: 'migration_manifest_incompatible' }).fallback, 'unavailable');
  assert.throws(() => unavailableFallbackReceipt({ candidate, knownGood, reason: 'ignored' }), /not allowed/);
});


test('only a typed missing-table failure becomes schema unavailable; unrelated failures remain failures', () => {
  let missing;
  try { assertRequiredSchemaTables(coreTables.filter(table => table !== 'conversation_events')); }
  catch (error) { missing = error; }
  assert.deepEqual(runtimeSchemaUnavailableReceipt(missing, { candidate, knownGood }), {
    mode: 'local-only-same-state', candidate, knownGood,
    fallback: 'unavailable', reason: 'runtime_schema_incompatible',
  });
  for (const error of [new Error('HTTP failure'), new Error('canonical mismatch'), new Error('local state lacks required table conversation_events')]) {
    assert.throws(() => runtimeSchemaUnavailableReceipt(error, { candidate, knownGood }), value => value === error);
  }
});
