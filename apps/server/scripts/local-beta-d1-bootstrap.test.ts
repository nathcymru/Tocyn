import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { initializeFreshLocalBetaPolicy } from './local-beta-d1-bootstrap';

function policy(fixture: LocalTenantFixture) {
  const { customerA, operatorA, customerB, operatorB } = fixture.principals;
  return {
    runId: 'd1-bootstrap',
    tenants: [customerA.tenantId, customerB.tenantId],
    invitations: [customerA, operatorA, customerB, operatorB].map(principal => ({
      tenantId: principal.tenantId, id: principal.localId,
      kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
    })),
    limits: { ticketLimit: 20, mutationLimit: 80, recoveryReserve: 20, uploadLimit: 10 },
  };
}

async function rows(db: D1Database) {
  const names = ['local_beta_runs', 'local_beta_tenants', 'local_beta_invitations', 'local_beta_policy', 'local_beta_operator_receipts'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name,
    (await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first<{ n: number }>())?.n] as const)));
}

test('fresh D1 bootstrap keeps a two-tenant invited policy and revision receipt; a second initialize cannot replace it', async () => {
  await withTwoTenantFixture(async fixture => {
    await initializeFreshLocalBetaPolicy(fixture.db, policy(fixture));
    const before = await rows(fixture.db);
    assert.deepEqual(before, {
      local_beta_runs: 1, local_beta_tenants: 2, local_beta_invitations: 4,
      local_beta_policy: 1, local_beta_operator_receipts: 1,
    });
    assert.equal((await fixture.db.prepare('SELECT COUNT(*) AS n FROM local_beta_assertion').first<{ n: number }>())?.n, 0,
      'bootstrap assertions remain transactional and leave the cold admission path available');
    assert.deepEqual(await fixture.db.prepare('SELECT run_id,revision,state FROM local_beta_policy').first(),
      { run_id: 'd1-bootstrap', revision: 1, state: 'running' });
    await assert.rejects(initializeFreshLocalBetaPolicy(fixture.db, { ...policy(fixture), runId: 'replacement-run' }));
    assert.deepEqual(await rows(fixture.db), before);
  });
});

test('wrong-tenant API key invitation rejects the whole D1 batch before any beta policy is visible', async () => {
  await withTwoTenantFixture(async fixture => {
    const key = await fixture.createScopedApiKey('operatorA', ['tickets:read']);
    const input = policy(fixture);
    await assert.rejects(initializeFreshLocalBetaPolicy(fixture.db, {
      ...input,
      invitations: [...input.invitations, { tenantId: fixture.principals.operatorB.tenantId, id: key.id, kind: 'api-key' }],
    }));
    assert.deepEqual(await rows(fixture.db), {
      local_beta_runs: 0, local_beta_tenants: 0, local_beta_invitations: 0,
      local_beta_policy: 0, local_beta_operator_receipts: 0,
    });
    await initializeFreshLocalBetaPolicy(fixture.db, {
      ...input,
      invitations: [...input.invitations, { tenantId: fixture.principals.operatorA.tenantId, id: key.id, kind: 'api-key' }],
    });
    assert.equal((await fixture.db.prepare('SELECT COUNT(*) AS n FROM local_beta_invitations').first<{ n: number }>())?.n, 5);
  });
});
