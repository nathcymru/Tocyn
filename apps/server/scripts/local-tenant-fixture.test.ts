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
  const headerGlobal = globalThis as typeof globalThis & { Headers?: unknown };
  const originalHeaders = headerGlobal.Headers;
  await assert.rejects(withTwoTenantFixture(async fixture => {
    const shared = await fixture.db.prepare(`SELECT id, count(*) AS count, count(DISTINCT tenant_id) AS tenants
      FROM users WHERE id IN ('fixture-customer', 'fixture-operator') GROUP BY id ORDER BY id`).all<{ id: string; count: number; tenants: number }>();
    assert.deepEqual(shared.results, [
      { id: 'fixture-customer', count: 2, tenants: 2 },
      { id: 'fixture-operator', count: 2, tenants: 2 },
    ]);
    throw new Error('intentional fixture callback failure');
  }), /intentional fixture callback failure/);
  assert.equal(headerGlobal.Headers, originalHeaders, 'Fixture must restore global Headers after a failed callback');

  const recovered = await verifyTwoTenantFixture();
  assert.equal(recovered.cleanup, 'disposed');
  assert.equal(recovered.foreignKeyViolations, 0);
});

test('fixture exposes its callback-local R2 binding and named session revocation without secret reports', async () => {
  await withTwoTenantFixture(async fixture => {
    assert.deepEqual(fixture.r2.operationCounts(), { get: 0, put: 0, delete: 0, list: 0 });
    await fixture.r2.bucket.put('fixture/probe.txt', 'synthetic');
    assert.equal(await fixture.r2.bucket.get('fixture/probe.txt') !== null, true);
    await fixture.r2.bucket.delete('fixture/probe.txt');
    assert.deepEqual(fixture.r2.operationCounts(), { get: 1, put: 1, delete: 1, list: 0 });

    const login = await fixture.login('customerA');
    const { token } = await login.json<{ token: string }>();
    await fixture.revokePrincipalSessions('customerA');
    const denied = await fixture.request('/api/auth/me', { token });
    assert.equal(denied.status, 401);
  });
});
