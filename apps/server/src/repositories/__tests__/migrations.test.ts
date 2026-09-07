import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
