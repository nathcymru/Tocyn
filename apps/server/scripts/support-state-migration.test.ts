import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';
import { SupportStateError } from '../src/repositories/support-state.repository';
import { SupportStateService } from '../src/services/support-state.service';
import { publicSupportState, supportStateSlaInput } from '../src/types/support-state';

test('support-state migration preserves legacy rows and enforces tenant-qualified references', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'support-state-migration', modules: true,
    script: 'export default { fetch() { return new Response("local migration fixture") } }',
    d1Databases: { DB: '3c902bf1-e9d9-42d4-a7d7-fd8e17922741' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const dir = join(import.meta.dirname, '..', 'migrations');
    const apply = async (file: string) => {
      await db.batch(splitSql(readFileSync(join(dir, file), 'utf8')).map(sql => db.prepare(sql)));
    };
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql') && f < '0030').sort()) await apply(file);
    for (const tenant of ['state-a', 'state-b', 'state-empty']) {
      await db.prepare('INSERT INTO users (tenant_id,id,email,role) VALUES (?,?,?,?)')
        .bind(tenant, 'same-user', `${tenant}@example.invalid`, 'customer').run();
    }
    for (const tenant of ['state-a', 'state-b']) {
      for (const status of ['open', 'pending', 'resolved', 'closed']) {
        await db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,customer_id,customer_email,source)
          VALUES (?,?,?,?,?,?,?)`).bind(tenant, status, 'Synthetic state', status, 'same-user', `${tenant}@example.invalid`, 'portal').run();
      }
    }
    const before = await db.prepare("SELECT * FROM tickets WHERE tenant_id LIKE 'state-%' ORDER BY tenant_id,id").all();
    await apply('0030_support_state_foundation.sql');
    const after = await db.prepare("SELECT * FROM tickets WHERE tenant_id LIKE 'state-%' ORDER BY tenant_id,id").all();
    assert.deepEqual(after.results, before.results, 'Every legacy ticket column remains unchanged');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM support_state_definitions WHERE tenant_id='state-empty'").first<{n: number}>())?.n, 4);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM ticket_support_state WHERE tenant_id IN ('state-a','state-b')").first<{n: number}>())?.n, 8);
    await db.prepare(`INSERT INTO support_state_definitions (tenant_id,id,legacy_status,internal_label,public_label)
      VALUES ('state-b','custom-pending','pending','Internal wait','Waiting')`).run();
    await assert.rejects(db.prepare("UPDATE ticket_support_state SET definition_id='custom-pending' WHERE tenant_id='state-a' AND ticket_id='pending'").run());
    await db.prepare("UPDATE ticket_support_state SET definition_id='custom-pending' WHERE tenant_id='state-b' AND ticket_id='pending'").run();
    await assert.rejects(db.prepare("DELETE FROM support_state_definitions WHERE tenant_id='state-b' AND id='custom-pending'").run());
    await assert.rejects(db.prepare("UPDATE ticket_support_state SET waiting_reason=? WHERE tenant_id='state-b' AND ticket_id='pending'").bind('x'.repeat(513)).run());
    const facts = await db.prepare("SELECT definition_id,waiting_reason FROM ticket_support_state WHERE tenant_id='state-a' AND ticket_id='pending'").first();
    assert.deepEqual(facts, { definition_id: 'legacy-pending', waiting_reason: null });
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});

test('support-state transitions stay tenant-scoped, preserve legacy clients, and remap atomically', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'support-state-runtime', modules: true,
    script: 'export default { fetch() { return new Response("local state fixture") } }',
    d1Databases: { DB: 'a20d0b91-85bf-4ef8-b454-6365cf20013d' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const dir = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(dir, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('state-a','agent-a','a@example.invalid','agent',1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('state-b','agent-b','b@example.invalid','agent',1)"),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('state-a','restricted','Restricted')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source,group_id) VALUES ('state-a','ticket-a','A','open','a-customer@example.invalid','dashboard','restricted')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source) VALUES ('state-b','ticket-b','B','open','b-customer@example.invalid','dashboard')"),
    ]);
    const scopeA = createVerifiedTenantScope('state-a', 'agent-a', ['agent'], 1);
    const scopeB = createVerifiedTenantScope('state-b', 'agent-b', ['agent'], 1);
    const reposA = createRepositories(scopeA, db);
    const reposB = createRepositories(scopeB, db);
    const serviceA = new SupportStateService({ scope: scopeA, repositories: reposA } as any);
    const actorA = { kind: 'staff' as const, id: 'agent-a', source: 'dashboard' as const };

    const pending = await reposA.supportStates.createDefinition({
      id: 'awaiting-customer', legacyStatus: 'pending', internalLabel: 'Awaiting customer proof',
      publicLabel: 'Waiting for information', waitingReasonRequired: true, nextActionRequired: false,
    }, actorA);
    const working = await reposA.supportStates.createDefinition({
      id: 'agent-working', legacyStatus: 'open', internalLabel: 'Agent working', publicLabel: 'In progress',
    }, actorA);
    assert.equal(pending.public_label, 'Waiting for information');
    assert.equal(working.internal_label, 'Agent working');
    assert.equal((await reposB.supportStates.getDefinition('awaiting-customer')), null, 'A definition is not visible to B');

    const initial = await reposA.supportStates.getTicketState('ticket-a');
    assert.ok(initial);
    await assert.rejects(
      serviceA.transition('ticket-a', { definitionId: pending.id, expectedRevision: initial.revision, waitingReason: 'Need account number' }),
      (error: unknown) => error instanceof SupportStateError && error.code === 'not_found',
      'group membership is checked before a state write',
    );
    assert.equal((await reposA.supportStates.getTicketState('ticket-a'))?.definition_id, 'legacy-open');
    await db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('state-a','agent-a','restricted')").run();
    // The write fence repeats live membership and session checks inside the
    // atomic batch, so a revocation after service reads cannot commit a change.
    const membershipFence = await reposA.supportStates.captureTicketWriteFence();
    await db.prepare("DELETE FROM user_groups WHERE tenant_id='state-a' AND user_id='agent-a' AND group_id='restricted'").run();
    await assert.rejects(
      reposA.supportStates.transition('ticket-a', { definitionId: pending.id, expectedRevision: initial.revision, waitingReason: 'Revoked group' }, actorA, membershipFence),
      (error: unknown) => error instanceof SupportStateError && error.code === 'conflict',
    );
    assert.equal((await reposA.supportStates.getTicketState('ticket-a'))?.definition_id, 'legacy-open');
    await db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('state-a','agent-a','restricted')").run();
    const requestSession = (await db.prepare("SELECT session_version FROM users WHERE tenant_id='state-a' AND id='agent-a'").first<{ session_version: number }>())!.session_version;
    const sessionFence = await reposA.supportStates.captureTicketWriteFence(requestSession);
    const requestService = new SupportStateService({ scope: scopeA, repositories: reposA,
      credential: { sessionVersion: requestSession, expiresAt: 1_900_000_000 },
    } as any);
    await db.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='state-a' AND id='agent-a'").run();
    await assert.rejects(
      reposA.supportStates.transition('ticket-a', { definitionId: pending.id, expectedRevision: initial.revision, waitingReason: 'Revoked session' }, actorA, sessionFence),
      (error: unknown) => error instanceof SupportStateError && error.code === 'conflict',
    );
    await assert.rejects(
      requestService.transition('ticket-a', { definitionId: pending.id, expectedRevision: initial.revision, waitingReason: 'Middleware-to-service race' }),
      (error: unknown) => error instanceof SupportStateError && error.code === 'not_found',
    );
    assert.equal((await reposA.supportStates.getTicketState('ticket-a'))?.definition_id, 'legacy-open');
    const eventsBeforeRequiredFieldFailure = (await db.prepare("SELECT count(*) AS n FROM support_state_events WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first<{ n: number }>())!.n;
    await assert.rejects(
      serviceA.transition('ticket-a', { definitionId: pending.id, expectedRevision: initial.revision }),
      (error: unknown) => error instanceof SupportStateError && error.code === 'conflict',
    );
    assert.equal((await db.prepare("SELECT count(*) AS n FROM support_state_events WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first<{ n: number }>())!.n, eventsBeforeRequiredFieldFailure);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM ticket_sla_clocks WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first<{ n: number }>())!.n, 0,
      'a rejected state CAS must not project a clock');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM ticket_sla_events WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first<{ n: number }>())!.n, 0,
      'a rejected state CAS must not write SLA audit evidence');

    const transitioned = await serviceA.transition('ticket-a', {
      definitionId: pending.id, expectedRevision: initial.revision, waitingReason: 'Need account number',
    });
    assert.equal(transitioned.definition_id, pending.id);
    assert.equal(transitioned.lifecycle, 'pending');
    assert.deepEqual(supportStateSlaInput(transitioned), {
      lifecycle: 'pending', waitingReasonPresent: true, nextActionPresent: false, changedAt: transitioned.changed_at,
    });
    assert.deepEqual(publicSupportState(transitioned), {
      lifecycle: 'pending', label: 'Waiting for information', changedAt: transitioned.changed_at,
    });
    assert.equal((await db.prepare("SELECT status FROM tickets WHERE tenant_id='state-a' AND id='ticket-a'").first())?.status, 'pending');
    assert.equal((await db.prepare("SELECT transition_token FROM ticket_support_state WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first())?.transition_token, null);
    assert.deepEqual(await db.prepare(`SELECT response_target_ms,resolution_target_ms,calendar_json
      FROM sla_policies WHERE tenant_id='state-a'`).first(), {
      response_target_ms: null, resolution_target_ms: null,
      calendar_json: '{"timeZone":"UTC","weekly":{"monday":[{"startMinute":0,"endMinute":1440}],"tuesday":[{"startMinute":0,"endMinute":1440}],"wednesday":[{"startMinute":0,"endMinute":1440}],"thursday":[{"startMinute":0,"endMinute":1440}],"friday":[{"startMinute":0,"endMinute":1440}],"saturday":[{"startMinute":0,"endMinute":1440}],"sunday":[{"startMinute":0,"endMinute":1440}]},"exceptions":[],"dst":{"ambiguousLocalTime":"earlier","nonexistentLocalTime":"next-valid"}}',
    }, 'the baseline calendar creates no invented target duration');
    assert.deepEqual(await db.prepare(`SELECT paused_at,pause_reason,last_support_state_revision,response_started_at,resolution_started_at
      FROM ticket_sla_clocks WHERE tenant_id='state-a' AND ticket_id='ticket-a'`).first(), {
      paused_at: transitioned.changed_at, pause_reason: 'waiting', last_support_state_revision: transitioned.revision,
      response_started_at: (await db.prepare("SELECT created_at FROM tickets WHERE tenant_id='state-a' AND id='ticket-a'").first<{ created_at: string }>())!.created_at,
      resolution_started_at: (await db.prepare("SELECT created_at FROM tickets WHERE tenant_id='state-a' AND id='ticket-a'").first<{ created_at: string }>())!.created_at,
    }, 'the waiting transition and its durable pause projection share the CAS revision');
    assert.deepEqual((await db.prepare(`SELECT kind,support_state_revision FROM ticket_sla_events
      WHERE tenant_id='state-a' AND ticket_id='ticket-a'`).all<{ kind: string; support_state_revision: number }>()).results,
      [{ kind: 'clock.initialized', support_state_revision: transitioned.revision }]);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sla_policies WHERE tenant_id='state-b'").first<{ n: number }>())!.n, 0,
      'tenant A projection does not initialize a policy for tenant B');

    // Even if a clock collision produces the same timestamp, revision remains
    // strictly monotonic and therefore rejects an old optimistic write.
    await db.prepare("UPDATE ticket_support_state SET changed_at=? WHERE tenant_id='state-a' AND ticket_id='ticket-a'").bind(initial.changed_at).run();
    assert.equal((await reposA.supportStates.getTicketState('ticket-a'))?.revision, initial.revision + 1);
    const eventsBeforeFailure = (await db.prepare("SELECT count(*) AS n FROM support_state_events WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first<{ n: number }>())!.n;
    await assert.rejects(
      serviceA.transition('ticket-a', { definitionId: pending.id, expectedRevision: initial.revision, waitingReason: 'Changed concurrently' }),
      (error: unknown) => error instanceof SupportStateError && error.code === 'conflict',
    );
    assert.equal((await db.prepare("SELECT count(*) AS n FROM support_state_events WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first<{ n: number }>())!.n, eventsBeforeFailure);
    await assert.rejects(
      serviceA.transition('ticket-b', { definitionId: pending.id, expectedRevision: transitioned.revision, waitingReason: 'Forged tenant target' }),
      (error: unknown) => error instanceof SupportStateError && error.code === 'not_found',
    );
    assert.equal((await reposB.supportStates.getTicketState('ticket-b'))?.definition_id, 'legacy-open');

    const resumeStart = await reposA.supportStates.getTicketState('ticket-a');
    assert.ok(resumeStart);
    const resumed = await serviceA.transition('ticket-a', { definitionId: working.id, expectedRevision: resumeStart.revision });
    assert.equal((await db.prepare("SELECT paused_at,pause_reason,last_support_state_revision FROM ticket_sla_clocks WHERE tenant_id='state-a' AND ticket_id='ticket-a'").first())?.paused_at, null,
      'a subsequent non-waiting transition resumes the persisted clock');
    assert.deepEqual((await db.prepare("SELECT kind,support_state_revision FROM ticket_sla_events WHERE tenant_id='state-a' AND ticket_id='ticket-a' ORDER BY support_state_revision").all<{ kind: string; support_state_revision: number }>()).results,
      [{ kind: 'clock.initialized', support_state_revision: transitioned.revision }, { kind: 'clock.resumed', support_state_revision: resumed.revision }]);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM ticket_sla_pause_intervals WHERE tenant_id='state-a' AND ticket_id='ticket-a' AND ended_at IS NOT NULL").first<{ n: number }>())?.n, 1,
      'waiting pause history is retained after a resume instead of being overwritten');

    // A legacy PATCH still changes only the compatibility projection and clears
    // the private facts; old API clients never need the new definition fields.
    await db.prepare("UPDATE tickets SET status='closed' WHERE tenant_id='state-a' AND id='ticket-a'").run();
    const legacy = await reposA.supportStates.getTicketState('ticket-a');
    assert.deepEqual({ id: legacy?.definition_id, reason: legacy?.waiting_reason, action: legacy?.next_action },
      { id: 'legacy-closed', reason: null, action: null });

    const remapStart = await reposA.supportStates.getTicketState('ticket-a');
    assert.ok(remapStart);
    await serviceA.transition('ticket-a', { definitionId: pending.id, expectedRevision: remapStart.revision, waitingReason: 'Need account number' });
    await reposA.supportStates.deactivate(pending.id, { replacementId: working.id }, actorA);
    const remapped = await reposA.supportStates.getTicketState('ticket-a');
    assert.equal(remapped?.definition_id, working.id);
    assert.equal((await reposA.supportStates.getDefinition(pending.id)), null);
    assert.equal((await db.prepare("SELECT status FROM tickets WHERE tenant_id='state-a' AND id='ticket-a'").first())?.status, 'open');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='state-a' AND ticket_id='ticket-a' AND kind='ticket.state_changed'").first<{ n: number }>())!.n >= 2, true);

    const requiresAction = await reposA.supportStates.createDefinition({
      id: 'requires-action', legacyStatus: 'pending', internalLabel: 'Action needed', publicLabel: 'Waiting', nextActionRequired: true,
    }, actorA);
    const auditBeforeInvalidRemap = (await db.prepare("SELECT count(*) AS n FROM support_state_events WHERE tenant_id='state-a'").first<{ n: number }>())!.n;
    await assert.rejects(
      reposA.supportStates.deactivate(working.id, { replacementId: requiresAction.id }, actorA),
      (error: unknown) => error instanceof SupportStateError && error.code === 'conflict',
    );
    assert.equal((await reposA.supportStates.getDefinition(working.id))?.is_active, 1, 'an invalid remap leaves the source active');
    assert.equal((await reposA.supportStates.getTicketState('ticket-a'))?.definition_id, working.id, 'an invalid remap leaves ticket state intact');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM support_state_events WHERE tenant_id='state-a'").first<{ n: number }>())!.n, auditBeforeInvalidRemap);
    await db.batch(Array.from({ length: 101 }, (_, index) => db.prepare(
      "INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source) VALUES ('state-a',?,'Bounded remap','open',?,'dashboard')",
    ).bind(`remap-${index}`, `remap-${index}@example.invalid`)));
    await db.prepare("UPDATE ticket_support_state SET definition_id=? WHERE tenant_id='state-a' AND ticket_id LIKE 'remap-%'").bind(working.id).run();
    await assert.rejects(
      serviceA.deactivate(working.id, { replacementId: requiresAction.id }, {} as any),
      (error: unknown) => error instanceof SupportStateError && error.code === 'conflict' && error.message.includes('bounded background job'),
      'large remaps require a bounded background job rather than an unbounded transaction',
    );
    assert.equal((await reposA.supportStates.getDefinition(working.id))?.is_active, 1);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});
