import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeJwt } from 'jose';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';
import { guardedFixture, betaCounters } from './local-beta-fixture';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { OperatorWorkspaceRepository } from '../src/repositories/operator-workspace.repository';

async function login(fixture: LocalTenantFixture, name: 'operatorA' | 'operatorB') {
  const response = await fixture.login(name);
  assert.equal(response.status, 200);
  const body = await response.json<{ token: string; mfa_required?: boolean }>();
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: body.token, body: { code: fixture.currentMfaCode(name) },
  });
  assert.equal(verified.status, 200);
  return (await verified.json<{token: string}>()).token;
}

test('theme preference is actor-scoped, CAS-safe and fenced against expired/revoked sessions', async () => {
  await withTwoTenantFixture(async fixture => {
    const token = await login(fixture, 'operatorA'); const other = await login(fixture, 'operatorB');
    const path = '/api/workspace/theme-preference';
    assert.equal((await fixture.request(path)).status, 401);
    assert.deepEqual(await (await fixture.request(path, { token })).json(), { revision: 0, mode: 'system', updatedAt: null });
    const save = (revision: number, mode: string, session = token) => fixture.request(path, { method: 'PUT', token: session, body: { expectedRevision: revision, mode } });
    assert.equal((await save(0, 'sepia')).status, 400);
    const first = await save(0, 'dark'); assert.equal(first.status, 200);
    assert.equal((await first.json<{revision: number}>()).revision, 1);
    assert.deepEqual(await (await fixture.request(path, { token: other })).json(), { revision: 0, mode: 'system', updatedAt: null });
    assert.equal((await save(0, 'light')).status, 409);
    const race = await Promise.all([save(1, 'light'), save(1, 'system')]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    assert.equal((await (await fixture.request(path, { token })).json<{revision: number}>()).revision, 2);
    assert.equal((await fixture.db.prepare('SELECT count(*) AS n FROM operator_workspace_state').first<{n: number}>())?.n, 0,
      'Changing theme never overwrites ticket navigation preferences');
    const p = fixture.principals.operatorA;
    const repository = new OperatorWorkspaceRepository(createVerifiedTenantScope(p.tenantId, p.localId, ['admin'], 1), fixture.db);
    const payload = decodeJwt(token);
    const credential = { role: 'admin' as const, sessionVersion: Number(payload.session_version ?? 0), expiresAt: Number(payload.exp) };
    assert.equal(await repository.saveThemePreference({ expectedRevision: 2, mode: 'dark' }, { ...credential, expiresAt: 0 }), null);
    await fixture.revokePrincipalSessions('operatorA');
    assert.equal(await repository.getThemePreference(credential), null);
    assert.equal(await repository.saveThemePreference({ expectedRevision: 2, mode: 'dark' }, credential), null,
      'Revocation after request authorization still prevents the SQL write');
    assert.equal((await fixture.request(path, { token })).status, 401);
    assert.equal((await save(0, 'dark', other)).status, 200);
  });
});

test('local-beta theme writes share bounded mutation accounting and stop policy', async () => {
  await withTwoTenantFixture(async fixture => {
    const token = await login(fixture, 'operatorA');
    await guardedFixture(fixture, { ticketLimit: 2, mutationLimit: 2, recoveryReserve: 1, uploadLimit: 2 });
    const path = '/api/workspace/theme-preference';
    const save = (revision: number) => fixture.request(path, { method: 'PUT', token, body: { expectedRevision: revision, mode: 'dark' } });
    assert.equal((await fixture.request('/api/settings/theme', { token })).status, 200);
    assert.equal((await save(0)).status, 200);
    assert.equal((await betaCounters(fixture))?.mutations, 1);
    assert.equal((await save(0)).status, 409);
    assert.equal((await betaCounters(fixture))?.mutations, 1, 'A rejected CAS does not spend a mutation');
    assert.equal((await save(1)).status, 200);
    assert.equal((await save(2)).status, 429);
    assert.equal((await betaCounters(fixture))?.mutations, 2);
    await fixture.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    assert.equal((await save(2)).status, 503);
    assert.equal((await betaCounters(fixture))?.mutations, 2);
    const stored = await fixture.db.prepare('SELECT revision,mode FROM operator_theme_preference').first();
    assert.deepEqual(stored, { revision: 2, mode: 'dark' });
  });
});
