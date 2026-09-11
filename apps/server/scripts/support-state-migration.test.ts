import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';

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
