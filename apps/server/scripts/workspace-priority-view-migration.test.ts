import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const migration = readFileSync(join(directory, '0081_workspace_priority_views.sql'), 'utf8');
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(directory).filter(name => /^\d{4}.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 80).sort()) {
    db.transaction(() => db.exec(readFileSync(join(directory, file), 'utf8')))();
  }
  for (const tenant of ['a', 'b']) {
    db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?,'operator',?,'agent')").run(tenant, `${tenant}@example.invalid`);
    db.prepare(`INSERT INTO operator_workspace_state
      (tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,splitter_ratio,created_at,updated_at)
      VALUES (?,'operator',4,'all','sla_priority','{}','subject:demo','page:2',NULL,'details',44,'2026-09-20T01:00:00Z','2026-09-20T02:00:00Z')`).run(tenant);
  }
  return db;
}

test('priority view migration retains every saved field and tenant/user lifecycle', () => {
  const db = fixture();
  try {
    const before = db.prepare('SELECT * FROM operator_workspace_state ORDER BY tenant_id').all();
    assert.throws(() => db.prepare("UPDATE operator_workspace_state SET sort_key='priority_focus'").run(), /CHECK constraint failed/);
    db.transaction(() => db.exec(migration))();
    assert.deepEqual(db.prepare('SELECT * FROM operator_workspace_state ORDER BY tenant_id').all(), before);
    for (const sort of ['priority_focus', 'priority_criticality', 'priority_commitment']) {
      db.prepare('UPDATE operator_workspace_state SET sort_key=? WHERE tenant_id=?').run(sort, 'a');
      assert.equal(db.prepare("SELECT sort_key FROM operator_workspace_state WHERE tenant_id='a'").pluck().get(), sort);
    }
    assert.equal(db.prepare("SELECT sort_key FROM operator_workspace_state WHERE tenant_id='b'").pluck().get(), 'sla_priority');
    assert.throws(() => db.prepare("UPDATE operator_workspace_state SET sort_key='unknown'").run(), /CHECK constraint failed/);
    db.prepare("DELETE FROM users WHERE tenant_id='a' AND id='operator'").run();
    assert.equal(db.prepare('SELECT count(*) FROM operator_workspace_state').pluck().get(), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});
