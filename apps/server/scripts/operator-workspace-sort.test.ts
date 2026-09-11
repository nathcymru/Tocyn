import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';

test('operator sort is validated, tenant-scoped, stable and applied before pagination', async () => {
  await withTwoTenantFixture(async fixture => {
    const challenge = await (await fixture.login('operatorA')).json<{ token: string }>();
    const session = await (await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode('operatorA') } })).json<{ token: string }>();
    await fixture.db.prepare("UPDATE tickets SET priority='low',created_at='2020-01-01',updated_at='2020-01-01'").run();
    for (const [id, priority, created, updated] of [
      ['alpha', 'urgent', '2021-01-01', '2022-01-01'],
      ['beta', 'normal', '2022-01-01', '2023-01-01'],
      ['gamma', 'high', '2023-01-01', '2023-01-01'],
    ]) {
      await fixture.db.prepare('INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .bind('fixture-tenant-a', id, 'Synthetic sort', fixture.principals.customerA.localId, fixture.principals.customerA.email, 'web', priority, created, updated).run();
    }
    const expected: Record<string, string[]> = {
      updated_desc: ['beta', 'gamma', 'alpha', 'fixture-ticket'], updated_asc: ['fixture-ticket', 'alpha', 'beta', 'gamma'],
      created_desc: ['gamma', 'beta', 'alpha', 'fixture-ticket'], created_asc: ['fixture-ticket', 'alpha', 'beta', 'gamma'],
      priority_desc: ['alpha', 'gamma', 'beta', 'fixture-ticket'], priority_asc: ['fixture-ticket', 'beta', 'gamma', 'alpha'],
    };
    for (const [sort, ids] of Object.entries(expected)) {
      const actual: string[] = [];
      for (const page of [1, 2]) {
        const response = await fixture.request(`/api/tickets?sort=${sort}&limit=2&page=${page}`, { token: session.token });
        assert.equal(response.status, 200);
        const result = await response.json<{ data: { id: string; tenant_id: string }[]; meta: { total: number } }>();
        assert.equal(result.meta.total, 4);
        assert.ok(result.data.every(ticket => ticket.tenant_id === 'fixture-tenant-a'));
        actual.push(...result.data.map(ticket => ticket.id));
      }
      assert.deepEqual(actual, ids, sort);
    }
    assert.equal((await fixture.request('/api/tickets?sort=updated_desc%3BDROP%20TABLE%20tickets', { token: session.token })).status, 400);
    assert.equal((await fixture.request('/api/tickets?sort=__proto__', { token: session.token })).status, 400);
    assert.equal((await fixture.request('/api/tickets?sort=priority_desc')).status, 401);
    await fixture.revokePrincipalSessions('operatorA');
    assert.equal((await fixture.request('/api/tickets?sort=priority_desc', { token: session.token })).status, 401);
  });
});
