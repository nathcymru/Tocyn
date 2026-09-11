import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { SupportStateRepository } from '../src/repositories/support-state.repository';
import { SUPPORT_SLA_RECEIPT_SNAPSHOTS, supportSlaReceiptStatement } from '../src/repositories/support-sla-mutation.repository';

test('support/SLA receipt migration bounds snapshots, keys, expiry cleanup and ticket redaction', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'support-sla-receipts', modules: true,
    script: 'export default { fetch() { return new Response("support-sla receipt fixture") } }',
    d1Databases: { DB: '8da10cf0-182b-488b-bbc3-64eae9500049' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const migrations = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrations, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    const key = 'a'.repeat(64), payload = 'b'.repeat(64);
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role) VALUES ('receipt-a','staff','staff@example.invalid','admin')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source) VALUES ('receipt-a','ticket','Synthetic','open','customer@example.invalid','dashboard')"),
      db.prepare(`INSERT INTO support_sla_mutation_receipts
        (tenant_id,principal_id,operation,key_hash,payload_hash,result_ticket_id,response_status,response_snapshot)
        VALUES ('receipt-a','staff','dashboard.ticket.support-state.transition',?,?,'ticket',200,'{"ticket_id":"ticket","revision":2}')`).bind(key,payload),
    ]);
    await db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z',resurface_reason='due' WHERE tenant_id='receipt-a' AND ticket_id='ticket'").run();
    const scope = createVerifiedTenantScope('receipt-a', 'staff', ['admin'], 1);
    const namespace = { principalId: 'staff', operation: 'dashboard.ticket.support-state.transition' as const,
      keyHash: 'd'.repeat(64), payloadHash: 'e'.repeat(64), ticketId: 'ticket' };
    await db.batch([supportSlaReceiptStatement(db, scope, namespace, 200, SUPPORT_SLA_RECEIPT_SNAPSHOTS.state,
      [scope.tenantId, 'ticket'])]);
    const replaySnapshot = await db.prepare(`SELECT response_snapshot FROM support_sla_mutation_receipts
      WHERE tenant_id='receipt-a' AND key_hash=?`).bind(namespace.keyHash).first<{ response_snapshot: string }>();
    assert.deepEqual(JSON.parse(replaySnapshot?.response_snapshot ?? '{}'), {
      ticket_id: 'ticket', definition_id: 'legacy-open', lifecycle: 'open', internal_label: 'Open', public_label: 'Open',
      waiting_reason: null, next_action: null, snoozed_until: '2099-01-01T00:00:00.000Z', resurface_reason: 'due',
      changed_at: (await db.prepare("SELECT changed_at FROM ticket_support_state WHERE tenant_id='receipt-a' AND ticket_id='ticket'").first<{ changed_at: string }>())?.changed_at,
      revision: 1,
    }, 'a lost-response retry retains the same durable snooze facts as the winning transition');
    assert.deepEqual(await db.prepare(`SELECT response_status,response_snapshot FROM support_sla_mutation_receipts
      WHERE tenant_id='receipt-a'`).first(), { response_status: 200, response_snapshot: '{"ticket_id":"ticket","revision":2}' });
    await db.prepare("DELETE FROM tickets WHERE tenant_id='receipt-a' AND id='ticket'").run();
    assert.deepEqual(await db.prepare(`SELECT lifecycle,response_snapshot FROM support_sla_mutation_receipts
      WHERE tenant_id='receipt-a'`).first(), { lifecycle: 'gone', response_snapshot: null },
      'ticket removal redacts a durable transition replay before its receipt can be reused');
    await assert.rejects(db.prepare(`INSERT INTO support_sla_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      VALUES ('receipt-a','staff','dashboard.sla.policy.set','short',?,200,'{}')`).bind(payload).run());
    await assert.rejects(db.prepare(`INSERT INTO support_sla_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      VALUES ('receipt-a','staff','dashboard.sla.policy.set',?,?,418,'{}')`).bind(key,payload).run());
    await assert.rejects(db.prepare(`INSERT INTO support_sla_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      VALUES ('receipt-a','staff','dashboard.sla.policy.set',?,?,200,?)`).bind('c'.repeat(64), payload, JSON.stringify({ value: 'x'.repeat(262_144) })).run(),
      /constraint|failed/i, 'receipts reject an oversized response snapshot before it can become a replay payload');
    const plan = await db.prepare(`EXPLAIN QUERY PLAN SELECT rowid FROM support_sla_mutation_receipts
      WHERE tenant_id='receipt-a' AND principal_id='staff' AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 99`).all<{ detail: string }>();
    assert.match(plan.results.map((row: { detail: string }) => row.detail).join('\n'), /idx_support_sla_mutation_receipts_expiry/);
    const redactionPlan = await db.prepare(`EXPLAIN QUERY PLAN UPDATE support_sla_mutation_receipts
      SET lifecycle='gone',response_snapshot=NULL WHERE tenant_id='receipt-a' AND result_ticket_id='ticket'`).all<{ detail: string }>();
    assert.match(redactionPlan.results.map((row: { detail: string }) => row.detail).join('\n'), /idx_support_sla_mutation_receipts_ticket/);
    await db.batch([
      db.prepare(`INSERT INTO support_state_definitions (tenant_id,id,legacy_status,internal_label,public_label)
        VALUES ('receipt-a','source','open','Source','Source')`),
      db.prepare(`INSERT INTO support_state_definitions (tenant_id,id,legacy_status,internal_label,public_label)
        VALUES ('receipt-a','replacement','open','Replacement','Replacement')`),
      ...Array.from({ length: 101 }, (_, index) => db.prepare(`INSERT INTO tickets
        (tenant_id,id,subject,status,customer_email,source) VALUES ('receipt-a',?,'Bounded remap','open',?,'dashboard')`)
        .bind(`remap-${index}`, `remap-${index}@example.invalid`)),
    ]);
    await db.prepare(`UPDATE ticket_support_state SET definition_id='source'
      WHERE tenant_id='receipt-a' AND ticket_id LIKE 'remap-%'`).run();
    const candidatePlan = await db.prepare(`EXPLAIN QUERY PLAN SELECT ticket_id FROM ticket_support_state
      WHERE tenant_id='receipt-a' AND definition_id='source' ORDER BY ticket_id COLLATE BINARY LIMIT 101`).all<{ detail: string }>();
    assert.match(candidatePlan.results.map((row: { detail: string }) => row.detail).join('\n'), /idx_ticket_support_state_definition_ticket/,
      'the 101-row cap walks the definition/ticket index without sorting or a tenant scan');
    const transitionPlan = await db.prepare(`EXPLAIN QUERY PLAN SELECT ticket_id FROM ticket_support_state
      WHERE tenant_id='receipt-a' AND transition_token='synthetic-token'`).all<{ detail: string }>();
    assert.match(transitionPlan.results.map((row: { detail: string }) => row.detail).join('\n'), /idx_ticket_support_state_transition_ticket/,
      'the remap follow-up lookup stays on the token-qualified candidate index');
    const states = new SupportStateRepository(db, createVerifiedTenantScope('receipt-a', 'staff', ['admin'], 1));
    await assert.rejects(states.deactivate('source', { replacementId: 'replacement' }, { kind: 'staff', id: 'staff', source: 'dashboard' }),
      /constraint|failed/i, 'the in-batch guard rejects a concurrent over-100 remap before it can write any state or audit rows');
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ticket_support_state WHERE tenant_id='receipt-a' AND definition_id='source'`).first<{ n: number }>())?.n, 101);
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM support_state_events
      WHERE tenant_id='receipt-a' AND definition_id='source'`).first<{ n: number }>())?.n, 0,
      'the in-batch 101-row sentinel blocks audits as well as the remap itself');
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ticket_sla_clocks WHERE tenant_id='receipt-a'`).first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ticket_sla_events WHERE tenant_id='receipt-a'`).first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ticket_sla_pause_intervals WHERE tenant_id='receipt-a'`).first<{ n: number }>())?.n, 0,
      'an over-cap remap cannot leave any partial SLA projection state');
  } finally { await mf.dispose(); }
});
