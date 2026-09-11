import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { type FixtureResponse, type LocalTenantFixture, withTwoTenantFixture } from './local-tenant-fixture';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { createVerifiedTenantScope } from '../src/auth/scope';

type Session = Readonly<{ id: string; token: string }>;

async function expectStatus(response: FixtureResponse, expected: number, reason: string): Promise<void> {
  if (response.status === expected) return;
  const body = await response.text();
  assert.fail(`${reason}: expected ${expected}, received ${response.status}: ${body}`);
}

async function operatorSession(fixture: LocalTenantFixture, operator: 'operatorA' | 'operatorB'): Promise<Session> {
  const login = await fixture.login(operator);
  await expectStatus(login, 200, 'Synthetic operator login must succeed');
  const challenge = await login.json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true, 'The fixture keeps the real MFA gate enabled');
  assert.equal(typeof challenge.token, 'string');
  const verified = await fixture.request('/api/auth/mfa/verify', {
    method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
  });
  await expectStatus(verified, 200, 'Synthetic MFA must mint an authenticated dashboard session');
  const result = await verified.json<{ token?: string; user?: { id?: string } }>();
  assert.equal(typeof result.token, 'string');
  assert.equal(typeof result.user?.id, 'string');
  return { id: result.user!.id!, token: result.token! };
}

async function initializeGuardedCombinedFixture(fixture: LocalTenantFixture, extraAgent: Session): Promise<void> {
  await initializeLocalBetaFixture(fixture, {
    runId: 'combined-collision-runtime',
    tenants: [fixture.principals.customerA.tenantId, fixture.principals.customerB.tenantId],
    invitations: [
      ...Object.values(fixture.principals).map(principal => ({
        tenantId: principal.tenantId, id: principal.localId, kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
      })),
      { tenantId: fixture.principals.operatorA.tenantId, id: extraAgent.id, kind: 'staff' },
    ],
    limits: { ticketLimit: 2, mutationLimit: 12, recoveryReserve: 2, uploadLimit: 2 },
  });
}

