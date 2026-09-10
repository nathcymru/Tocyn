import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilityWriteConstraint } from '../../auth/capability-policy';

const directory = join(__dirname, '../../../migrations');
const migrations = readdirSync(directory).filter(n => n.endsWith('.sql')).sort();
function apply(db: Database.Database, from: number, through: number) {
  for (const name of migrations.filter(n => Number(n.slice(0, 4)) >= from && Number(n.slice(0, 4)) <= through)) {
    db.transaction(() => db.exec(readFileSync(join(directory, name), 'utf8')))();
  }
}
function legacy() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  apply(db, 1, 13);
  db.exec(`INSERT INTO users(id,email,role) VALUES ('old-user','old@example.test','customer');
    INSERT INTO groups(id,name) VALUES ('old-group','Support');
    INSERT INTO user_groups(user_id,group_id) VALUES ('old-user','old-group');
    INSERT INTO tickets(id,subject,customer_email,customer_id,source,group_id) VALUES ('old-ticket','Preserved','old@example.test','old-user','email','old-group');
    INSERT INTO articles(id,ticket_id,sender_id,sender_type,body) VALUES ('old-article','old-ticket','old-user','customer','Preserved body');
    INSERT INTO attachments(id,article_id,file_name,file_size,content_type,r2_key) VALUES ('old-attachment','old-article','file.txt',3,'text/plain','legacy-key');
    INSERT INTO customer_auth_tokens(id,user_id,token_hash,type,expires_at) VALUES ('old-token','old-user','hash','magic_link','2099-01-01');
    INSERT OR REPLACE INTO config(key,value) VALUES ('custom_setting','preserve me');`);
  return db;
}

describe('Real Phase 1 migration chain', () => {
  it('fences a paused capability mutation in its write statement after revocation', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      apply(db, 1, 28);
      db.prepare("INSERT INTO users (tenant_id, id, email, role, session_version) VALUES (?, ?, ?, 'agent', 0)")
        .run('fence-tenant', 'fence-agent', 'agent@fence.test');
      db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id, role, capability, enabled) VALUES (?, 'agent', 'settings.general.manage', 1)")
        .run('fence-tenant');

      // The request has already passed its read check and is paused before the
      // actual side effect. The SQL predicate is created from that request.
      const guard = capabilityWriteConstraint({
        tenantId: 'fence-tenant', actorId: 'fence-agent', role: 'agent', sessionVersion: 0,
        capability: 'settings.general.manage',
      });
      const write = db.prepare(`INSERT INTO tenant_config (tenant_id, key, value)
        SELECT ?, ?, ? WHERE ${guard.sql}`);
      db.prepare("INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, 'existing-setting', 'before')")
        .run('fence-tenant');

      db.prepare("UPDATE tenant_role_capability_policies SET enabled = 0 WHERE tenant_id = ? AND capability = 'settings.general.manage'")
        .run('fence-tenant');
      expect(write.run('fence-tenant', 'blocked-by-policy', 'no', ...guard.values).changes).toBe(0);
      expect(db.prepare("SELECT value FROM tenant_config WHERE key = 'blocked-by-policy'").get()).toBeUndefined();

      // D1 batches do not abort merely because one statement affects zero
      // rows, so every statement in a multi-write settings operation carries
      // the fence. This SQLite transaction uses the identical statements.
      const guardedSettingsBatch = db.transaction(() => [
        db.prepare(`UPDATE tenant_config SET value = 'after' WHERE tenant_id = ? AND key = 'existing-setting' AND ${guard.sql}`)
          .run('fence-tenant', ...guard.values).changes,
        write.run('fence-tenant', 'also-blocked-by-policy', 'no', ...guard.values).changes,
      ]);
      expect(guardedSettingsBatch()).toEqual([0, 0]);
      expect(db.prepare("SELECT value FROM tenant_config WHERE tenant_id = ? AND key = 'existing-setting'").get('fence-tenant'))
        .toEqual({ value: 'before' });
      expect(db.prepare("SELECT value FROM tenant_config WHERE key = 'also-blocked-by-policy'").get()).toBeUndefined();

      db.prepare("UPDATE tenant_role_capability_policies SET enabled = 1 WHERE tenant_id = ? AND capability = 'settings.general.manage'")
        .run('fence-tenant');
      db.prepare("UPDATE users SET session_version = 1 WHERE tenant_id = ? AND id = ?").run('fence-tenant', 'fence-agent');
      expect(write.run('fence-tenant', 'blocked-by-session', 'no', ...guard.values).changes).toBe(0);
      expect(db.prepare("SELECT value FROM tenant_config WHERE key = 'blocked-by-session'").get()).toBeUndefined();
    } finally { db.close(); }
  });

  it('preserves populated legacy ownership, tokens and configuration through 0019', () => {
    const db = legacy();
    try {
      apply(db, 14, 19);
      for (const table of ['users','groups','tickets','articles','attachments','user_groups','customer_auth_tokens']) {
        expect(db.prepare(`SELECT tenant_id FROM ${table}`).all()).toEqual([{tenant_id:'default-tenant'}]);
      }
      expect(db.prepare('SELECT body FROM articles').get()).toEqual({body:'Preserved body'});
      expect(db.prepare("SELECT value FROM tenant_config WHERE key='custom_setting'").get()).toEqual({value:'preserve me'});
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('quick_check')).toEqual([{quick_check:'ok'}]);
    } finally { db.close(); }
  });

  it('invalidates legacy unbound OTPs while preserving magic links through security migrations', () => {
    const db = legacy();
    try {
      db.exec("INSERT INTO customer_auth_tokens(id,user_id,token_hash,type,expires_at) VALUES ('old-otp','old-user','otp-hash','otp','2099-01-01')");
      apply(db,14,21);
      expect(db.prepare("SELECT used_at FROM customer_auth_tokens WHERE id='old-otp'").get()).toEqual({used_at:expect.any(String)});
      expect(db.prepare("SELECT used_at, attempts FROM customer_auth_tokens WHERE id='old-token'").get()).toEqual({used_at:null,attempts:0});
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });

  it('rolls back 0019 when historical token ownership becomes ambiguous', () => {
    const db = legacy();
    try {
      apply(db,14,18);
      db.exec("INSERT INTO users(tenant_id,id,email,role) VALUES ('other','old-user','other@example.test','customer')");
      expect(() => apply(db,19,19)).toThrow(/NOT NULL/);
      expect(db.prepare('SELECT id,user_id FROM customer_auth_tokens').all()).toEqual([{id:'old-token',user_id:'old-user'}]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='new_customer_auth_tokens'").get()).toBeUndefined();
    } finally { db.close(); }
  });

  it('rejects canonical email collisions before committing core ownership changes', () => {
    const db = legacy();
    try {
      db.exec("INSERT INTO users(id,email,role) VALUES ('duplicate',' OLD@example.test ','customer')");
      expect(() => apply(db,14,14)).toThrow(/UNIQUE/);
      expect(db.prepare('SELECT COUNT(*) AS n FROM customer_auth_tokens').get()).toEqual({n:1});
      expect(db.pragma('table_info(users)').some((c: any) => c.name === 'tenant_id')).toBe(false);
    } finally { db.close(); }
  });
});
