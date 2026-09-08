import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { createSystemTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';
import type { InitialTicketArticleData } from '../src/repositories/interfaces';

test('canonical intake: real D1 second-write failure rolls back A, preserves B, and allows a clean retry', async t => {
  await withTwoTenantFixture(async fixture => {
    const a = fixture.principals.customerA;
    const b = fixture.principals.customerB;
    const reposA = createRepositories(createSystemTenantScope({ tenantId: a.tenantId, actor: 'synthetic-intake-test' }), fixture.db);
    // This sender exists, but only in B. The ticket input is independently valid
    // in A; only the second INSERT's composite sender FK can reject the batch.
    await fixture.db.prepare('INSERT INTO users (tenant_id, id, email, role) VALUES (?, ?, ?, ?)')
      .bind(b.tenantId, 'b-only-canonical-sender', 'canonical.sender.b@example.test', 'customer').run();
    const snapshot = async (tenantId: string) => ({
      tickets: (await fixture.db.prepare('SELECT * FROM tickets WHERE tenant_id = ? ORDER BY id').bind(tenantId).all()).results,
      articles: (await fixture.db.prepare('SELECT * FROM articles WHERE tenant_id = ? ORDER BY id').bind(tenantId).all()).results,
      attachments: (await fixture.db.prepare('SELECT * FROM attachments WHERE tenant_id = ? ORDER BY id').bind(tenantId).all()).results,
      users: (await fixture.db.prepare('SELECT id, email, role, session_version FROM users WHERE tenant_id = ? ORDER BY id').bind(tenantId).all()).results,
    });
    const beforeA = await snapshot(a.tenantId);
    const beforeB = await snapshot(b.tenantId);
    const resourcesBefore = await fixture.resourceUsage();
    const receivedAt = '2026-09-08T12:00:00.000Z';
    const processedAt = '2026-09-08T12:00:00.010Z';
    const input: InitialTicketArticleData = {
      ticket: {
        subject: 'Synthetic atomic intake', customer_id: a.localId, customer_email: a.email,
        source: 'portal', status: 'open', priority: 'normal',
        intake_received_at: receivedAt, intake_processed_at: processedAt,
      },
      article: {
        sender_id: 'b-only-canonical-sender', sender_type: 'customer', body: 'Synthetic initial message', is_internal: false,
        intake_source: 'portal', received_at: receivedAt, processed_at: processedAt,
      },
    };
    await assert.rejects(reposA.tickets.createWithInitialArticle(input), /FOREIGN KEY constraint failed/);
    assert.deepEqual(await snapshot(a.tenantId), beforeA, 'Second-write rejection must leave no orphan ticket or article in A');
    assert.deepEqual(await snapshot(b.tenantId), beforeB, 'Rejected cross-tenant sender must leave B unchanged');
    assert.deepEqual(await fixture.resourceUsage(), resourcesBefore, 'Failed batch must create no persisted rows or objects');

    // A clean retry corrects the invalid sender. This demonstrates rollback
    // recovery, not request replay/deduplication (owned by issue #60).
    const created = await reposA.tickets.createWithInitialArticle({
      ...input, article: { ...input.article, sender_id: a.localId },
    });
    assert.equal(created.ticket.subject, input.ticket.subject);
    assert.equal(created.ticket.customer_id, a.localId);
    assert.equal(created.article.ticket_id, created.ticket.id);
    assert.equal(created.article.sender_id, a.localId);
    assert.equal(created.article.is_internal, false);
    assert.equal(created.article.body, input.article.body);
    assert.equal(created.ticket.intake_received_at, receivedAt);
    assert.equal(created.ticket.intake_processed_at, processedAt);
    assert.equal(created.article.received_at, receivedAt);
    assert.equal(created.article.processed_at, processedAt);
    assert.equal(created.article.intake_source, 'portal');
    assert.ok(created.ticket.created_at && created.article.created_at, 'Return actual persisted timestamps');
    assert.deepEqual(await reposA.tickets.get(created.ticket.id), created.ticket);
    const persistedArticle = await reposA.articles.get(created.article.id);
    assert.ok(persistedArticle);
    assert.deepEqual({ ...persistedArticle, is_internal: Boolean(persistedArticle.is_internal) }, created.article);
    const afterA = await snapshot(a.tenantId);
    assert.equal(afterA.tickets.length, beforeA.tickets.length + 1);
    assert.equal(afterA.articles.length, beforeA.articles.length + 1);
    assert.deepEqual(await snapshot(b.tenantId), beforeB, 'Successful A retry must preserve B');
    assert.equal((await fixture.db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    const resourcesAfter = await fixture.resourceUsage();
    // The shared usage counter selects users/tickets/API keys, not articles.
    // The ticket and article snapshots above independently prove both inserts.
    assert.equal(resourcesAfter.d1Rows, resourcesBefore.d1Rows + 1);
    assert.equal(resourcesAfter.r2Objects, resourcesBefore.r2Objects);
    assert.equal(resourcesAfter.routeRequests, resourcesBefore.routeRequests);
    const storage = fixture.r2.operationCounts();
    assert.deepEqual({ get: storage.get, put: storage.put, delete: storage.delete }, { get: 0, put: 0, delete: 0 });
    t.diagnostic(JSON.stringify({ failedBatchAddedRows: 0, totalPersistedIntakeRows: 2, selectedFixtureRowsAdded: 1, r2ObjectsAdded: 0, crossTenantMutations: 0 }));
  });
});

test('ticket-only and message persistence retain observed facts while legacy callers stay unrecorded', async () => {
  await withTwoTenantFixture(async fixture => {
    const a = fixture.principals.customerA;
    const repos = createRepositories(createSystemTenantScope({ tenantId: a.tenantId, actor: 'synthetic-message-test' }), fixture.db);
    await fixture.db.prepare("UPDATE tickets SET source = 'portal' WHERE tenant_id = ? AND id = 'fixture-ticket'")
      .bind(a.tenantId).run();
    const receivedAt = '2026-09-08T12:00:01.000Z';
    const processedAt = '2026-09-08T12:00:01.010Z';
    const message = await repos.articles.create({
      ticket_id: 'fixture-ticket', sender_type: 'customer', body: 'Synthetic API follow-up', is_internal: false,
      intake_source: 'api', received_at: receivedAt, processed_at: processedAt,
    });
    assert.equal(message.intake_source, 'api', 'Message source must not be inherited from its portal ticket');
    const persisted = await repos.articles.get(message.id);
    assert.equal(persisted?.intake_source, 'api');
    assert.equal(persisted?.received_at, receivedAt);
    assert.equal(persisted?.processed_at, processedAt);
    const legacy = await repos.articles.create({
      ticket_id: 'fixture-ticket', sender_type: 'system', body: 'Synthetic legacy event', is_internal: true,
    });
    assert.equal(legacy.is_internal, true);
    assert.equal(legacy.intake_source, null);
    assert.equal(legacy.received_at, null);
    assert.equal(legacy.processed_at, null);
    const ticketOnly = await repos.tickets.create({
      subject: 'Synthetic ticket-only intake', customer_email: a.email, source: 'api', status: 'open', priority: 'normal',
      intake_received_at: receivedAt, intake_processed_at: processedAt,
    });
    const persistedTicket = await repos.tickets.get(ticketOnly.id);
    assert.equal(persistedTicket?.intake_received_at, receivedAt);
    assert.equal(persistedTicket?.intake_processed_at, processedAt);
    assert.deepEqual(await repos.articles.findByTicket(ticketOnly.id), [], 'Ticket-only intake must not manufacture an initial message');
  });
});
