import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLocalFixtureBootstrap } from '../../apps/server/scripts/local-tenant-fixture';
import { assertLocalBindingInventory } from './local-beta-same-state-runtime';

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
