import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { OperatorActivityRepository, OperatorActivityConflictError } from '../src/repositories/operator-activity.repository';
import { OperatorActivityService } from '../src/services/operator-activity.service';
import type { TenantRequestDeps } from '../src/middleware/tenant.middleware';
import type { ActivityPresentationCredential, TrustedActivityAppend } from '../src/types/operator-activity';
import { withTwoTenantFixture } from './local-tenant-fixture';

const futureExpiry = Math.floor(Date.now() / 1000) + 3600;

function credential(sessionVersion = 0, role: 'admin' | 'agent' = 'admin'): ActivityPresentationCredential {
  return { sessionVersion, expiresAt: futureExpiry, role, mfaVerified: true };
}

function append(overrides: Partial<TrustedActivityAppend> = {}): TrustedActivityAppend {
  return {
    id: 'activity-mention-1', ticketId: 'fixture-ticket', recipientUserId: 'fixture-operator', kind: 'mention',
    sourceId: 'conversation-event-1', producer: { kind: 'staff', id: 'fixture-operator' }, facts: { reason: 'mention' },
    ...overrides,
  };
}

test('durable activity is tenant/recipient-scoped, bounded, source-idempotent, and CAS-protected', async () => {
  await withTwoTenantFixture(async fixture => {
    const scopeA = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const scopeB = createVerifiedTenantScope(fixture.principals.operatorB.tenantId, fixture.principals.operatorB.localId, ['admin'], 0);
    const activitiesA = new OperatorActivityRepository(scopeA, fixture.db);
    const activitiesB = new OperatorActivityRepository(scopeB, fixture.db);
    const serviceA = new OperatorActivityService({ scope: scopeA, operatorActivity: activitiesA } as TenantRequestDeps);

    const created = await serviceA.appendTrusted(append());
    assert.ok(created && !created.idempotent);
    assert.equal((await activitiesB.listForRecipient({ limit: 50 }, credential()))?.items.length, 0,
      'the same local ticket/recipient IDs in tenant B cannot read tenant A activity');

    const replay = await serviceA.appendTrusted(append());
    assert.equal(replay?.idempotent, true);
    assert.equal(replay?.activity.id, created.activity.id);
    await assert.rejects(serviceA.appendTrusted(append({ facts: { reason: 'different' } })), OperatorActivityConflictError);

    const secondRecipient = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
    const secondScope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, secondRecipient.id, ['agent'], 0);
    const secondActivities = new OperatorActivityRepository(secondScope, fixture.db);
    const secondService = new OperatorActivityService({ scope: secondScope, operatorActivity: secondActivities } as TenantRequestDeps);
    const secondProjection = await secondService.appendTrusted(append({
      id: 'activity-second-recipient', recipientUserId: secondRecipient.id,
    }));
    assert.equal(secondProjection?.idempotent, false, 'one canonical source can project to another authorized actor');
    assert.equal((await secondService.list({ limit: 10 }, credential(0, 'agent')))?.items.length, 1);
    await assert.rejects(secondService.appendTrusted(append({
      id: 'activity-second-recipient-conflict', recipientUserId: secondRecipient.id, facts: { reason: 'changed' },
    })), OperatorActivityConflictError, 'a conflicting replay is rejected per recipient');

    const batchAppend = await serviceA.prepareTrustedAppend(append({ id: 'activity-batched', sourceId: 'canonical-event-batched' }));
    const batchResult = await fixture.db.batch([batchAppend.statement]);
    assert.equal((batchResult[0].results?.[0] as { id?: string } | undefined)?.id, 'activity-batched',
      'a producer can add the validated activity statement to its own canonical D1 transaction');
    const subjectBeforeConflict = (await fixture.db.prepare('SELECT subject FROM tickets WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.operatorA.tenantId, 'fixture-ticket').first<{ subject: string }>())?.subject;
    const conflictingBatchAppend = await serviceA.prepareTrustedAppend(append({
      id: 'activity-batch-conflict', facts: { reason: 'conflicting-canonical-retry' },
    }));
    await assert.rejects(fixture.db.batch([
      fixture.db.prepare('UPDATE tickets SET subject=? WHERE tenant_id=? AND id=?').bind('must roll back', fixture.principals.operatorA.tenantId, 'fixture-ticket'),
      conflictingBatchAppend.statement,
    ]), /operator_activity_receipt_conflict/);
    assert.equal((await fixture.db.prepare('SELECT subject FROM tickets WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.operatorA.tenantId, 'fixture-ticket').first<{ subject: string }>())?.subject, subjectBeforeConflict,
    'a conflicting activity receipt rolls back the canonical D1 batch instead of being silently ignored');

    const concurrent = await Promise.all(Array.from({ length: 4 }, () => serviceA.appendTrusted(append({
      id: 'activity-concurrent', sourceId: 'conversation-event-concurrent',
    }))));
    assert.ok(concurrent.every(result => result?.activity.id === 'activity-concurrent'));
    assert.equal((await serviceA.list({ limit: 50 }, credential()))?.items.length, 3,
      'concurrent replay must not create duplicate durable activity');

    const page = await serviceA.list({ limit: 1 }, credential());
    assert.ok(page && page.next);
    const second = await serviceA.list({ limit: 1, cursor: page.next }, credential());
    assert.equal(second?.items.length, 1);
    await assert.rejects(serviceA.list({ limit: 51 }, credential()));
    await assert.rejects(serviceA.list({ limit: 1, cursor: 'not-a-cursor' }, credential()));
    await assert.rejects(serviceA.appendTrusted(append({ id: 'bad id' })));
    await assert.rejects(serviceA.appendTrusted(append({ id: 'activity-bounds', sourceId: 'source-bounds', facts: { body: 'x'.repeat(257) } })));
    await assert.rejects(serviceA.appendTrusted(append({ id: 'activity-kind', sourceId: 'source-kind', kind: 'unknown' as any })));

    const firstRead = await serviceA.markRead(created.activity.id, created.activity.revision, credential());
    assert.equal(firstRead?.revision, 2);
    assert.equal(await serviceA.markRead(created.activity.id, created.activity.revision, credential()), null,
      'an old read revision cannot overwrite the first reader');
    const dismissed = await serviceA.dismiss(firstRead!.id, firstRead!.revision, credential());
    assert.equal(dismissed?.revision, 3);
    assert.deepEqual(await serviceA.unreadCount(credential()), { status: 'available', count: 2 }, 'read or dismissed rows do not contribute to unread count');
  });
});

test('activity checks current staff session and ticket group access, and follows ticket/user lifecycle', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const adminScope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const adminActivities = new OperatorActivityRepository(adminScope, fixture.db);
    const adminService = new OperatorActivityService({ scope: adminScope, operatorActivity: adminActivities } as TenantRequestDeps);
    const created = await adminService.appendTrusted(append({ id: 'activity-lifecycle', sourceId: 'source-lifecycle' }));
    assert.ok(created);
    await fixture.revokePrincipalSessions('operatorA');
    assert.equal(await adminService.list({ limit: 10 }, credential()), null, 'revoked session is fail-closed for reads');
    assert.equal(await adminService.dismiss(created.activity.id, created.activity.revision, credential()), null, 'revoked session is fail-closed for writes');

    const agent = await fixture.createAgentSession(tenantId);
    await fixture.db.prepare('INSERT INTO groups (tenant_id,id,name) VALUES (?,?,?)').bind(tenantId, 'activity-group', 'Activity group').run();
    await fixture.db.prepare('UPDATE tickets SET group_id=? WHERE tenant_id=? AND id=?').bind('activity-group', tenantId, 'fixture-ticket').run();
    await fixture.db.prepare('INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,?)').bind(tenantId, agent.id, 'activity-group').run();
    const agentScope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 0);
    const agentActivities = new OperatorActivityRepository(agentScope, fixture.db);
    const agentService = new OperatorActivityService({ scope: agentScope, operatorActivity: agentActivities } as TenantRequestDeps);
    const agentCreated = await agentService.appendTrusted(append({
      id: 'activity-agent', sourceId: 'source-agent', recipientUserId: agent.id, producer: { kind: 'system' },
    }));
    assert.ok(agentCreated);
    assert.equal((await agentService.list({ limit: 10 }, credential(0, 'agent')))?.items.length, 1);
    await fixture.db.prepare('DELETE FROM user_groups WHERE tenant_id=? AND user_id=? AND group_id=?').bind(tenantId, agent.id, 'activity-group').run();
    assert.equal(await agentService.list({ limit: 10 }, credential(1, 'agent')), null,
      'a scope carrying the pre-revocation session version is fail-closed');
    const refreshedAgentScope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 1);
    const refreshedAgentService = new OperatorActivityService({ scope: refreshedAgentScope,
      operatorActivity: new OperatorActivityRepository(refreshedAgentScope, fixture.db) } as TenantRequestDeps);
    assert.equal((await refreshedAgentService.list({ limit: 10 }, credential(1, 'agent')))?.items.length, 0,
      'a current but no-longer-member agent cannot retain activity through the old group');

    await fixture.db.prepare("UPDATE users SET role='customer' WHERE tenant_id=? AND id=?").bind(tenantId, fixture.principals.operatorA.localId).run();
    await assert.rejects(adminService.appendTrusted(append()), /operator_activity_recipient_unavailable/,
      'a trusted replay cannot return existing activity after the recipient loses current staff authority');
    await fixture.db.prepare('DELETE FROM tickets WHERE tenant_id=? AND id=?').bind(tenantId, 'fixture-ticket').run();
    assert.equal((await fixture.db.prepare('SELECT count(*) AS count FROM operator_activities WHERE tenant_id=?').bind(tenantId).first<{ count: number }>())?.count, 0,
      'ticket deletion cascades its activity projection without inventing an independent retention period');
    await assert.rejects(adminActivities.appendTrusted(append({ id: 'activity-deleted', sourceId: 'source-deleted' })),
      /operator_activity_recipient_unavailable/, 'a trusted producer cannot append against a deleted ticket or inactive recipient');
  });
});

