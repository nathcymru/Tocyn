import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { initializeLocalBetaFixture } from './local-beta-fixture';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';
import { TenantAttachmentStorage } from '../src/storage/adapters';
import { OperatorWorkspaceService } from '../src/services/operator-workspace.service';
import { LOCAL_DRAFT_RETENTION, LOCAL_DRAFT_RETENTION_MS } from '../src/types/operator-draft-retention';
import type { TenantRequestDeps } from '../src/middleware/tenant.middleware';
import { LocalBetaOperator } from './local-beta-operator';

test('48-hour rolling expiry is actor-scoped, exact, refreshable and cannot revive an expired version', async () => {
  await withTwoTenantFixture(async fixture => {
    let now = new Date('2030-01-01T00:00:00.000Z');
    const scope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 1);
    const otherScope = createVerifiedTenantScope(fixture.principals.operatorB.tenantId, fixture.principals.operatorB.localId, ['admin'], 1);
    const repositories = createRepositories(scope, fixture.db);
    const otherRepositories = createRepositories(otherScope, fixture.db);
    const storage = new TenantAttachmentStorage(scope, fixture.r2.bucket);
    const service = new OperatorWorkspaceService({ scope, repositories, attachmentStorage: storage } as TenantRequestDeps,
      { now: () => now, retention: LOCAL_DRAFT_RETENTION });
    const reference = { storageKey: `agent-attachments/${scope.actorId}/retained.txt`, filename: 'retained.txt' };
    await storage.putAttachment(reference.storageKey, new TextEncoder().encode('synthetic attachment'), { httpMetadata: { contentType: 'text/plain' } });
    const input = { ticketId: 'fixture-ticket', expectedGeneration: null, expectedRevision: 0, mode: 'internal' as const, body: 'synthetic draft', attachments: [reference] };
    const first = await service.saveDraft(input);
    assert.equal(first.expiresAt, '2030-01-03T00:00:00.000Z');
    await otherRepositories.operatorWorkspace.saveDraft({ ...input, attachments: [], expiresAt: first.expiresAt });
    now = new Date('2030-01-02T23:00:00.000Z');
    const refreshed = await service.saveDraft({ ...input, body: 'later edit', expectedGeneration: first.generation, expectedRevision: first.revision });
    assert.equal(refreshed.expiresAt, '2030-01-04T23:00:00.000Z');
    now = new Date('2030-01-04T22:59:59.999Z');
    assert.equal((await service.getDraft(input.ticketId))?.body, 'later edit');
    now = new Date('2030-01-04T23:00:00.000Z');
    const otherStored = await otherRepositories.operatorWorkspace.getDraft(input.ticketId);
    assert.ok(otherStored);
    assert.equal(await otherRepositories.operatorWorkspace.saveDraft({ ...input, attachments: [],
      expectedGeneration: otherStored.generation, expectedRevision: otherStored.revision,
      expiresAt: LOCAL_DRAFT_RETENTION.expiresAt(now), notExpiredAt: now.toISOString() }), null,
    'An expired row cannot be refreshed while awaiting physical cleanup');
    assert.equal((await otherRepositories.operatorWorkspace.listDrafts('', 50, now.toISOString())).items.length, 0,
      'Expired rows awaiting cleanup cannot appear in Draft indicators');
    assert.equal(await service.getDraft(input.ticketId), null);
    assert.equal(await repositories.operatorWorkspace.getDraft(input.ticketId), null, 'Expired actor row was physically removed');
    assert.ok(await otherRepositories.operatorWorkspace.getDraft(input.ticketId), 'Actor cleanup never deletes another tenant row');
    await assert.rejects(service.saveDraft({ ...input, expectedGeneration: refreshed.generation, expectedRevision: refreshed.revision }), { status: 409 });
    const replacement = await service.saveDraft(input);
    assert.notEqual(replacement.generation, first.generation);
    await service.purgeExpired();
    assert.equal((await service.getDraft(input.ticketId))?.generation, replacement.generation);
    const attachment = await storage.getAttachment(reference.storageKey);
    assert.ok(attachment, 'Draft expiry must not delete shared attachment objects');
    await attachment.body.cancel();
  });
});

test('only the initialized local-beta profile activates route expiry, including older null-expiry drafts', async () => {
  await withTwoTenantFixture(async fixture => {
    const challenge = await (await fixture.login('operatorA')).json<{ token: string }>();
    const session = await (await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode('operatorA') } })).json<{ token: string }>();
    const body = { expectedGeneration: null, expectedRevision: 0, mode: 'internal', body: 'legacy synthetic', attachments: [] };
    const legacy = await fixture.request('/api/workspace/drafts/fixture-ticket', { method: 'PUT', token: session.token, body });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json<{ expiresAt: string | null }>()).expiresAt, null);
    await fixture.db.prepare("UPDATE operator_drafts SET updated_at='2020-01-01T00:00:00.000Z'").run();
    assert.equal((await fixture.request('/api/workspace/drafts/fixture-ticket', { token: session.token })).status, 200, 'Non-beta profile remains unchanged');
    await initializeLocalBetaFixture(fixture, {
      runId: 'retention-proof', tenants: [fixture.principals.operatorA.tenantId, fixture.principals.operatorB.tenantId],
      invitations: Object.values(fixture.principals).map(p => ({ tenantId: p.tenantId, id: p.localId, kind: p.role === 'customer' ? 'customer' : 'staff' })),
    });
    assert.equal((await fixture.request('/api/workspace/drafts/fixture-ticket', { token: session.token })).status, 204);
    const started = Date.now();
    const saved = await fixture.request('/api/workspace/drafts/fixture-ticket', { method: 'PUT', token: session.token, body });
    assert.equal(saved.status, 200);
    const expires = Date.parse((await saved.json<{ expiresAt: string }>()).expiresAt);
    assert.ok(expires >= started + LOCAL_DRAFT_RETENTION_MS && expires <= Date.now() + LOCAL_DRAFT_RETENTION_MS);
    await fixture.db.prepare("UPDATE operator_drafts SET expires_at='2020-01-01T00:00:00.000Z'").run();
    await fixture.revokePrincipalSessions('operatorA');
    assert.equal((await fixture.request('/api/workspace/drafts/fixture-ticket', { token: session.token })).status, 401);
    assert.equal((await fixture.db.prepare('SELECT count(*) AS count FROM operator_drafts').first<{ count: number }>())?.count, 1,
      'Unauthorized requests must not invoke actor cleanup');
  });
});

