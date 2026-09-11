import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';

test('queue predicates keep tenant-scoped snoozes out of actionable lists and reuse saved filters', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'ticket-queue-runtime', modules: true,
    script: 'export default { fetch() { return new Response("queue fixture") } }',
    d1Databases: { DB: 'e81c085e-9a9d-44da-8fc0-1922b659adbf' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const migrationDir = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrationDir, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('queue-a','agent','a@example.invalid','admin',1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('queue-b','agent','b@example.invalid','admin',1)"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-a','open','Open','open','high','a@example.invalid','dashboard')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-a','snoozed','Snoozed','open','high','a@example.invalid','dashboard')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-a','resolved','Resolved','resolved','high','a@example.invalid','dashboard')"),
      // Same local ticket ID proves the predicate is tenant-qualified.
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-b','snoozed','Other tenant','open','high','b@example.invalid','dashboard')"),
    ]);
    await db.batch([
      db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id='queue-a' AND ticket_id='snoozed'"),
      db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id='queue-b' AND ticket_id='snoozed'"),
    ]);
    const reposA = createRepositories(createVerifiedTenantScope('queue-a', 'agent', ['admin'], 1), db);
    const reposB = createRepositories(createVerifiedTenantScope('queue-b', 'agent', ['admin'], 1), db);

    const actionable = await reposA.queues.list({ queue: 'actionable', page: 1, limit: 100 });
    assert.deepEqual(actionable.items.map(item => [item.ticket.id, item.inclusionReason]), [['open', 'actionable']]);
    assert.equal(actionable.total, await reposA.queues.count({ queue: 'actionable' }), 'count and list use the same predicate');

    const snoozed = await reposA.queues.list({ queue: 'snoozed' });
    assert.deepEqual(snoozed.items.map(item => [item.ticket.id, item.inclusionReason]), [['snoozed', 'snoozed']]);
    assert.equal(await reposB.queues.count({ queue: 'snoozed' }), 1, 'other tenant has its own same-ID ticket');
    assert.equal(await reposA.queues.count({ queue: 'snoozed' }), 1, 'tenant A never counts tenant B');

    const saved = await reposA.ticketFilters.create({ name: 'High priority', conditions: [{ field: 'priority', operator: 'equals', value: 'high' }] });
    const narrowed = await reposA.queues.list({ queue: 'actionable', filterId: saved.id });
    assert.deepEqual(narrowed.items.map(item => item.ticket.id), ['open'], 'saved filters refine, rather than replace, queue predicates');

    assert.deepEqual(await reposA.supportStates.resurfaceDue('2098-12-31T23:59:59.999Z'), []);
    assert.deepEqual(await reposA.supportStates.resurfaceDue('2099-01-01T00:00:00.000Z'), ['snoozed']);
    assert.deepEqual(await reposA.supportStates.resurfaceDue('2100-01-01T00:00:00.000Z'), [], 'due retry is idempotent');
    assert.deepEqual((await reposA.queues.list({ queue: 'snoozed' })).items, []);
    assert.deepEqual((await reposA.queues.list({ queue: 'actionable' })).items.map(item => item.ticket.id).sort(), ['open', 'snoozed']);
  } finally {
    await mf.dispose();
  }
});

test('queue list and count retain the ticket-list query cap', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'ticket-queue-query-bound', modules: true,
    script: 'export default { fetch() { return new Response("queue fixture") } }',
    d1Databases: { DB: '3285bd3f-141e-42ca-a1ca-fbbf91923669' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const migrationDir = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrationDir, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('queue-cap','agent','cap@example.invalid','admin',1)"),
      ...Array.from({ length: 101 }, (_, index) => db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source)
        VALUES ('queue-cap','ticket-${index}','Synthetic','open','cap@example.invalid','dashboard')`)),
    ]);
    const repos = createRepositories(createVerifiedTenantScope('queue-cap', 'agent', ['admin'], 1), db);
    const page = await repos.queues.list({ queue: 'actionable', page: 1, limit: 10_000 });
    assert.equal(page.limit, 100);
    assert.equal(page.items.length, 100);
    assert.equal(await repos.queues.count({ queue: 'actionable' }), 101);
  } finally {
    await mf.dispose();
  }
});
