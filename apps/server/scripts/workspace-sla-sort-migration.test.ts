import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const migration = readFileSync(join(directory, '0077_workspace_sla_sort.sql'), 'utf8');
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(directory).filter(name => /^\d{4}.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 76).sort()) {
    db.transaction(() => db.exec(readFileSync(join(directory, file), 'utf8')))();
  }
  for (const tenant of ['tenant-a', 'tenant-b']) {
    db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?,'same-user',?,'agent')").run(tenant, `operator@${tenant}.invalid`);
    db.prepare(`INSERT INTO operator_workspace_state
      (tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,created_at,updated_at)
      VALUES (?,'same-user',17,'custom','priority_asc',?,'synthetic query','page:3','synthetic-ticket','details',?,?)`)
      .run(tenant, '{"priority":"high","filterId":"synthetic-filter"}', '2026-09-11T01:02:03.004Z', '2026-09-13T01:02:03.004Z');
  }
  return db;
}
const rows = (db: Database.Database) => db.prepare('SELECT * FROM operator_workspace_state ORDER BY tenant_id,user_id').all();
const migrate = (db: Database.Database) => db.transaction(() => db.exec(migration))();

test('SLA sort migration preserves every workspace field and the tenant/user lifecycle', () => {
  const db = fixture();
  try {
    const before = rows(db);
    const foreignKeys = db.pragma('foreign_key_list(operator_workspace_state)');
    const columns = db.pragma('table_info(operator_workspace_state)');
    assert.throws(() => db.prepare("UPDATE operator_workspace_state SET sort_key='sla_priority'").run(), /CHECK constraint failed/);
    migrate(db);
    assert.deepEqual(rows(db), before);
    assert.deepEqual(db.pragma('foreign_key_list(operator_workspace_state)'), foreignKeys);
    assert.deepEqual(db.pragma('table_info(operator_workspace_state)'), columns);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    db.prepare("UPDATE operator_workspace_state SET sort_key='sla_priority' WHERE tenant_id='tenant-a'").run();
    assert.equal(db.prepare("SELECT sort_key FROM operator_workspace_state WHERE tenant_id='tenant-b'").pluck().get(), 'priority_asc');
    assert.throws(() => db.prepare("INSERT INTO operator_workspace_state SELECT * FROM operator_workspace_state LIMIT 1").run(), /UNIQUE constraint failed/);
    db.prepare("DELETE FROM users WHERE tenant_id='tenant-a' AND id='same-user'").run();
    assert.deepEqual(rows(db), [before[1]]);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  } finally { db.close(); }
});

test('SLA sort is the only relaxed workspace constraint', () => {
  const db = fixture();
  try {
    migrate(db);
    for (const assignment of ["sort_key='unknown'", "view_key='unknown'", "panel='unknown'", "revision=0", "filters='[]'", "filters='not json'", "filters='{' || '\"x\":\"' || replace(hex(zeroblob(2048)),'0','a') || '\"}'", "list_query=replace(hex(zeroblob(257)),'0','a')", "list_anchor=replace(hex(zeroblob(257)),'0','a')"]) {
      assert.throws(() => db.prepare(`UPDATE operator_workspace_state SET ${assignment}`).run(), /CHECK constraint failed/);
    }
    assert.throws(() => db.prepare("UPDATE operator_workspace_state SET user_id='missing'").run(), /FOREIGN KEY constraint failed/);
  } finally { db.close(); }
});

test('invalid preexisting workspace state aborts the entire rebuild without discarding data', () => {
  const db = fixture();
  try {
    db.pragma('ignore_check_constraints = ON');
    db.prepare("UPDATE operator_workspace_state SET sort_key='unknown' WHERE tenant_id='tenant-a'").run();
    db.pragma('ignore_check_constraints = OFF');
    const before = rows(db);
    assert.throws(() => migrate(db), /CHECK constraint failed/);
    assert.deepEqual(rows(db), before);
    assert.equal(db.prepare("SELECT count(*) FROM sqlite_schema WHERE name='operator_workspace_state_sla'").pluck().get(), 0);
  } finally { db.close(); }
});
