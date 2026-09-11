import assert from 'node:assert/strict';
import test from 'node:test';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { EncryptJWT } from 'jose';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { OperatorActivityRepository, OperatorActivityConflictError } from '../src/repositories/operator-activity.repository';
import { OperatorActivityService } from '../src/services/operator-activity.service';
import type { TenantRequestDeps } from '../src/middleware/tenant.middleware';
import type { ActivityPresentationCredential, TrustedActivityAppend } from '../src/types/operator-activity';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';

const cursorSecret = 'synthetic-activity-cursor-secret-for-local-tests';
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

async function operatorToken(fixture: LocalTenantFixture, principal: 'operatorA' | 'operatorB' = 'operatorA'): Promise<string> {
  const challenge = await (await fixture.login(principal)).json<{ token?: string; mfa_required?: boolean }>();
  assert.equal(challenge.mfa_required, true);
  assert.ok(challenge.token);
  const verified = await fixture.request('/api/auth/mfa/verify', { method: 'POST', token: challenge.token,
    body: { code: fixture.currentMfaCode(principal) } });
  assert.equal(verified.status, 200);
  const body = await verified.json<{ token?: string }>();
  assert.ok(body.token);
  return body.token;
}

type QueryObservation = { sql: string; values: unknown[]; rowsRead: number };

