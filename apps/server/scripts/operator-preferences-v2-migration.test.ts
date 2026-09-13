import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const upgrade = readFileSync(join(migrations, '0076_operator_preferences_v2.sql'), 'utf8');
const table = 'operator_presentation_preference';
const defaults = {
  navigation: 'compact', context_default: 'remember', shortcuts_enabled: 1,
  interruption_level: 'standard', advance_after_resolve: 0,
};

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Exercise the real parent-key migration, not a synthetic users table.
  for (const name of readdirSync(migrations).filter(name => /^\d{4}.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 66).sort()) {
    db.transaction(() => db.exec(readFileSync(join(migrations, name), 'utf8')))();
  }
  for (const tenant of ['tenant-a', 'tenant-b']) {
    db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?, 'same-user', ?, 'agent')")
      .run(tenant, `operator@${tenant}.test`);
  }
  db.prepare(`INSERT INTO ${table} VALUES (?, 'same-user', 1, ?, ?, ?, ?, ?, ?)`)
    .run('tenant-a', 37, 'compact', 'larger', 1, 'reduced', '2026-09-11T05:53:13.123Z');
  db.prepare(`INSERT INTO ${table} VALUES (?, 'same-user', 1, ?, ?, ?, ?, ?, ?)`)
    .run('tenant-b', 9007199254740991, 'comfortable', 'normal', 0, 'full', '2026-09-12T00:00:00.000Z');
  return db;
}
function migrate(db: Database.Database) { db.transaction(() => db.exec(upgrade))(); }
function rows(db: Database.Database) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY tenant_id,user_id`).all() as Record<string, unknown>[];
}

test('v2 migration preserves both tenant-qualified v1 rows and adds only approved defaults', () => {
  const db = fixture();
  try {
    const before = rows(db);
    migrate(db);
    assert.deepEqual(rows(db), before.map(row => ({ ...row, version: 2, ...defaults })));
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.throws(() => db.prepare(`INSERT INTO ${table} SELECT * FROM ${table} WHERE tenant_id='tenant-a'`).run(), /UNIQUE/);
    assert.throws(() => db.prepare(`UPDATE ${table} SET user_id='absent' WHERE tenant_id='tenant-a'`).run(), /FOREIGN KEY/);
    db.prepare("DELETE FROM users WHERE tenant_id='tenant-a' AND id='same-user'").run();
    assert.deepEqual(rows(db).map(row => row.tenant_id), ['tenant-b']);
    // Tenant deletion is implemented through tenant-qualified user deletion;
    // there is no invented tenants-parent FK in this schema.
    db.prepare('DELETE FROM users WHERE tenant_id=?').run('tenant-b');
    assert.deepEqual(rows(db), []);
  } finally { db.close(); }
});

for (const [column, value] of [
  ['version', 2], ['version', 0], ['revision', 0], ['revision', 1.5],
  ['revision', 9007199254740992], ['density', 'invalid'], ['motion', 'invalid'],
] as const) {
  test(`invalid historical ${column}=${value} aborts the entire migration without replacing v1`, () => {
    const db = fixture();
    try {
      // Explicit corruption fixture covers historical invalid rows without
      // relaxing constraints during the actual migration.
      db.pragma('ignore_check_constraints = ON');
      db.prepare(`UPDATE ${table} SET ${column}=? WHERE tenant_id='tenant-b'`).run(value);
      db.pragma('ignore_check_constraints = OFF');
      const before = rows(db);
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table);
      assert.throws(() => migrate(db), /CHECK constraint failed/);
      assert.deepEqual(rows(db), before);
      assert.deepEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table), schema);
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='operator_presentation_preference_v2'").get(), undefined);
    } finally { db.close(); }
  });
}

test('v2 constraints reject unsafe revisions, unknown schemas and invalid newly added settings', () => {
  const db = fixture();
  try {
    migrate(db);
    const before = rows(db);
    for (const [column, value] of [
      ['version', 1], ['version', 3], ['revision', 0], ['revision', 1.5], ['revision', 9007199254740992],
      ['navigation', 'unknown'], ['context_default', 'unknown'], ['shortcuts_enabled', 2],
      ['interruption_level', 'unknown'], ['advance_after_resolve', 2],
    ] as const) {
      assert.throws(() => db.prepare(`UPDATE ${table} SET ${column}=? WHERE tenant_id='tenant-a'`).run(value), /CHECK constraint failed/);
      assert.deepEqual(rows(db), before);
    }
  } finally { db.close(); }
});