test('staff provenance is redacted without converting it to system work, and its hashed receipt remains replay-safe', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const scope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const activities = new OperatorActivityRepository(scope, fixture.db);
    const service = new OperatorActivityService({ scope, operatorActivity: activities } as TenantRequestDeps);
    const producer = await fixture.createAgentSession(tenantId);
    await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES (?,?,?,?,?)')
      .bind(tenantId, 'producer-ticket', 'Producer lifecycle ticket', fixture.principals.customerA.email, 'fixture').run();
    const input = append({ id: 'activity-deleted-producer', ticketId: 'producer-ticket', sourceId: 'source-deleted-producer',
      producer: { kind: 'staff', id: producer.id } });
    assert.ok(await service.appendTrusted(input));
    await fixture.db.prepare('DELETE FROM users WHERE tenant_id=? AND id=?').bind(tenantId, producer.id).run();
    assert.deepEqual(await fixture.db.prepare(`SELECT producer_kind,producer_id FROM operator_activities
      WHERE tenant_id=? AND id=?`).bind(tenantId, input.id).first(), { producer_kind: 'staff', producer_id: null });
    const listed = await service.list({ limit: 10 }, credential());
    const projected = listed?.items.find(item => item.id === input.id);
    assert.deepEqual(projected?.producer, { kind: 'staff', id: null });
    assert.equal((await service.appendTrusted(input))?.idempotent, true, 'the original fingerprint still replays after producer redaction');
    await assert.rejects(service.appendTrusted(append({ ...input, id: 'activity-deleted-producer-conflict', facts: { reason: 'changed-after-redaction' } })),
      OperatorActivityConflictError, 'a changed fact fingerprint is still a conflict after producer redaction');
  });
});