/** Observe the actual native D1 statement and metadata without substituting its result or authority. */
function observeDatabase(db: D1Database, observations: QueryObservation[], after?: (sql: string, method: string, result: unknown) => Promise<void>): D1Database {
  function statement(target: D1PreparedStatement, sql: string, values: unknown[] = []): D1PreparedStatement {
    return new Proxy(target, { get(current, property) {
      if (property === 'bind') return (...bound: unknown[]) => statement(current.bind(...bound), sql, bound);
      const method = Reflect.get(current, property);
      if (typeof method !== 'function') return method;
      return async (...args: unknown[]) => {
        const result = await method.apply(current, args);
        if (sql.startsWith('WITH candidates')) observations.push({ sql, values, rowsRead: result?.meta?.rows_read ?? -1 });
        await after?.(sql, String(property), result);
        return result;
      };
    } });
  }
  return new Proxy(db, { get(target, property) {
    if (property === 'prepare') return (sql: string) => statement(target.prepare(sql), sql);
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test('durable activity is tenant/recipient-scoped, bounded, source-idempotent, and CAS-protected', async () => {
  await withTwoTenantFixture(async fixture => {
    const scopeA = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const scopeB = createVerifiedTenantScope(fixture.principals.operatorB.tenantId, fixture.principals.operatorB.localId, ['admin'], 0);
    const activitiesA = new OperatorActivityRepository(scopeA, fixture.db, cursorSecret);
    const activitiesB = new OperatorActivityRepository(scopeB, fixture.db, cursorSecret);
    const serviceA = new OperatorActivityService({ scope: scopeA, operatorActivity: activitiesA } as TenantRequestDeps);

    const created = await serviceA.appendTrusted(append());
    assert.ok(created && !created.idempotent);
    assert.equal((await activitiesB.listForRecipient({ limit: 50 }, credential()))?.items.length, 0,
      'the same local ticket/recipient IDs in tenant B cannot read tenant A activity');

    const replay = await serviceA.appendTrusted(append());
    assert.equal(replay?.idempotent, true);
    assert.equal(replay?.activity.id, created.activity.id);
    await assert.rejects(serviceA.appendTrusted(append({ facts: { reason: 'different' } })), OperatorActivityConflictError);
    await assert.rejects(serviceA.appendTrusted(append({ id: 'fresh-retry-id' })), OperatorActivityConflictError,
      'a producer must reuse the stable projection ID, not generate a new ID on retry');
    await assert.rejects(serviceA.appendTrusted(append({ sourceId: 'different-source-same-id' })), OperatorActivityConflictError,
      'the tenant activity ID cannot be reused for another canonical source');
    assert.equal(await activitiesB.markRead(created.activity.id, 1, credential()), null);

    const secondRecipient = await fixture.createAgentSession(fixture.principals.operatorA.tenantId);
    const secondScope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, secondRecipient.id, ['agent'], 1);
    const secondActivities = new OperatorActivityRepository(secondScope, fixture.db, cursorSecret);
    const secondService = new OperatorActivityService({ scope: secondScope, operatorActivity: secondActivities } as TenantRequestDeps);
    const secondProjection = await secondService.appendTrusted(append({
      id: 'activity-second-recipient', recipientUserId: secondRecipient.id,
    }));
    assert.equal(secondProjection?.idempotent, false, 'one canonical source can project to another authorized actor');
    assert.equal((await secondService.list({ limit: 10 }, credential(1, 'agent')))?.items.length, 1);
    await assert.rejects(secondService.appendTrusted(append({
      id: 'activity-second-recipient-conflict', recipientUserId: secondRecipient.id, facts: { reason: 'changed' },
    })), OperatorActivityConflictError, 'a conflicting replay is rejected per recipient');

    const batchAppend = await serviceA.prepareTrustedAppend(append({ id: 'activity-batched', sourceId: 'canonical-event-batched' }));
    const batchResult = await fixture.db.batch([batchAppend.statement]);
    assert.equal((batchResult[0].results?.[0] as { id?: string } | undefined)?.id, 'activity-batched',
      'a producer can add the validated activity statement to its own canonical D1 transaction');
    const subjectBeforeConflict = (await fixture.db.prepare('SELECT subject FROM tickets WHERE tenant_id=? AND id=?')
      .bind(fixture.principals.operatorA.tenantId, 'fixture-ticket').first<{ subject: string }>())?.subject;
    for (const conflict of [
      append({ id: 'activity-batch-conflict', facts: { reason: 'conflicting-canonical-retry' } }),
      append({ sourceId: 'different-source-same-id' }),
      append({ id: 'new-id-same-source' }),
      append({ ticketId: 'fixture-b-only' }),
    ]) {
      const conflictingBatchAppend = await serviceA.prepareTrustedAppend(conflict);
      await assert.rejects(fixture.db.batch([
        fixture.db.prepare('UPDATE tickets SET subject=? WHERE tenant_id=? AND id=?').bind('must roll back', fixture.principals.operatorA.tenantId, 'fixture-ticket'),
        conflictingBatchAppend.statement,
      ]), /operator_activity_receipt_conflict|operator_activity_recipient_unavailable/);
      assert.equal((await fixture.db.prepare('SELECT subject FROM tickets WHERE tenant_id=? AND id=?')
        .bind(fixture.principals.operatorA.tenantId, 'fixture-ticket').first<{ subject: string }>())?.subject, subjectBeforeConflict,
      'a conflicting activity receipt rolls back the canonical D1 batch instead of being silently ignored');
    }
    const equalBatchAppend = await serviceA.prepareTrustedAppend(append());
    assert.equal((await fixture.db.batch([equalBatchAppend.statement]))[0].results?.length, 0,
      'an equal canonical receipt is the only ignored append');

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

    const readers = await Promise.all(Array.from({ length: 4 }, () => serviceA.markRead(created.activity.id, created.activity.revision, credential())));
    assert.equal(readers.filter(Boolean).length, 1, 'concurrent CAS readers have exactly one winner');
    const firstRead = readers.find(Boolean);
    assert.equal(firstRead?.revision, 2);
    assert.equal(await serviceA.markRead(created.activity.id, created.activity.revision, credential()), null,
      'an old read revision cannot overwrite the first reader');
    const dismissed = await serviceA.dismiss(firstRead!.id, firstRead!.revision, credential());
    assert.equal(dismissed?.revision, 3);
    assert.deepEqual(await serviceA.unreadCount(credential()), { status: 'available', count: 2 }, 'read or dismissed rows do not contribute to unread count');
  });
});

test('dashboard recovery reads the durable projection and exposes only recipient CAS transitions', async () => {
  await withTwoTenantFixture(async fixture => {
    const scope = createVerifiedTenantScope(fixture.principals.operatorA.tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const repository = new OperatorActivityRepository(scope, fixture.db, cursorSecret);
    await repository.appendTrusted(append({ id: 'activity-route-a', sourceId: 'activity-route-source-a' }));
    const token = await operatorToken(fixture);
    const listed = await fixture.request('/api/activities?limit=20', { token });
    assert.equal(listed.status, 200);
    const body = await listed.json<{ page: { items: Array<{ id: string; revision: number }> }; unread: { status: string; count: number | null } }>();
    const activity = body.page.items.find(item => item.id === 'activity-route-a');
    assert.ok(activity);
    assert.deepEqual(body.unread, { status: 'available', count: 1 });
    const read = await fixture.request(`/api/activities/${activity.id}/read`, { method: 'PATCH', token, body: { expectedRevision: activity.revision } });
    assert.equal(read.status, 200);
    assert.equal((await read.json<{ revision: number }>()).revision, activity.revision + 1);
    assert.equal((await fixture.request(`/api/activities/${activity.id}/dismiss`, { method: 'PATCH', token, body: { expectedRevision: activity.revision } })).status, 404,
      'a stale revision cannot overwrite the winning transition');
    assert.equal((await fixture.request('/api/activities?limit=21', { token })).status, 400);
    assert.equal((await fixture.request('/api/activities?cursor=not-a-cursor', { token })).status, 400);
    const tenantB = await fixture.request('/api/activities?limit=20', { token: await operatorToken(fixture, 'operatorB') });
    assert.equal(tenantB.status, 200);
    assert.equal((await tenantB.json<{ page: { items: unknown[] } }>()).page.items.length, 0, 'same local activity identity cannot cross the tenant boundary');
  });
});

test('activity checks current staff session and ticket group access, and follows ticket/user lifecycle', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const adminScope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const adminActivities = new OperatorActivityRepository(adminScope, fixture.db, cursorSecret);
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
    const agentScope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 1);
    const agentActivities = new OperatorActivityRepository(agentScope, fixture.db, cursorSecret);
    const agentService = new OperatorActivityService({ scope: agentScope, operatorActivity: agentActivities } as TenantRequestDeps);
    const agentCreated = await agentService.appendTrusted(append({
      id: 'activity-agent', sourceId: 'source-agent', recipientUserId: agent.id, producer: { kind: 'system' },
    }));
    assert.ok(agentCreated);
    assert.equal((await agentService.list({ limit: 10 }, credential(1, 'agent')))?.items.length, 1);
    const stalePrepared = await agentService.prepareTrustedAppend(append({ id: 'activity-stale-prepare', sourceId: 'source-stale-prepare',
      recipientUserId: agent.id, producer: { kind: 'system' } }));
    await fixture.db.prepare('DELETE FROM user_groups WHERE tenant_id=? AND user_id=? AND group_id=?').bind(tenantId, agent.id, 'activity-group').run();
    await assert.rejects(fixture.db.batch([
      fixture.db.prepare('UPDATE tickets SET subject=? WHERE tenant_id=? AND id=?').bind('must roll back', tenantId, 'fixture-ticket'),
      stalePrepared.statement,
    ]), /operator_activity_recipient_unavailable/);
    assert.equal((await fixture.db.prepare('SELECT subject FROM tickets WHERE tenant_id=? AND id=?')
      .bind(tenantId, 'fixture-ticket').first<{ subject: string }>())?.subject, 'Fixture ticket A',
      'recipient revocation between preparation and canonical commit rolls back the whole batch');
    assert.equal(await agentService.list({ limit: 10 }, credential(1, 'agent')), null,
      'a scope carrying the pre-revocation session version is fail-closed');
    const refreshedAgentScope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 2);
    const refreshedAgentService = new OperatorActivityService({ scope: refreshedAgentScope,
      operatorActivity: new OperatorActivityRepository(refreshedAgentScope, fixture.db, cursorSecret) } as TenantRequestDeps);
    assert.equal((await refreshedAgentService.list({ limit: 10 }, credential(2, 'agent')))?.items.length, 0,
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
    const activities = new OperatorActivityRepository(scope, fixture.db, cursorSecret);
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

test('bounded pages traverse large authorized and inaccessible history using actual indexed native queries', async t => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const writerScope = createVerifiedTenantScope(tenantId, fixture.principals.operatorA.localId, ['admin'], 0);
    const writer = new OperatorActivityRepository(writerScope, fixture.db, cursorSecret);
    const agent = await fixture.createAgentSession(tenantId);
    await fixture.db.prepare('INSERT INTO groups (tenant_id,id,name) VALUES (?,?,?)').bind(tenantId, 'activity-backlog-group', 'Activity backlog group').run();
    await fixture.db.prepare('INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,?)').bind(tenantId, agent.id, 'activity-backlog-group').run();
    await fixture.db.prepare('INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, 'restricted-backlog-ticket', 'Restricted backlog', fixture.principals.customerA.email, 'activity-backlog-group', 'fixture').run();
    const expectedIds: string[] = [];
    for (let batch = 0; batch < 12; batch++) {
      const statements: D1PreparedStatement[] = [];
      for (let offset = 0; offset < 100; offset++) {
        const index = batch * 100 + offset;
        const restricted = index >= 1000 || (index >= 100 && index < 300);
        const id = `backlog-activity-${String(index).padStart(4, '0')}`;
        if (!restricted) expectedIds.push(id);
        statements.push((await writer.prepareTrustedAppend(append({ id,
          ticketId: restricted ? 'restricted-backlog-ticket' : 'fixture-ticket', recipientUserId: agent.id,
          sourceId: `backlog-source-${index}`, kind: 'assignment', producer: { kind: 'system' }, facts: { backlog: index },
        }))).statement);
      }
      await fixture.db.batch(statements);
    }
    const equalReceipt = await writer.prepareTrustedAppend(append({ id: 'backlog-activity-1199', ticketId: 'restricted-backlog-ticket',
      recipientUserId: agent.id, sourceId: 'backlog-source-1199', kind: 'assignment', producer: { kind: 'system' }, facts: { backlog: 1199 } }));
    const replayResult = await equalReceipt.statement.all();
    assert.equal(replayResult.results.length, 0);
    assert.ok(replayResult.meta.rows_read < 30, `equal replay uses exact identity/source index checks: ${replayResult.meta.rows_read}`);
    // Equal timestamps exercise the composite cursor's ID tie-break, including late index seeks.
    await fixture.db.prepare('UPDATE operator_activities SET created_at=? WHERE tenant_id=?').bind('2026-09-11T00:00:00.000Z', tenantId).run();
    await fixture.db.prepare('DELETE FROM user_groups WHERE tenant_id=? AND user_id=? AND group_id=?').bind(tenantId, agent.id, 'activity-backlog-group').run();
    const scope = createVerifiedTenantScope(tenantId, agent.id, ['agent'], 2);
    const observations: QueryObservation[] = [];
    const service = new OperatorActivityService({ scope,
      operatorActivity: new OperatorActivityRepository(scope, observeDatabase(fixture.db, observations), cursorSecret) } as TenantRequestDeps);
    const first = await service.list({ limit: 50 }, credential(2, 'agent'));
    assert.ok(first?.next);
    assert.deepEqual(first.items, [], 'inaccessible candidate windows expose no activity content');
    assert.equal(first.next.includes('backlog'), false);
    assert.equal(first.next.split('.').length, 5, 'continuation is an authenticated encrypted token');
    const resumed = await new OperatorActivityRepository(scope, fixture.db, cursorSecret)
      .listForRecipient({ limit: 50, cursor: first.next }, credential(2, 'agent'));
    assert.ok(resumed?.next, 'a new repository resumes with the same server key without process-local cursor state');
    assert.deepEqual(resumed.items, []);
    const seen: string[] = [];
    let next: string | null = first.next;
    let emptyPages = 1;
    let pageCount = 1;
    while (next) {
      assert.ok(++pageCount <= 30, 'candidate continuation must make progress');
      const page = await service.list({ limit: 50, cursor: next }, credential(2, 'agent'));
      assert.ok(page);
      assert.ok(page.items.length <= 50);
      seen.push(...page.items.map(item => item.id));
      if (!page.items.length) emptyPages++;
      next = page.next;
    }
    assert.ok(emptyPages >= 3, 'paging progresses across leading and middle inaccessible windows');
    assert.deepEqual(seen, expectedIds.reverse(), 'every trailing authorized row is returned exactly once');
    const pageObservations = [...observations];
    assert.deepEqual(await service.unreadCount(credential(2, 'agent')),
      { status: 'unavailable', reason: 'recipient_activity_candidate_cap_exceeded', count: null });
    // Inspect precisely the SQL and bound values executed by the repository, not simplified facsimiles.
    const firstQuery = observations[0];
    const laterQuery = pageObservations[pageObservations.length - 1];
    assert.ok(observations.length >= pageCount);
    for (const observation of observations) {
      // D1 first() omits metadata; replay its exact unread query with all() to inspect it.
      if (observation.rowsRead < 0) observation.rowsRead = (await fixture.db.prepare(observation.sql).bind(...observation.values).all()).meta.rows_read;
      assert.ok(observation.rowsRead >= 0 && observation.rowsRead <= 750,
        `native D1 rows_read must remain bounded per actual page: ${observation.rowsRead}`);
      const plan = await fixture.db.prepare(`EXPLAIN QUERY PLAN ${observation.sql}`).bind(...observation.values).all<{ detail: string }>();
      const candidatePlan = plan.results?.filter(row => row.detail.includes('idx_operator_activities_recipient_')) ?? [];
      assert.equal(candidatePlan.length, 1);
      assert.ok(candidatePlan[0].detail.includes(observation.sql.includes('a.read_at IS NULL')
        ? 'SEARCH a USING INDEX idx_operator_activities_recipient_unread' : 'SEARCH a USING INDEX idx_operator_activities_recipient_created'), candidatePlan[0].detail);
      if (observation.sql.includes('(a.created_at,a.id)<')) assert.ok(/created_at.*</.test(candidatePlan[0].detail),
        `continuation uses an index seek, not an offset scan of prior candidates: ${candidatePlan[0].detail}`);
    }
    assert.ok(laterQuery.sql.includes('(a.created_at,a.id)<'));
    assert.ok(laterQuery.rowsRead <= firstQuery.rowsRead + 1000);
    t.diagnostic(`1,200 mixed-history rows; ${pageCount} pages; ${seen.length} authorized items; actual page D1 rows_read range ${Math.min(...pageObservations.map(row => row.rowsRead))}–${Math.max(...pageObservations.map(row => row.rowsRead))}`);

    // Cursors are authenticated, purpose-separated and bound to the current tenant, actor and auth version.
    const other = await fixture.createAgentSession(tenantId);
    const cases = [
      new OperatorActivityRepository(createVerifiedTenantScope(tenantId, other.id, ['agent'], 1), fixture.db, cursorSecret),
      new OperatorActivityRepository(createVerifiedTenantScope(fixture.principals.operatorB.tenantId, fixture.principals.operatorB.localId, ['admin'], 0), fixture.db, cursorSecret),
      new OperatorActivityRepository(scope, fixture.db, 'rotated-synthetic-secret'),
    ];
    for (const [index, repository] of cases.entries()) {
      await assert.rejects(repository.listForRecipient({ limit: 50, cursor: first.next }, index === 0 ? credential(1, 'agent') : index === 1 ? credential() : credential(2, 'agent')),
        /restart pagination/);
    }
    const parts = first.next.split('.');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    await assert.rejects(service.list({ limit: 50, cursor: parts.join('.') }, credential(2, 'agent')), /restart pagination/);
    await assert.rejects(service.list({ limit: 50, cursor: 'x'.repeat(2049) }, credential(2, 'agent')), /restart pagination/);
    await assert.rejects(new OperatorActivityRepository(scope, fixture.db).listForRecipient({ limit: 50 }, credential(2, 'agent')), /key unavailable/);
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(cursorSecret), 'HKDF', false, ['deriveBits']);
    const key = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32),
      info: new TextEncoder().encode('tocyn-operator-activity-cursor-v1') }, keyMaterial, 256));
    const now = Math.floor(Date.now() / 1000);
    for (const type of ['expired', 'wrong-purpose']) {
      const invalid = await new EncryptJWT({ tenantId, actorId: agent.id, authVersion: 2, createdAt: '2026-09-11T00:00:00.000Z', id: 'backlog-activity-1099' })
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: type === 'expired' ? 'tocyn-operator-activity-cursor-v1' : 'wrong-purpose-v2' })
        .setIssuedAt(type === 'expired' ? now - 901 : now).setExpirationTime(type === 'expired' ? now - 1 : now + 900).encrypt(key);
      await assert.rejects(service.list({ limit: 50, cursor: invalid }, credential(2, 'agent')), /restart pagination/);
    }
    await fixture.db.prepare('UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(tenantId, agent.id).run();
    await assert.rejects(new OperatorActivityRepository(createVerifiedTenantScope(tenantId, agent.id, ['agent'], 3), fixture.db, cursorSecret)
      .listForRecipient({ limit: 50, cursor: first.next }, credential(3, 'agent')), /restart pagination/);
  });
});

