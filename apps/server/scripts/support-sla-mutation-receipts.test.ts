import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { SupportStateRepository } from '../src/repositories/support-state.repository';

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
    assert.match(plan.results.map(row => row.detail).join('\n'), /idx_support_sla_mutation_receipts_expiry/);
    const redactionPlan = await db.prepare(`EXPLAIN QUERY PLAN UPDATE support_sla_mutation_receipts
      SET lifecycle='gone',response_snapshot=NULL WHERE tenant_id='receipt-a' AND result_ticket_id='ticket'`).all<{ detail: string }>();
    assert.match(redactionPlan.results.map(row => row.detail).join('\n'), /idx_support_sla_mutation_receipts_ticket/);
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
    const states = new SupportStateRepository(db, createVerifiedTenantScope('receipt-a', 'staff', ['admin'], 1));
    await assert.rejects(states.deactivate('source', { replacementId: 'replacement' }, { kind: 'staff', id: 'staff', source: 'dashboard' }),
      /constraint|failed/i, 'the in-batch guard rejects a concurrent over-100 remap before it can write any state or audit rows');
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ticket_support_state WHERE tenant_id='receipt-a' AND definition_id='source'`).first<{ n: number }>())?.n, 101);
  } finally { await mf.dispose(); }
});