test('candidate caps make a large inaccessible backlog explicitly unavailable and use recipient indexes', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const writerScope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const writer = new OperatorActivityRepository(writerScope, fixture.db);
    const agent = await fixture.createAgentSession(tenantId);
    await fixture.db.prepare('INSERT INTO groups (tenant_id,id,name) VALUES (?,?,?)').bind(tenantId, 'activity-backlog-group', 'Activity backlog group').run();
    await fixture.db.prepare('INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,?)').bind(tenantId, agent.id, 'activity-backlog-group').run();
    for (let index = 0; index <= 100; index++) {
      const ticketId = `backlog-ticket-${index}`;
      await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES (?,?,?,?,?,?)')
        .bind(tenantId, ticketId, `Backlog ${index}`, fixture.principals.customerA.email, 'activity-backlog-group', 'fixture').run();
      assert.ok(await writer.appendTrusted(append({ id: `backlog-activity-${index}`, ticketId, recipientUserId: agent.id,
        sourceId: `backlog-source-${index}`, kind: 'assignment', producer: { kind: 'system' }, facts: { backlog: index } })));
    }
    await fixture.db.prepare('DELETE FROM user_groups WHERE tenant_id=? AND user_id=? AND group_id=?').bind(tenantId, agent.id, 'activity-backlog-group').run();
    const scope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 1);
    const service = new OperatorActivityService({ scope, operatorActivity: new OperatorActivityRepository(scope, fixture.db) } as TenantRequestDeps);
    assert.deepEqual(await service.list({ limit: 10 }, credential(1, 'agent')),
      { status: 'unavailable', reason: 'recipient_activity_candidate_cap_exceeded', items: [], next: null });
    assert.deepEqual(await service.unreadCount(credential(1, 'agent')),
      { status: 'unavailable', reason: 'recipient_activity_candidate_cap_exceeded', count: null });
    const plan = await fixture.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM operator_activities
      WHERE tenant_id=? AND recipient_user_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
      .bind(tenantId, agent.id, 101).all<{ detail: string }>();
    assert.ok((plan.results ?? []).some(row => row.detail.includes('idx_operator_activities_recipient_created')),
      'bounded activity candidates use the tenant/recipient/created index');
    const unreadPlan = await fixture.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM operator_activities
      WHERE tenant_id=? AND recipient_user_id=? AND read_at IS NULL AND dismissed_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT ?`).bind(tenantId, agent.id, 101).all<{ detail: string }>();
    assert.ok((unreadPlan.results ?? []).some(row => row.detail.includes('idx_operator_activities_recipient_unread')),
      'bounded unread candidates use the unread partial index');
  });
});