test('current MFA and authority fences deny stale presentations and duplicate fallback results', async () => {
  await withTwoTenantFixture(async fixture => {
    const tenantId = fixture.principals.operatorA.tenantId;
    const actorId = fixture.principals.operatorA.localId;
    const scope = createVerifiedTenantScope(tenantId, actorId, ['admin'], 0);
    const repository = new OperatorActivityRepository(scope, fixture.db, cursorSecret);
    const created = await repository.appendTrusted(append());
    assert.ok(created);
    const badCredentials = [
      { ...credential(), mfaVerified: false } as unknown as ActivityPresentationCredential,
      { ...credential(), expiresAt: Math.floor(Date.now() / 1000) - 1 },
      credential(1),
      credential(0, 'agent'),
    ];
    for (const bad of badCredentials) {
      assert.equal(await repository.listForRecipient({ limit: 1 }, bad), null);
      assert.equal(await repository.unreadCount(bad), null);
      assert.equal(await repository.markRead(created.activity.id, 1, bad), null);
      assert.equal(await repository.dismiss(created.activity.id, 1, bad), null);
    }
    let revoked = false;
    const fenced = new OperatorActivityRepository(scope, observeDatabase(fixture.db, [], async sql => {
      if (sql.startsWith('WITH candidates') && !revoked) {
        revoked = true;
        await fixture.db.prepare('UPDATE users SET mfa_enabled=0 WHERE tenant_id=? AND id=?').bind(tenantId, actorId).run();
      }
    }), cursorSecret);
    assert.equal(await fenced.listForRecipient({ limit: 10 }, credential()), null, 'revocation during native candidate read is fenced before presentation');
    const disabled = new OperatorActivityRepository(createVerifiedTenantScope(tenantId, actorId, ['admin'], 1), fixture.db, cursorSecret);
    assert.equal(await disabled.listForRecipient({ limit: 10 }, credential(1)), null, 'even a matching current session version cannot bypass live disabled MFA');
    assert.equal(await disabled.unreadCount(credential(1)), null);
    assert.equal(await disabled.markRead(created.activity.id, 1, credential(1)), null);
    assert.equal(await disabled.dismiss(created.activity.id, 1, credential(1)), null);
    const replay = new OperatorActivityRepository(scope, observeDatabase(fixture.db, [], async (sql, method, result) => {
      if (sql.startsWith('INSERT INTO operator_activities') && method === 'first' && result === null) {
        await fixture.db.prepare("UPDATE users SET role='customer' WHERE tenant_id=? AND id=?").bind(tenantId, actorId).run();
      }
    }), cursorSecret);
    assert.equal(await replay.appendTrusted(append()), null, 'duplicate fallback rechecks recipient/ticket authority after the insert statement');
    await fixture.db.prepare('UPDATE users SET mfa_enabled=1 WHERE tenant_id=? AND id=?').bind(tenantId, actorId).run();
    const current = await fixture.db.prepare('SELECT session_version FROM users WHERE tenant_id=? AND id=?').bind(tenantId, actorId).first<{ session_version: number }>();
    assert.ok(current);
    const customerScope = createVerifiedTenantScope(tenantId, actorId, ['customer'], current.session_version);
    const customerRepository = new OperatorActivityRepository(customerScope, fixture.db, cursorSecret);
    const nonStaffCredential = { ...credential(current.session_version), role: 'customer' } as unknown as ActivityPresentationCredential;
    assert.equal(await customerRepository.listForRecipient({ limit: 10 }, nonStaffCredential), null, 'runtime role checks do not rely on the TypeScript staff-role union');
    assert.equal(await customerRepository.dismiss(created.activity.id, 1, nonStaffCredential), null);
    assert.equal((await fixture.db.prepare('SELECT revision FROM operator_activities WHERE tenant_id=? AND id=?')
      .bind(tenantId, created.activity.id).first<{ revision: number }>())?.revision, 1, 'all denied presentation writes leave activity untouched');
  });
});