test('local timer cleanup is bounded to100 rows and the current two tenants, retaining newer rows', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE local_beta_policy(singleton INTEGER PRIMARY KEY,run_id TEXT);
      CREATE TABLE local_beta_tenants(run_id TEXT,tenant_id TEXT);
      CREATE TABLE operator_drafts(tenant_id TEXT,expires_at TEXT,updated_at TEXT,body TEXT);
      INSERT INTO local_beta_policy VALUES(1,'run');
      INSERT INTO local_beta_tenants VALUES('run','a'),('run','b');`);
    const insert = db.prepare('INSERT INTO operator_drafts VALUES(?,?,?,?)');
    for (let i = 0; i < 101; i++) insert.run(i % 2 ? 'a' : 'b', null, '2030-01-01T00:00:00.000Z', 'expired');
    insert.run('outside', null, '2030-01-01T00:00:00.000Z', 'outside');
    insert.run('a', '2030-01-04T00:00:00.000Z', '2030-01-02T00:00:00.000Z', 'newer');
    const operator = new LocalBetaOperator(db);
    assert.equal(operator.purgeExpiredDrafts(new Date('2030-01-02T23:59:59.999Z')), 0);
    assert.equal(operator.purgeExpiredDrafts(new Date('2030-01-03T00:00:00.000Z')), 100);
    assert.equal(operator.purgeExpiredDrafts(new Date('2030-01-03T00:00:00.000Z')), 1);
    assert.deepEqual(db.prepare('SELECT body FROM operator_drafts ORDER BY body').all(), [{ body: 'newer' }, { body: 'outside' }]);
    assert.throws(() => operator.purgeExpiredDrafts(new Date(), 101));
    assert.throws(() => operator.purgeExpiredDrafts(new Date('invalid')));
  } finally { db.close(); }
});

test('explicit rebase preserves the exact retained draft only when the reviewed full revision is still current', async () => {
  await withTwoTenantFixture(async fixture => {
    let now = new Date('2030-02-01T00:00:00.000Z');
    const scope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 1);
    const repositories = createRepositories(scope, fixture.db);
    const service = new OperatorWorkspaceService({ scope, repositories,
      attachmentStorage: new TenantAttachmentStorage(scope, fixture.r2.bucket) } as TenantRequestDeps,
    { now: () => now, retention: LOCAL_DRAFT_RETENTION });
    const saved = await service.saveDraft({ ticketId: 'fixture-ticket', expectedGeneration: null, expectedRevision: 0,
      mode: 'internal', body: 'retain body', bodyFormat: 'markdown-v1', attachments: [] });
    const insertEvent = async (sequence: number, kind: 'ticket.state_changed' | 'message.reply') => fixture.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES (?,?,?,?,?,'staff',?,'mfa-staff','dashboard','internal','{}')`).bind(scope.tenantId,crypto.randomUUID(),'fixture-ticket',sequence,kind,scope.actorId).run();
    await insertEvent(1, 'ticket.state_changed');
    const rebased = await service.rebaseDraft({ ticketId: saved.ticketId, expectedGeneration: saved.generation,
      expectedRevision: saved.revision, expectedReviewedConversationRevision: 1 });
    assert.equal(rebased.baseConversationRevision, 1);
    assert.equal(rebased.revision, saved.revision + 1);
    assert.deepEqual({ body: rebased.body, mode: rebased.mode, bodyFormat: rebased.bodyFormat, attachments: rebased.attachments },
      { body: saved.body, mode: saved.mode, bodyFormat: saved.bodyFormat, attachments: saved.attachments });

    await insertEvent(2, 'message.reply');
    const before = await repositories.operatorWorkspace.getDraft('fixture-ticket', now.toISOString());
    await assert.rejects(service.rebaseDraft({ ticketId: saved.ticketId, expectedGeneration: rebased.generation,
      expectedRevision: rebased.revision, expectedReviewedConversationRevision: 1 }), { status: 409 });
    assert.deepEqual(await repositories.operatorWorkspace.getDraft('fixture-ticket', now.toISOString()), before,
      'A stale review does not modify a newer retained draft');

    const current = await service.rebaseDraft({ ticketId: saved.ticketId, expectedGeneration: rebased.generation,
      expectedRevision: rebased.revision, expectedReviewedConversationRevision: 2 });
    await assert.rejects(service.rebaseDraft({ ticketId: saved.ticketId, expectedGeneration: rebased.generation,
      expectedRevision: rebased.revision, expectedReviewedConversationRevision: 2 }), { status: 409 });
    assert.equal((await repositories.operatorWorkspace.getDraft('fixture-ticket', now.toISOString()))?.revision, current.revision,
      'Generation and revision CAS prevents a stale rebase from replacing the winner');

    now = new Date('2030-02-03T00:00:00.000Z');
    await assert.rejects(service.rebaseDraft({ ticketId: saved.ticketId, expectedGeneration: current.generation,
      expectedRevision: current.revision, expectedReviewedConversationRevision: 2 }), { status: 409 });
  });
});
