import { TenantKnowledgeService, WidgetKnowledgeReader } from '../../services/tenant-knowledge.service';
import { Hono } from 'hono';
import * as jose from 'jose';
import * as OTPAuth from 'otpauth';
import authHandler from '../../handlers/auth.handler';
import customerHandler from '../../handlers/customer.handler';
import { AuthService } from '../../services/auth/auth.service';
import { TenantAutomationService } from '../../services/tenant-automation.service';
import { OperatorWorkspaceError, OperatorWorkspaceService } from '../../services/operator-workspace.service';
import { splitSql } from '../../../scripts/split-sql';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createVerifiedTenantScope } from '../../auth/scope';
import { createRepositories } from '../index';
import { D1Database } from '@cloudflare/workers-types';
import { operationalObservability } from '../../middleware/operational-observability';
import type { RequestAuthSliSnapshot } from '../../observability/request-auth-sli';

// Simple D1 Mock backed by better-sqlite3
class D1Mock implements D1Database {
  constructor(private db: Database.Database) {}
  prepare(query: string) {
    return {
      bind: (...args: any[]) => {
        return {
          _execute: () => { const info = this.db.prepare(query).run(...args); return { success: true, meta: { changes: info.changes } }; },
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
  batch(statements: any[]) { return Promise.resolve(this.db.transaction(() => statements.map(statement => statement._execute()))()); }
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

  it('reads the newest bounded article window through the tenant/ticket recent index', async () => {
    sqlite.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source) VALUES ('tenant-A','ai-ticket','Bounded','a@example.test','dashboard')").run();
    const insert = sqlite.prepare(`INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,is_internal,created_at)
      VALUES ('tenant-A',?,'ai-ticket','customer',?,0,?)`);
    for (let index = 0; index < 20; index++) insert.run(`article-${String(index).padStart(2, '0')}`, `message-${index}`, `2026-09-11T00:00:${String(index).padStart(2, '0')}.000Z`);
    insert.run('legacy-large-inline', 'legacy-inline-'.repeat(2_000), '2026-09-11T00:01:00.000Z');
    sqlite.prepare("UPDATE articles SET body_r2_key=? WHERE tenant_id='tenant-A' AND id='legacy-large-inline'")
      .run('r'.repeat(1_025));
    const recent = await reposA.articles.listRecentAiSuggestionMessages('ai-ticket');
    expect(recent.map(article => article.id)).toEqual(['legacy-large-inline', 'article-19', 'article-18', 'article-17', 'article-16']);
    expect(new TextEncoder().encode(recent[0].body || '').byteLength).toBeLessThanOrEqual(8_192);
    expect(recent[0]).toMatchObject({ body_bytes: 28_000, body_r2_key: null, body_r2_key_bytes: 1_025 });
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id, sender_type,
      CASE WHEN body IS NULL THEN NULL ELSE CAST(substr(CAST(body AS BLOB), 1, ?) AS TEXT) END AS body
      FROM articles WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(8_192, 'tenant-A', 'ai-ticket', 5) as { detail: string }[];
    expect(plan.some(row => /SEARCH articles USING INDEX idx_articles_tenant_ticket_recent/.test(row.detail))).toBe(true);
  });

  it('completes mandatory enrollment from issued credentials and revokes the consumed challenge without changing another tenant', async () => {
    const JWT_SECRET = 'synthetic-enrollment-jwt-secret';
    const env = { DB: d1, JWT_SECRET, MFA_ENCRYPTION_KEY: 'synthetic-enrollment-key' } as any;
    const service = new AuthService(env);
    const password = 'synthetic-enrollment-password';
    const hash = await service.hashPassword(password);
    sqlite.prepare('INSERT INTO users(tenant_id,id,email,role,password_hash) VALUES (?,?,?,?,?)')
      .run('tenant-A', 'shared-operator', 'enroll-a@example.invalid', 'admin', hash);
    sqlite.prepare('INSERT INTO users(tenant_id,id,email,role,password_hash) VALUES (?,?,?,?,?)')
      .run('tenant-B', 'shared-operator', 'enroll-b@example.invalid', 'admin', hash);
    const request = (path: string, token?: string, body?: unknown) => authHandler.request(path, {
      method: path === '/me' ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    const login = await request('/login', undefined, { email: 'enroll-a@example.invalid', password });
    expect(login.status).toBe(200);
    const challenge = await login.json();
    expect(challenge.mfa_required).toBe(true);
    expect(challenge.user.mfa_enabled).toBe(false);
    expect((await request('/me', challenge.token)).status).toBe(401);
    const setup = await request('/mfa/setup', challenge.token);
    expect(setup.status).toBe(200);
    const authenticator = OTPAuth.URI.parse((await setup.json()).provisioning_uri) as OTPAuth.TOTP;
    const code = authenticator.generate();
    const invalidCode = Array.from({ length: 10 }, (_, digit) => String(digit).repeat(6))
      .find(candidate => authenticator.validate({ token: candidate, window: 1 }) === null)!;
    expect((await request('/mfa/confirm', challenge.token, { code: invalidCode })).status).toBe(400);
    const confirmed = await request('/mfa/confirm', challenge.token, { code });
    expect(confirmed.status).toBe(200);
    const session = await confirmed.json();
    expect(session.user.mfa_enabled).toBe(true);
    expect((await request('/me', session.token)).status).toBe(200);
    expect((await request('/mfa/setup', challenge.token)).status).toBe(401);
    expect((await request('/mfa/confirm', challenge.token, { code })).status).toBe(401);
    const a = sqlite.prepare('SELECT mfa_enabled,session_version FROM users WHERE tenant_id=? AND id=?').get('tenant-A', 'shared-operator');
    const b = sqlite.prepare('SELECT mfa_enabled,session_version,mfa_secret FROM users WHERE tenant_id=? AND id=?').get('tenant-B', 'shared-operator');
    expect(a).toEqual({ mfa_enabled: 1, session_version: 1 });
    expect(b).toEqual({ mfa_enabled: 0, session_version: 0, mfa_secret: null });
    expect((await request('/logout', session.token)).status).toBe(200);
    expect((await request('/mfa/setup', session.token)).status).toBe(401);
  });

  it('rejects stale enrollment writes in both setup/confirmation interleavings', async () => {
    sqlite.prepare('INSERT INTO users(tenant_id,id,email,role) VALUES (?,?,?,?)')
      .run('tenant-A', 'user-A', 'race-a@example.invalid', 'admin');
    sqlite.prepare('INSERT INTO users(tenant_id,id,email,role) VALUES (?,?,?,?)')
      .run('tenant-B', 'user-A', 'race-b@example.invalid', 'admin');
    // Confirmation read secret one before a second setup rotates the pending secret.
    expect(await reposA.users.beginMfaEnrollment('user-A', 'pending-one', 0)).toBe(true);
    const original = await reposA.users.get('user-A');
    expect(await reposA.users.beginMfaEnrollment('user-A', 'pending-two', 0)).toBe(true);
    expect(await reposA.users.completeMfaEnrollment('user-A', original!.mfa_secret!, 0)).toBe(false);
    // A setup request read disabled/version zero before this confirmation won.
    expect(await reposA.users.completeMfaEnrollment('user-A', 'pending-two', 0)).toBe(true);
    expect(await reposA.users.beginMfaEnrollment('user-A', 'late-pending-secret', 0)).toBe(false);
    expect(await reposA.users.completeMfaEnrollment('user-A', 'pending-two', 0)).toBe(false);
    const current = await reposA.users.get('user-A');
    expect(current?.mfa_secret === 'pending-two').toBe(true);
    expect(current?.mfa_enabled).toBe(1);
    expect(current?.session_version).toBe(1);
    const sibling = await reposB.users.get('user-A');
    expect(sibling?.mfa_enabled).toBe(0);
    expect(sibling?.mfa_secret).toBeNull();
  });

  it('lists only current actor drafts on accessible tickets without exposing bodies or other tenants', async () => {
    for (const tenant of ['tenant-A', 'tenant-B']) {
      for (const actor of ['user-A', 'user-B']) sqlite.prepare('INSERT INTO users(tenant_id,id,email,role) VALUES (?,?,?,?)')
        .run(tenant, actor, `${tenant}-${actor}@example.invalid`, 'agent');
      sqlite.prepare('INSERT INTO groups(tenant_id,id,name) VALUES (?,?,?)').run(tenant, 'restricted', 'Restricted');
      for (const id of ['a', 'b', 'c']) sqlite.prepare('INSERT INTO tickets(tenant_id,id,subject,customer_email,source,group_id) VALUES (?,?,?,?,?,?)')
        .run(tenant, id, 'Synthetic', 'customer@example.invalid', 'dashboard', id === 'b' ? 'restricted' : null);
    }
    const sameActorB = createRepositories(createVerifiedTenantScope('tenant-B', 'user-A', ['agent'], 1), d1);
    const otherActorA = createRepositories(createVerifiedTenantScope('tenant-A', 'user-B', ['agent'], 1), d1);
    for (const repos of [reposA, sameActorB, otherActorA]) for (const ticketId of ['a', 'b', 'c']) {
      await repos.operatorWorkspace.saveDraft({ ticketId, expectedGeneration: null, expectedRevision: 0,
        mode: 'internal', body: 'private synthetic body', attachments: [], expiresAt: null });
    }
    const first = await reposA.operatorWorkspace.listDrafts('', 1);
    expect(first.items.map(item => item.ticketId)).toEqual(['a']);
    expect(first.next).toBe('a');
    expect(Object.keys(first.items[0]).sort()).toEqual(['ticketId', 'updatedAt']);
    const second = await reposA.operatorWorkspace.listDrafts(first.next!, 1);
    expect(second.items.map(item => item.ticketId)).toEqual(['c']);
    expect(second.next).toBeNull();
    sqlite.prepare('INSERT INTO user_groups(tenant_id,user_id,group_id) VALUES (?,?,?)').run('tenant-A', 'user-A', 'restricted');
    expect((await reposA.operatorWorkspace.listDrafts()).items.map(item => item.ticketId)).toEqual(['a', 'b', 'c']);
    sqlite.prepare('DELETE FROM user_groups WHERE tenant_id=? AND user_id=?').run('tenant-A', 'user-A');
    expect((await reposA.operatorWorkspace.listDrafts()).items.map(item => item.ticketId)).toEqual(['a', 'c']);
    sqlite.prepare('DELETE FROM operator_drafts WHERE tenant_id=? AND user_id=?').run('tenant-A', 'user-A');
    expect((await reposA.operatorWorkspace.listDrafts()).items).toEqual([]);
    expect((await sameActorB.operatorWorkspace.listDrafts()).items).toHaveLength(2);
    expect((await otherActorA.operatorWorkspace.listDrafts()).items).toHaveLength(2);
    await expect(reposA.operatorWorkspace.listDrafts('', 51)).rejects.toThrow('Invalid draft page');
  });

  it('keeps draft retention disabled without an injected policy and enforces the scoped group gate', async () => {
    sqlite.prepare('INSERT INTO users(tenant_id,id,email,role,mfa_enabled) VALUES (?,?,?,?,?)')
      .run('tenant-A', 'user-A', 'operator-a@example.test', 'agent', 1);
    sqlite.prepare('INSERT INTO groups (tenant_id,id,name) VALUES (?,?,?)').run('tenant-A', 'restricted-group', 'Restricted');
    sqlite.prepare(`INSERT INTO tickets (tenant_id,id,subject,customer_email,source,group_id)
      VALUES (?,?,?,?,?,?)`).run('tenant-A', 'restricted-ticket', 'Restricted', 'customer@example.test', 'dashboard', 'restricted-group');
    const deps = { scope: scopeA, repositories: reposA, attachmentStorage: { getAttachment: async () => null } } as any;
    const denied = new OperatorWorkspaceService(deps);
    await expect(denied.saveDraft({ ticketId: 'restricted-ticket', expectedGeneration: null, expectedRevision: 0, mode: 'public', body: '', attachments: [] }))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<OperatorWorkspaceError>);
    expect(await reposA.operatorWorkspace.getDraft('restricted-ticket')).toBeNull();
    await expect(denied.purgeExpired()).rejects.toThrow('not configured');

    sqlite.prepare('INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES (?,?,?,?,?)')
      .run('tenant-A', 'retention-ticket', 'Retention', 'customer@example.test', 'dashboard');
    let now = new Date('2040-01-01T00:00:00.000Z');
    const retained = new OperatorWorkspaceService(deps, {
      now: () => now,
      retention: { expiresAt: date => new Date(date.getTime() + 60_000).toISOString() },
    });
    const saved = await retained.saveDraft({ ticketId: 'retention-ticket', expectedGeneration: null, expectedRevision: 0, mode: 'public', body: '', attachments: [] });
    expect(saved.expiresAt).toBe('2040-01-01T00:01:00.000Z');
    expect(await retained.purgeExpired()).toBe(0);
    now = new Date('2040-01-01T00:01:00.000Z');
    expect(await retained.purgeExpired()).toBe(1);
    await expect(reposA.operatorWorkspace.purgeExpiredForActor(now.toISOString(), 0)).rejects.toThrow('Invalid operator draft cleanup limit');
    await expect(reposA.operatorWorkspace.purgeExpiredForSystem(now.toISOString())).rejects.toThrow('System scope required');
    expect(await reposA.operatorWorkspace.getDraft('retention-ticket')).toBeNull();
  });

  it('returns no stale workspace row when selection cleanup loses a concurrent state save', async () => {
    sqlite.prepare('INSERT INTO users(tenant_id,id,email,role,mfa_enabled) VALUES (?,?,?,?,?)')
      .run('tenant-A', 'user-A', 'workspace-a@example.test', 'agent', 1);
    const first = await reposA.operatorWorkspace.saveWorkspaceState({
      expectedRevision: 0, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '', listAnchor: 'one',
      selectedTicketId: 'gone-ticket', panel: 'conversation',
    });
    expect(first?.revision).toBe(1);
    const concurrent = await reposA.operatorWorkspace.saveWorkspaceState({
      expectedRevision: 1, view: 'all', sort: 'updated_desc', filters: {}, listQuery: '', listAnchor: 'two',
      selectedTicketId: null, panel: 'conversation',
    });
    expect(concurrent?.revision).toBe(2);
    expect(await reposA.operatorWorkspace.clearSelectedTicketIfVersion('gone-ticket', 1)).toBeNull();
    expect(await reposA.operatorWorkspace.getWorkspaceState()).toMatchObject({ revision: 2, listAnchor: 'two', selectedTicketId: null });
  });

  it('enforces request limits across fresh repositories while isolating tenants', async () => {
    const requests = Array.from({ length: 12 }, () => createRepositories(scopeA, d1).requestLimits.consume('chat:shared-user', 5, 60000, 1000));
    expect((await Promise.all(requests)).filter(Boolean)).toHaveLength(5);
    expect(await reposB.requestLimits.consume('chat:shared-user', 5, 60000, 1000)).toBe(true);
    expect(await reposA.requestLimits.consume('chat:shared-user', 5, 60000, 61000)).toBe(true);
  });

  it('parses the complete migration chain including quoted delimiters and trigger bodies', () => {
    const target = new Database(':memory:');
    target.pragma('foreign_keys = ON');
    for (const name of readdirSync(join(__dirname, '../../../migrations')).filter(n => n.endsWith('.sql')).sort()) {
      for (const statement of splitSql(readFileSync(join(__dirname, '../../../migrations', name), 'utf8'))) target.exec(statement);
    }
    expect(splitSql("SELECT 'a;--b'; /* ignored; */ SELECT CASE WHEN 1 THEN 'x' ELSE 'y' END;")).toHaveLength(2);
    target.close();
  });

  it('revokes copied staff and widget tokens through the real logout routes while preserving another tenant', async () => {
    const secret = 'synthetic-revocation-secret';
    const env = { DB: d1, JWT_SECRET: secret } as any;
    const observedEnv = { ...env, ENVIRONMENT: 'test', LOCAL_BETA_ENABLED: 'false', OBSERVABILITY_MODE: 'isolated-evidence' } as any;
    const service = new AuthService(env);
    const a = await reposA.users.create({ email: 'a@revocation.test', role: 'agent', mfa_enabled: true } as any);
    const b = await reposB.users.create({ email: 'b@revocation.test', role: 'agent', mfa_enabled: true } as any);
    const token = await service.generateToken(a, secret, true);
    const other = await service.generateToken(b, secret, true);
    const authSignals: RequestAuthSliSnapshot[] = [];
    const app = new Hono();
    app.use('*', (c, next) => operationalObservability(c as any, next, () => {}, event => { authSignals.push(event); }));
    app.route('/auth', authHandler).route('/customer', customerHandler);
    expect((await app.request('/auth/me', { headers: { Authorization: `Bearer ${token}` } }, observedEnv)).status).toBe(200);
    expect((await app.request('/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, observedEnv)).status).toBe(200);
    expect((await app.request('/auth/me', { headers: { Authorization: `Bearer ${token}` } }, observedEnv)).status).toBe(401);
    expect(await service.verifyToken(token)).toBeNull();
    expect(await service.verifyToken(other)).not.toBeNull();
    expect((await app.request('/auth/me', { headers: { Authorization: `Bearer ${other}` } }, observedEnv)).status).toBe(200);
    expect(authSignals.map(event => event.counts)).toEqual([
      { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 },
      { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 },
      { attempted: 1, accepted: 0, denied: 1, unavailable: 0, challenge: 0 },
      { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 },
    ]);
    const fresh = await service.generateToken((await reposA.users.get(a.id))!, secret, true);
    expect(await service.verifyToken(fresh)).not.toBeNull();
    const customer = await reposA.users.create({ email: 'customer@revocation.test', role: 'customer', mfa_enabled: false } as any);
    const widget = await new jose.SignJWT({ sub: customer.id, tenant_id: 'tenant-A', email: customer.email, role: 'customer', session_version: 0 })
      .setProtectedHeader({ alg: 'HS256' }).setAudience('widget').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    expect((await app.request('/customer/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${widget}` } }, env)).status).toBe(200);
    expect((await app.request('/customer/auth/me', { headers: { Authorization: `Bearer ${widget}` } }, env)).status).toBe(401);
    const unavailable = { ...env, DB: { prepare() { throw new Error('Database unavailable'); } } };
    const failedLogout = await app.request('/customer/auth/logout', { method: 'POST', headers: { Cookie: `lumina_customer_token=${widget}` } }, unavailable);
    expect(failedLogout.status).toBe(401);
    expect(failedLogout.headers.get('Set-Cookie')).toContain('lumina_customer_token=;');
    expect(failedLogout.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('invalidates sessions across role roundtrips, credential changes and membership removal', async () => {
    const a = await reposA.users.create({ email: 'authority@revocation.test', role: 'agent', mfa_enabled: true } as any);
    const secret = 'synthetic-secret'; const service = new AuthService({ DB: d1, JWT_SECRET: secret } as any);
    const original = await service.generateToken(a, secret, true);
    sqlite.prepare("UPDATE users SET role = 'customer' WHERE id = ?").run(a.id);
    sqlite.prepare("UPDATE users SET role = 'agent' WHERE id = ?").run(a.id);
    expect(await service.verifyToken(original)).toBeNull();
    for (const [column, value] of [['email', 'changed@revocation.test'], ['password_hash', 'changed'], ['mfa_secret', 'rotated-enabled-secret'], ['mfa_enabled', 0]]) {
      const token = await service.generateToken((await reposA.users.get(a.id))!, secret, true);
      sqlite.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(value, a.id);
      expect(await service.verifyToken(token)).toBeNull();
    }
    sqlite.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('tenant-A','group','Group')").run();
    sqlite.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('tenant-A',?,'group')").run(a.id);
    const token = await service.generateToken((await reposA.users.get(a.id))!, secret, true);
    sqlite.prepare("DELETE FROM user_groups WHERE tenant_id = 'tenant-A' AND user_id = ?").run(a.id);
    expect(await service.verifyToken(token)).toBeNull();
  });

  it('freezes retention ownership against concurrent writes and retries an external failure without losing the manifest', async () => {
    const ticket = await reposA.tickets.create({ subject: 'Expired', customer_email: 'c@test.com', source: 'email', status: 'closed', priority: 'normal' } as any);
    const article = await reposA.articles.create({ ticket_id: ticket.id, sender_type: 'customer', body: 'Body', is_internal: false } as any);
    const attachment = await reposA.attachments.create({ article_id: article.id, file_name: 'a', file_size: 1, content_type: 'text/plain', r2_key: 'file' } as any);
    sqlite.prepare("UPDATE tickets SET updated_at = '2000-01-01' WHERE id = ?").run(ticket.id);
    const deleted = new Set<string>(); let fail = true;
    const service = new TenantAutomationService({ repositories: { ...reposA,
      automations: { getActiveRules: async () => [{ action_config: '{"days_to_keep":30,"delete_attachments":true}' }] } },
      attachmentStorage: { deleteAttachment: async (key: string) => {
        await expect(reposA.articles.create({ ticket_id: ticket.id, sender_type: 'customer', body: 'Late' } as any)).rejects.toThrow('retention');
        await expect(reposA.attachments.create({ ...attachment, r2_key: 'late' })).rejects.toThrow('retention');
        await expect(reposA.articles.update(article.id, { body: 'Changed' })).rejects.toThrow('retention');
        await expect(reposA.attachments.delete(attachment.id)).rejects.toThrow('retention');
        await expect(reposA.tickets.update(ticket.id, { status: 'open' })).rejects.toThrow('retention');
        await expect(reposA.tickets.withExternalWrite(ticket.id, async () => {})).rejects.toThrow('busy');
        if (fail) throw new Error('Storage unavailable'); deleted.add(key);
      } } } as any);
    expect(await service.runRetention()).toEqual({ deleted_tickets: 0, deleted_attachments: 0 });
    expect(await reposA.attachments.get(attachment.id)).not.toBeNull();
    expect(await reposB.tickets.claimRetention(ticket.id, '2099-01-01')).toBeNull();
    expect(await reposA.tickets.completeRetention(ticket.id, 'wrong')).toBe(false);
    fail = false;
    expect(await service.runRetention()).toEqual({ deleted_tickets: 1, deleted_attachments: 1 });
    expect(deleted).toEqual(new Set(['file']));
    expect(await reposA.tickets.get(ticket.id)).toBeNull();
    expect(sqlite.prepare('SELECT count(*) AS n FROM ticket_cleanup_claims').get()).toEqual({ n: 0 });
  });

  it('does not start retention during a durable external write and ignores stale finalizers', async () => {
    const ticket = await reposA.tickets.create({ subject: 'Expired', customer_email: 'c@test.com', source: 'email', status: 'closed', priority: 'normal' } as any);
    await reposA.tickets.withExternalWrite(ticket.id, async () => {
      expect(await reposA.tickets.claimRetention(ticket.id, '2099-01-01')).toBeNull();
      expect(await reposA.tickets.completeRetention(ticket.id, 'wrong')).toBe(false);
      expect(await reposA.tickets.get(ticket.id)).not.toBeNull();
    });
    const claim = (await reposA.tickets.claimRetention(ticket.id, '2099-01-01'))!;
    expect(await reposA.tickets.completeRetention(ticket.id, claim.token)).toBe(true);
    expect(await reposA.tickets.completeRetention(ticket.id, claim.token)).toBe(false);
  });

  it('retains uncertain write claims and rolls back a failed database finalization', async () => {
    const ticket = await reposA.tickets.create({ subject: 'Cleanup', customer_email: 'c@test.com', source: 'email', status: 'closed', priority: 'normal' } as any);
    await expect(reposA.tickets.withExternalWrite(ticket.id, async () => { throw new Error('Unknown remote outcome'); })).rejects.toThrow('Unknown');
    expect(await reposA.tickets.claimRetention(ticket.id, '2099-01-01')).toBeNull();
    const writeClaim = sqlite.prepare('SELECT token FROM ticket_cleanup_claims WHERE ticket_id = ?').get(ticket.id) as any;
    await reposA.tickets.releaseClaim(ticket.id, writeClaim.token);
    const article = await reposA.articles.create({ ticket_id: ticket.id, sender_type: 'customer', body: 'Body' } as any);
    const attachment = await reposA.attachments.create({ article_id: article.id, file_name: 'a', file_size: 1, content_type: 'text/plain', r2_key: 'file' } as any);
    sqlite.exec('CREATE TABLE blocking_reference (tenant_id TEXT, article_id TEXT, FOREIGN KEY(tenant_id, article_id) REFERENCES articles(tenant_id,id))');
    sqlite.prepare('INSERT INTO blocking_reference VALUES (?,?)').run('tenant-A', article.id);
    const claim = (await reposA.tickets.claimRetention(ticket.id, '2099-01-01'))!;
    await expect(reposA.tickets.completeRetention(ticket.id, claim.token)).rejects.toThrow('FOREIGN KEY');
    expect(await reposA.attachments.get(attachment.id)).not.toBeNull();
    expect(sqlite.prepare('SELECT mode FROM ticket_cleanup_claims WHERE ticket_id = ?').get(ticket.id)).toEqual({ mode: 'retention' });
    sqlite.exec('DELETE FROM blocking_reference');
    expect(await reposA.tickets.completeRetention(ticket.id, claim.token)).toBe(true);
  });

  it('withdraws QA visibility without an unadmitted legacy vector deletion', async () => {
    const ticket = await reposA.tickets.create({ subject: 'QA', customer_email: 'c@test.com', source: 'email', status: 'closed', priority: 'normal' } as any);
    const article = await reposA.articles.create({ ticket_id: ticket.id, sender_type: 'agent', body: 'Previously public' } as any);
    await reposA.articles.updateQAState(article.id, 'answer', 1);
    const deleteByIds = vi.fn();
    const service = new TenantKnowledgeService({ database: d1, scope: scopeA, repositories: reposA, attachmentStorage: {}, vectorStorage: { deleteByIds } } as any, {} as any);
    await service.markArticleAsQA(article.id, null);
    expect(await reposA.articles.get(article.id)).toMatchObject({ qa_type: null, chunk_count: 0 });
    expect(await reposA.tickets.claimRetention(ticket.id, '2099-01-01')).not.toBeNull();
    expect(deleteByIds).not.toHaveBeenCalled();
  });

  it('marks answer, SOP, and unmarked states without crossing tenants or rewriting legacy questions', async () => {
    const ticketA = await reposA.tickets.create({ subject: 'QA A', customer_email: 'a@test.com', source: 'email', status: 'open', priority: 'normal' } as any);
    const ticketB = await reposB.tickets.create({ subject: 'QA B', customer_email: 'b@test.com', source: 'email', status: 'open', priority: 'normal' } as any);
    const articleA = await reposA.articles.create({ ticket_id: ticketA.id, sender_type: 'agent', body: 'Answer body' } as any);
    const articleB = await reposB.articles.create({ ticket_id: ticketB.id, sender_type: 'agent', body: 'B body', qa_type: 'question' } as any);
    await reposB.articles.updateQAState(articleB.id, 'question' as any, 7);
    const upsert = vi.fn(async () => undefined);
    const deleteByIds = vi.fn(async () => undefined);
    const service = new TenantKnowledgeService({ database: d1, scope: scopeA, repositories: reposA, attachmentStorage: { putAttachment: vi.fn() }, vectorStorage: { upsert, deleteByIds } } as any, { generateEmbeddings: vi.fn(async () => [0.1]) } as any);

    await service.markArticleAsQA(articleA.id, 'answer');
    expect((await reposA.articles.get(articleA.id))?.qa_type).toBe('answer');
    await service.markArticleAsQA(articleA.id, 'sop');
    expect((await reposA.articles.get(articleA.id))?.qa_type).toBe('sop');
    await service.markArticleAsQA(articleA.id, null);
    expect(await reposA.articles.get(articleA.id)).toMatchObject({ qa_type: null, chunk_count: 0 });
    expect(await reposB.articles.get(articleB.id)).toMatchObject({ qa_type: 'question', chunk_count: 7 });
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteByIds).not.toHaveBeenCalled();
  });

  it('revalidates public QA against tenant rows despite stale Answer vector metadata', async () => {
    const ticketA = await reposA.tickets.create({ subject: 'A', customer_email: 'a@example.invalid', source: 'email', status: 'open', priority: 'normal' } as any);
    const ticketB = await reposB.tickets.create({ subject: 'B', customer_email: 'b@example.invalid', source: 'email', status: 'open', priority: 'normal' } as any);
    const articles = [];
    for (const [label, marker, internal, foreign] of [
      ['Public answer', 'answer', false, false], ['Internal SOP', 'sop', false, false],
      ['Private answer', 'answer', true, false], ['Legacy question', 'question', false, false],
      ['Tenant B answer', 'answer', false, true],
    ] as const) {
      const repositories = foreign ? reposB : reposA;
      const article = await repositories.articles.create({ticket_id:foreign ? ticketB.id : ticketA.id, sender_type:'agent', body:label, is_internal:internal} as any);
      await repositories.articles.updateQAState(article.id, marker as any, 1);
      articles.push(article);
    }
    const query = vi.fn().mockResolvedValue({matches:articles.map(article => ({score:1, metadata:{source_id:article.id,type:'qa',tier:'answer',status:'published',text:'Stale vector text'}}))});
    const reader = new WidgetKnowledgeReader({repositories:reposA,attachmentStorage:{},vectorStorage:{query}} as any, {generateEmbeddings:vi.fn().mockResolvedValue([1])} as any);
    expect(await reader.search('synthetic query', 10)).toEqual([{content:'Public answer'}]);
    expect(query).toHaveBeenCalledWith([1],{topK:10,filter:{tier:'answer',status:'published'},returnMetadata:true});
    expect(await reposA.articles.get(articles[3].id)).toMatchObject({qa_type:'question',chunk_count:1});
    expect(await reposB.articles.get(articles[4].id)).toMatchObject({qa_type:'answer',chunk_count:1});
  });

  it.each(['2026-09-01T12:00:00.000Z', '2026-09-01 12:00:00'])('compares retention times chronologically at the boundary (%s)', async cutoff => {
    for (const [index, timestamp] of ['2026-09-01 11:59:59', '2026-09-01T11:59:59.000Z', '2026-09-01 12:00:00', '2026-09-01 12:00:01', '2026-09-01T12:00:01.000Z', 'invalid'].entries()) {
      const ticket = await reposA.tickets.create({ subject: `Boundary ${index}`, customer_email: 'c@test.com', source: 'email', status: 'closed', priority: 'normal' } as any);
      sqlite.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(timestamp, ticket.id);
      const selected = await reposA.tickets.findTicketsForRetention(cutoff);
      const claim = await reposA.tickets.claimRetention(ticket.id, cutoff);
      expect(selected.some(row => row.id === ticket.id)).toBe(index < 2);
      expect(Boolean(claim)).toBe(index < 2);
    }
  });

  it('binds OTP redemption to its tenant and challenge and limits guesses durably', async () => {
    const a = await reposA.users.create({ email: 'otp-a@example.com', role: 'customer', mfa_enabled: false } as any);
    const b = await reposB.users.create({ email: 'otp-b@example.com', role: 'customer', mfa_enabled: false } as any);
    const expiry = new Date(Date.now() + 60000).toISOString();
    const now = new Date().toISOString();
    await reposA.users.storeCustomerAuthToken(a.id, 'challenge-a', 'hash-a', 'otp', expiry);
    await reposB.users.storeCustomerAuthToken(b.id, 'challenge-b', 'hash-b', 'otp', expiry);
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('hash-b', now, 'challenge-b')).toBeNull();
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('hash-a', now)).toBeNull();
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('hash-b', now, 'challenge-a')).toBeNull();
    expect((await reposA.users.verifyAndConsumeCustomerAuthToken('hash-a', now, 'challenge-a'))?.id).toBe(a.id);
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('hash-a', now, 'challenge-a')).toBeNull();
    await Promise.all(Array.from({ length: 8 }, () => reposB.users.verifyAndConsumeCustomerAuthToken('wrong', now, 'challenge-b')));
    expect(sqlite.prepare("SELECT attempts FROM customer_auth_tokens WHERE id = 'challenge-b'").get()).toEqual({ attempts: 5 });
    expect(await reposB.users.verifyAndConsumeCustomerAuthToken('hash-b', now, 'challenge-b')).toBeNull();
    await reposA.users.storeCustomerAuthToken(a.id, 'old', 'old-hash', 'otp', expiry);
    await reposA.users.storeCustomerAuthToken(a.id, 'new', 'new-hash', 'otp', expiry);
    expect(await reposA.users.verifyAndConsumeCustomerAuthToken('old-hash', now, 'old')).toBeNull();
    expect((await reposA.users.verifyAndConsumeCustomerAuthToken('new-hash', now, 'new'))?.id).toBe(a.id);
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
