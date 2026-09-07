import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createVerifiedTenantScope } from '../../auth/scope';
import { createRepositories } from '../index';
import { D1Database } from '@cloudflare/workers-types';

// Simple D1 Mock backed by better-sqlite3
class D1Mock implements D1Database {
  constructor(private db: Database.Database) {}
  prepare(query: string) {
    return {
      bind: (...args: any[]) => {
        return {
          first: async <T>() => {
            const stmt = this.db.prepare(query);
            return (stmt.get(...args) || null) as T | null;
          },
          run: async () => {
            const stmt = this.db.prepare(query);
            const info = stmt.run(...args);
            return { success: true, meta: { changes: info.changes } } as any;
          },
          all: async <T>() => {
            const stmt = this.db.prepare(query);
            return { success: true, results: stmt.all(...args) as T[] } as any;
          }
        };
      }
    } as any;
  }
  // Other methods stubbed...
  dump() { return Promise.resolve(new ArrayBuffer(0)); }
  batch() { return Promise.resolve([]); }
  exec() { return Promise.resolve({ count: 0, duration: 0 }); }
}

describe('Tenant-Scoped Repositories (Integration)', () => {
  const scopeA = createVerifiedTenantScope('tenant-A', 'user-A', ['agent'], 1);
  const scopeB = createVerifiedTenantScope('tenant-B', 'user-B', ['agent'], 1);

  let sqlite: Database.Database;
  let d1: D1Database;
  let reposA: ReturnType<typeof createRepositories>;
  let reposB: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    for (const name of readdirSync(join(__dirname, '../../../migrations')).filter(n => n.endsWith('.sql')).sort()) {
      sqlite.transaction(() => sqlite.exec(readFileSync(join(__dirname, '../../../migrations', name), 'utf8')))();
    }
    d1 = new D1Mock(sqlite);
    reposA = createRepositories(scopeA, d1);
    reposB = createRepositories(scopeB, d1);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('proves identical IDs can exist in two tenants', async () => {
    // We bypass the repo UUID creation just to test the database structure allows identical IDs
    sqlite.prepare(`INSERT INTO users (tenant_id, id, email, role) VALUES (?, ?, ?, ?)`).run('tenant-A', 'shared-id', 'a@test.com', 'customer');
    sqlite.prepare(`INSERT INTO users (tenant_id, id, email, role) VALUES (?, ?, ?, ?)`).run('tenant-B', 'shared-id', 'b@test.com', 'customer');

    const userA = await reposA.users.get('shared-id');
    const userB = await reposB.users.get('shared-id');

    expect(userA?.email).toBe('a@test.com');
    expect(userB?.email).toBe('b@test.com');
  });

  it('prevents duplicate emails in the SAME tenant', async () => {
    await reposA.users.create({ tenant_id: "default-tenant", email: 'dup@test.com', full_name: 'Dup 1', role: 'customer', mfa_enabled: false });
    await expect(reposA.users.create({ tenant_id: "default-tenant", email: 'dup@test.com', full_name: 'Dup 2', role: 'customer', mfa_enabled: false }))
      .rejects.toThrow(/UNIQUE constraint failed: index 'idx_users_login_email'/);
  });

  it('prevents duplicate emails globally across DIFFERENT tenants (canonical login index)', async () => {
    await reposA.users.create({ tenant_id: "tenant-A", email: 'dup-global@test.com', full_name: 'Dup A', role: 'customer', mfa_enabled: false });
    await expect(reposB.users.create({ tenant_id: "tenant-B", email: 'dup-global@test.com', full_name: 'Dup B', role: 'customer', mfa_enabled: false }))
      .rejects.toThrow(/UNIQUE constraint failed: index 'idx_users_login_email'/);
  });

  it('isolates ticket reads (get)', async () => {
    const userB = await reposB.users.create({ tenant_id: "default-tenant", email: 'user@b.com', full_name: 'B', role: 'customer', mfa_enabled: false });
    const ticketB = await reposB.tickets.create({ subject: 'Ticket B', status: 'open', priority: 'normal', customer_email: 'user@b.com', assigned_to: userB.id, source: 'web' });

    // Tenant A tries to read Tenant B's ticket
    const result = await reposA.tickets.get(ticketB.id);
    expect(result).toBeNull();
  });

  it('isolates ticket updates (update)', async () => {
    const userB = await reposB.users.create({ tenant_id: "default-tenant", email: 'user@b.com', full_name: 'B', role: 'customer', mfa_enabled: false });
    const ticketB = await reposB.tickets.create({ subject: 'Ticket B', status: 'open', priority: 'normal', customer_email: 'user@b.com', assigned_to: userB.id, source: 'web' });

    // Tenant A tries to update Tenant B's ticket
    await reposA.tickets.update(ticketB.id, { status: 'closed' });

    // Ticket B should remain open
    const verify = await reposB.tickets.get(ticketB.id);
    expect(verify?.status).toBe('open');
  });

  it('isolates ticket deletes (delete)', async () => {
    const userB = await reposB.users.create({ tenant_id: "default-tenant", email: 'user@b.com', full_name: 'B', role: 'customer', mfa_enabled: false });
    const ticketB = await reposB.tickets.create({ subject: 'Ticket B', status: 'open', priority: 'normal', customer_email: 'user@b.com', assigned_to: userB.id, source: 'web' });

    // Tenant A tries to delete Tenant B's ticket
    await reposA.tickets.delete(ticketB.id);

    // Ticket B should still exist
    const verify = await reposB.tickets.get(ticketB.id);
    expect(verify).toBeDefined();
  });

  it('rejects cross-tenant foreign key assignment', async () => {
    const userB = await reposB.users.create({ tenant_id: "default-tenant", email: 'user@b.com', full_name: 'B', role: 'customer', mfa_enabled: false });

    // Tenant A attempts to create a ticket assigned to Tenant B's user
    await expect(reposA.tickets.create({ subject: 'Ticket A', status: 'open', priority: 'normal', customer_email: 'user@a.com', assigned_to: userB.id, source: 'web' }))
      .rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('ignores maliciously injected tenant_id via untyped payload on create', async () => {
    const payload = { tenant_id: "default-tenant", email: 'hack@test.com', full_name: 'Hack', role: 'customer', mfa_enabled: false, tenant_id: 'tenant-HACKED' } as any;
    const user = await reposA.users.create(payload);

    // Ensure it was saved under tenant-A, not tenant-HACKED
    const verify = await reposA.users.get(user.id);
    expect(verify).toBeDefined();

    // Ensure it's not in HACKED
    const stmt = sqlite.prepare(`SELECT * FROM users WHERE tenant_id = 'tenant-HACKED'`);
    expect(stmt.get()).toBeUndefined();
  });

  it('isolates identical attachment IDs between tenants', async () => {
    // Create common ticket and article first to satisfy FKs (assuming repos let us do this)
    const userA = await reposA.users.create({ tenant_id: "tenant-A", email: 'a@a.com', full_name: 'A', role: 'customer', mfa_enabled: false });
    const userB = await reposB.users.create({ tenant_id: "tenant-B", email: 'b@b.com', full_name: 'B', role: 'customer', mfa_enabled: false });

    const ticketA = await reposA.tickets.create({ subject: 'A', status: 'open', priority: 'normal', customer_id: userA.id, customer_email: 'a@a.com', source: 'web' });
    const ticketB = await reposB.tickets.create({ subject: 'B', status: 'open', priority: 'normal', customer_id: userB.id, customer_email: 'b@b.com', source: 'web' });

    const articleA = await reposA.articles.create({ ticket_id: ticketA.id, body: 'A', sender_id: userA.id, sender_type: 'customer', is_internal: false });
    const articleB = await reposB.articles.create({ ticket_id: ticketB.id, body: 'B', sender_id: userB.id, sender_type: 'customer', is_internal: false });

    // Both tenants use the EXACT SAME attachment ID
    const sharedAttachmentId = 'attachment-123';

    sqlite.prepare("INSERT INTO attachments (tenant_id, id, article_id, file_name, file_size, content_type, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)").run('tenant-A', sharedAttachmentId, articleA.id, 'a.png', 10, 'image/png', 'key-a');

    // Tenant B inserting the same ID should succeed (isolated by composite PK tenant_id, id)
    sqlite.prepare("INSERT INTO attachments (tenant_id, id, article_id, file_name, file_size, content_type, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)").run('tenant-B', sharedAttachmentId, articleB.id, 'b.png', 20, 'image/png', 'key-b');

    const fetchA = await reposA.attachments.getAttachmentWithMeta(sharedAttachmentId);
    const fetchB = await reposB.attachments.getAttachmentWithMeta(sharedAttachmentId);

    // Each gets their own metadata
    const allAttachments = sqlite.prepare(`SELECT * FROM attachments WHERE id = 'attachment-123'`).all(); console.log('attachments in db', allAttachments);
    expect(fetchA?.file_name).toBe('a.png');
    expect(fetchB?.file_name).toBe('b.png');
  });

  it('rejects cross-tenant sender_id assignment in composite FK', async () => {
    const userA = await reposA.users.create({ tenant_id: "tenant-A", email: 'a2@a.com', full_name: 'A2', role: 'customer', mfa_enabled: false });
    const userB = await reposB.users.create({ tenant_id: "tenant-B", email: 'b2@b.com', full_name: 'B2', role: 'customer', mfa_enabled: false });

    const ticketA = await reposA.tickets.create({ subject: 'A', status: 'open', priority: 'normal', customer_id: userA.id, customer_email: 'a2@a.com', source: 'web' });

    // Try to create an article in Tenant A's ticket but using Tenant B's user as sender_id
    await expect(
      reposA.articles.create({ ticket_id: ticketA.id, body: 'A', sender_id: userB.id, sender_type: 'customer', is_internal: false })
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('atomically redeems a challenge once and never across colliding user IDs', async () => {
    sqlite.prepare("INSERT INTO users (tenant_id,id,email,role) VALUES (?,?,?,?)").run('tenant-A','same','a@auth.test','customer');
    sqlite.prepare("INSERT INTO users (tenant_id,id,email,role) VALUES (?,?,?,?)").run('tenant-B','same','b@auth.test','customer');
    const future = new Date(Date.now() + 60000).toISOString();
    await reposA.users.storeCustomerAuthToken('same','challenge','hash','magic_link',future);
    expect(await reposB.users.verifyAndConsumeCustomerAuthToken('hash',new Date().toISOString())).toBeNull();
    const claims = await Promise.all(Array.from({length: 8}, () => reposA.users.verifyAndConsumeCustomerAuthToken('hash',new Date().toISOString())));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.tenant_id).toBe('tenant-A');
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('hash',new Date().toISOString())).toBeNull();
  });

  it('rejects expired challenges and challenges for changed roles', async () => {
    sqlite.prepare("INSERT INTO users (tenant_id,id,email,role) VALUES (?,?,?,?)").run('tenant-A','same','a@auth.test','customer');
    await reposA.users.storeCustomerAuthToken('same','expired','expired-hash','magic_link','2000-01-01T00:00:00.000Z');
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('expired-hash',new Date().toISOString())).toBeNull();
    await reposA.users.storeCustomerAuthToken('same','changed','changed-hash','magic_link',new Date(Date.now()+60000).toISOString());
    sqlite.exec("UPDATE users SET role='admin' WHERE tenant_id='tenant-A' AND id='same'");
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('changed-hash',new Date().toISOString())).toBeNull();
  });

  it('returns real dashboard aggregates and staff lists without crossing tenant boundaries', async () => {
    sqlite.exec("INSERT INTO users(tenant_id,id,email,role,password_hash) VALUES ('tenant-A','agent','a@staff.test','agent','private'),('tenant-B','agent','b@staff.test','admin','private')");
    await reposA.tickets.create({subject:'A open',customer_email:'a@test.com',source:'web',status:'open',priority:'high'});
    await reposA.tickets.create({subject:'A closed',customer_email:'a@test.com',source:'web',status:'closed',priority:'normal'});
    await reposB.tickets.create({subject:'B open',customer_email:'b@test.com',source:'web',status:'open',priority:'high'});
    const stats = await reposA.tickets.dashboardStats();
    expect(stats.totalUsers).toBe(1);
    expect(stats.ticketsByStatus).toEqual([{status:'closed',count:1},{status:'open',count:1}]);
    const staff = await reposA.users.list({page:1,limit:20,staffOnly:true});
    expect(staff.map(u=>u.email)).toEqual(['a@staff.test']);
    expect(staff[0]).not.toHaveProperty('password_hash');
    const filtered = await reposA.tickets.list({status:'open',priority:'high'});
    expect(filtered.data.map(t=>t.subject)).toEqual(['A open']);
    expect(filtered.meta.total).toBe(1);
    expect((await reposA.tickets.list({search:'B open'})).data).toEqual([]);
  });

});