test('guarded combined local fixture enforces collision preconditions, retains drafts, and keeps off/API-only capabilities truthful', async () => {
  await withTwoTenantFixture(async fixture => {
    const operatorA = await operatorSession(fixture, 'operatorA');
    const operatorB = await operatorSession(fixture, 'operatorB');
    const colleagueA = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
    await initializeGuardedCombinedFixture(fixture, colleagueA);

    const off = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: operatorA.token });
    await expectStatus(off, 200, 'The guarded off profile keeps the authorized capability route readable');
    assert.equal((await off.json<{ collision?: unknown }>()).collision, undefined, 'Off policy must not advertise collision safety');

    await fixture.enableApiTicketAdmission();
    const apiOnly = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: operatorA.token });
    await expectStatus(apiOnly, 200, 'API-only profile keeps the authorized capability route readable');
    assert.equal((await apiOnly.json<{ collision?: unknown }>()).collision, undefined, 'API-only policy must not advertise staff collision safety');

    await fixture.enableCombinedTicketAdmission();
    const authority = await new BudgetAuthorityRepository(fixture.db).resolveForVerifiedPrincipal(
      createVerifiedTenantScope(fixture.principals.operatorA.tenantId, colleagueA.id, ['agent'], 1),
      { kind: 'session', sessionVersion: 1 }, Date.now(),
    );
    assert.equal(authority.kind, 'active', 'The second local operator must resolve the same bounded two-tenant authority');
    const capability = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: operatorA.token });
    await expectStatus(capability, 200, 'Combined policy exposes collision capability only to an authorized operator');
    const advertised = await capability.json<{ collision?: { version?: number; conversationRevision?: number } }>();
    assert.deepEqual(advertised.collision, { version: 1, protocol: 'draft-precondition-v1', conversationRevision: 0 });

    const foreignCapability = await fixture.request('/api/tickets/fixture-ticket/reply-capability', { token: operatorB.token });
    await expectStatus(foreignCapability, 200, 'A second tenant can address its own colliding ticket identifier');
    assert.deepEqual((await foreignCapability.json<{ collision?: { conversationRevision?: number } }>()).collision,
      { version: 1, protocol: 'draft-precondition-v1', conversationRevision: 0 }, 'Tenant B never receives Tenant A revision state');

    const draft = await fixture.request('/api/workspace/drafts/fixture-ticket', {
      method: 'PUT', token: operatorA.token,
      body: { expectedGeneration: null, expectedRevision: 0, mode: 'public', body: 'Retain this exact stale draft', bodyFormat: 'markdown-v1', attachments: [] },
    });
    await expectStatus(draft, 200, 'The admitted local operator may save a preconditioned draft');
    const saved = await draft.json<{ generation: string; revision: number; baseConversationRevision: number; body: string }>();
    assert.equal(saved.baseConversationRevision, 0);

    const colleagueReply = await fixture.request('/api/tickets/fixture-ticket/articles', {
      method: 'POST', token: colleagueA.token, idempotencyKey: 'combined-colleague-message',
      body: { body: 'A colleague wrote new material', body_format: 'markdown-v1', is_internal: false, attachments: [] },
    });
    await expectStatus(colleagueReply, 201, 'A separate current tenant agent may create the intervening material reply');

    const stale = await fixture.request('/api/tickets/fixture-ticket/articles', {
      method: 'POST', token: operatorA.token, idempotencyKey: 'combined-stale-reply',
      body: { body: saved.body, body_format: 'markdown-v1', is_internal: false, attachments: [], draft: {
        generation: saved.generation, revision: saved.revision, baseConversationRevision: saved.baseConversationRevision,
      } },
    });
    await expectStatus(stale, 409, 'An acknowledged draft must fail closed when new material arrives');
    assert.equal((await stale.json<{ code?: string }>()).code, 'staff_reply_stale');
    const retained = await fixture.request('/api/workspace/drafts/fixture-ticket', { token: operatorA.token });
    await expectStatus(retained, 200, 'A stale response retains the saved operator draft');
    assert.equal((await retained.json<{ body?: string }>()).body, saved.body);
    assert.equal((await fixture.db.prepare(`SELECT count(*) AS count FROM articles WHERE tenant_id=? AND body=?`)
      .bind(fixture.principals.operatorA.tenantId, saved.body).first<{ count: number }>())?.count, 0,
      'The stale denial commits no article side effect');

    const rebased = await fixture.request('/api/workspace/drafts/fixture-ticket/rebase', {
      method: 'POST', token: operatorA.token, body: {
        expectedGeneration: saved.generation, expectedRevision: saved.revision, expectedReviewedConversationRevision: 1,
      },
    });
    await expectStatus(rebased, 200, 'An explicit review with the current full conversation revision may rebase');
    const reviewed = await rebased.json<{ generation: string; revision: number; baseConversationRevision: number; body: string }>();
    assert.equal(reviewed.body, saved.body, 'Rebase does not replace the reviewed draft text');
    assert.equal(reviewed.baseConversationRevision, 1);

    const sent = await fixture.request('/api/tickets/fixture-ticket/articles', {
      method: 'POST', token: operatorA.token, idempotencyKey: 'combined-reviewed-send',
      body: { body: reviewed.body, body_format: 'markdown-v1', is_internal: false, attachments: [], draft: {
        generation: reviewed.generation, revision: reviewed.revision, baseConversationRevision: reviewed.baseConversationRevision,
      } },
    });
    await expectStatus(sent, 201, 'Manual post-review send succeeds with the new draft acknowledgement');
    assert.equal((await fixture.db.prepare(`SELECT count(*) AS count FROM articles WHERE tenant_id=? AND body=?`)
      .bind(fixture.principals.operatorA.tenantId, reviewed.body).first<{ count: number }>())?.count, 1);
  });
});
