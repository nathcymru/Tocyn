import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTwoTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';

test('two disposable fixture runs have independent A/B principals and no report secrets', async () => {
  const first = await verifyTwoTenantFixture();
  const second = await verifyTwoTenantFixture();
  assert.deepEqual({ ...first, elapsedMs: 0 }, { ...second, elapsedMs: 0 });
  assert.ok(first.elapsedMs >= 0 && second.elapsedMs >= 0);
  const report = JSON.stringify(first);
  assert.equal(report.includes('password'), false);
  assert.equal(report.includes('provisioning'), false);
  assert.equal(report.includes('lt_'), false);
});

test('fixture uses colliding local IDs only within separate tenant scopes and cleans up after a failed callback', async () => {
  await assert.rejects(withTwoTenantFixture(async fixture => {
    const shared = await fixture.db.prepare(`SELECT id, count(*) AS count, count(DISTINCT tenant_id) AS tenants
      FROM users WHERE id IN ('fixture-customer', 'fixture-operator') GROUP BY id ORDER BY id`).all<{ id: string; count: number; tenants: number }>();
    assert.deepEqual(shared.results, [
      { id: 'fixture-customer', count: 2, tenants: 2 },
      { id: 'fixture-operator', count: 2, tenants: 2 },
    ]);
    throw new Error('intentional fixture callback failure');
  }), /intentional fixture callback failure/);

  const recovered = await verifyTwoTenantFixture();
  assert.equal(recovered.cleanup, 'disposed');
  assert.equal(recovered.foreignKeyViolations, 0);
});
