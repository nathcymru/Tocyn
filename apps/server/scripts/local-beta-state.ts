import Database from 'better-sqlite3';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Existing local D1 simulator state only; no config/provider/network discovery. */
export function openLocalBetaState(directory: string): Database.Database {
  const state = realpathSync(resolve(directory));
  if (!lstatSync(state).isDirectory()) throw new Error('Existing local state directory required');
  const d1 = join(state, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const files = readdirSync(d1).filter(name => name.endsWith('.sqlite') && lstatSync(join(d1, name)).isFile());
  if (files.length > 10) throw new Error('Local state contains too many database candidates');
  const candidates = files.filter(file => {
    const candidate = new Database(join(d1, file), { fileMustExist: true, readonly: true, timeout: 5000 });
    try { return Boolean(candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_beta_policy'").get()); }
    finally { candidate.close(); }
  });
  if (candidates.length !== 1) throw new Error('Expected exactly one migrated local beta D1 database');
  const db = new Database(join(d1, candidates[0]), { fileMustExist: true, timeout: 5000 });
  try {
    db.pragma('foreign_keys = ON');
    const principals = db.prepare("SELECT tenant_id,id,role FROM users WHERE id IN ('fixture-customer','fixture-operator') ORDER BY tenant_id,id").all();
    const expected = ['fixture-tenant-a', 'fixture-tenant-b'].flatMap(tenant_id => [{ tenant_id, id: 'fixture-customer', role: 'customer' }, { tenant_id, id: 'fixture-operator', role: 'admin' }]);
    if (JSON.stringify(principals) !== JSON.stringify(expected)) throw new Error('Approved local two-tenant fixture required');
    return db;
  } catch (error) { db.close(); throw error; }
}
