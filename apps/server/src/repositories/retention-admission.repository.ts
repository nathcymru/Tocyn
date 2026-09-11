import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

export const RETENTION_TENANT_BATCH = 16;
export const RETENTION_RULE_BATCH = 8;
export const RETENTION_TICKET_BATCH = 8;
export const RETENTION_EXTERNAL_BATCH = 100;

export type RetentionWorkKind = 'attachment' | 'article_body' | 'legacy_vector';
export type RetentionTicketCursor = Readonly<{ id: string; updatedAt: string }>;
export type RetentionWork = Readonly<{ itemKey: string; itemKind: RetentionWorkKind; attempts: number }>;
type Progress = Readonly<{ attachment_article_id: string | null; attachment_id: string | null; body_article_id: string | null;
  legacy_article_id: string | null; legacy_offset: number; attachments_done: number; bodies_done: number; legacy_done: number }>;

/** Tenant-scoped retention work. A retention claim freezes source rows, so the
 * keyset cursors can resume safely without an unbounded source-row manifest. */
export class RetentionAdmissionRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async nextTickets(cutoff: string, after: RetentionTicketCursor | null): Promise<readonly RetentionTicketCursor[]> {
    return (await this.db.prepare(`SELECT id,updated_at AS updatedAt FROM tickets WHERE tenant_id=? AND julianday(updated_at)<julianday(?)
      AND (? IS NULL OR julianday(updated_at)>julianday(?) OR (julianday(updated_at)=julianday(?) AND id>?))
      ORDER BY julianday(updated_at),id LIMIT ?`).bind(this.scope.tenantId, cutoff, after?.updatedAt ?? null, after?.updatedAt ?? null,
      after?.updatedAt ?? null, after?.id ?? null, RETENTION_TICKET_BATCH).all<RetentionTicketCursor>()).results;
  }

  async resumableTickets(ruleId: string): Promise<readonly { id: string; token: string }[]> {
    return (await this.db.prepare(`SELECT t.id,c.token FROM ticket_cleanup_claims c JOIN tickets t
      ON t.tenant_id=c.tenant_id AND t.id=c.ticket_id LEFT JOIN retention_ticket_progress p
      ON p.tenant_id=c.tenant_id AND p.ticket_id=c.ticket_id AND p.claim_token=c.token
      WHERE c.tenant_id=? AND c.mode='retention' AND (p.rule_id=? OR p.rule_id IS NULL)
      ORDER BY t.id LIMIT ?`).bind(this.scope.tenantId, ruleId, RETENTION_TICKET_BATCH).all<{id:string;token:string}>()).results;
  }

  private cursorName(ruleId: string): string { return `ticket:${this.scope.tenantId}:${ruleId}`; }
  async ticketCursor(ruleId: string): Promise<RetentionTicketCursor | null> {
    const row = await this.db.prepare(`SELECT ticket_id,ticket_updated_at AS updatedAt FROM retention_scheduler_cursors WHERE cursor_name=? LIMIT 1`)
      .bind(this.cursorName(ruleId)).first<{ticket_id:string|null;updatedAt:string|null}>();
    return row?.ticket_id && row.updatedAt ? { id: row.ticket_id, updatedAt: row.updatedAt } : null;
  }
  async setTicketCursor(ruleId: string, cursor: RetentionTicketCursor | null): Promise<void> {
    await this.db.prepare(`INSERT INTO retention_scheduler_cursors (cursor_name,tenant_id,rule_id,ticket_id,ticket_updated_at,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(cursor_name) DO UPDATE SET ticket_id=excluded.ticket_id,ticket_updated_at=excluded.ticket_updated_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(this.cursorName(ruleId),this.scope.tenantId,ruleId,cursor?.id ?? null,cursor?.updatedAt ?? null).run();
  }

  async ruleCursor(): Promise<string | null> {
    const row = await this.db.prepare(`SELECT rule_id FROM retention_scheduler_cursors WHERE cursor_name=? LIMIT 1`)
      .bind(`rule:${this.scope.tenantId}`).first<{rule_id:string|null}>();
    return row?.rule_id ?? null;
  }
  async setRuleCursor(ruleId: string | null): Promise<void> {
    await this.db.prepare(`INSERT INTO retention_scheduler_cursors (cursor_name,tenant_id,rule_id,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(cursor_name) DO UPDATE SET rule_id=excluded.rule_id,updated_at=CURRENT_TIMESTAMP`)
      .bind(`rule:${this.scope.tenantId}`,this.scope.tenantId,ruleId).run();
  }

  async begin(ticketId: string, token: string, ruleId: string): Promise<void> {
    await this.db.prepare(`INSERT OR IGNORE INTO retention_ticket_progress (tenant_id,ticket_id,claim_token,rule_id)
      VALUES (?,?,?,?)`).bind(this.scope.tenantId, ticketId, token, ruleId).run();
  }

  private async progress(ticketId: string, token: string): Promise<Progress | null> {
    return this.db.prepare(`SELECT attachment_article_id,attachment_id,body_article_id,legacy_article_id,legacy_offset,
      attachments_done,bodies_done,legacy_done FROM retention_ticket_progress
      WHERE tenant_id=? AND ticket_id=? AND claim_token=? LIMIT 1`).bind(this.scope.tenantId, ticketId, token).first<Progress>();
  }

  /** Materialize one finite external operation after prior work settles. */
  async materializeNext(ticketId: string, token: string): Promise<boolean> {
    const p = await this.progress(ticketId, token);
    if (!p || await this.hasOutstanding(ticketId, token)) return false;
    if (!p.attachments_done) {
      const row = await this.db.prepare(`SELECT a.id AS article_id,x.id AS attachment_id FROM attachments x
        JOIN articles a ON a.tenant_id=x.tenant_id AND a.id=x.article_id
        WHERE x.tenant_id=? AND a.ticket_id=? AND (? IS NULL OR a.id>? OR (a.id=? AND x.id>?))
        ORDER BY a.id,x.id LIMIT 1`).bind(this.scope.tenantId,ticketId,p.attachment_article_id,p.attachment_article_id,p.attachment_article_id,p.attachment_id ?? '').first<{ article_id:string; attachment_id:string }>();
      if (row) {
        await this.db.batch([
          this.db.prepare(`INSERT OR IGNORE INTO retention_cleanup_work (tenant_id,ticket_id,claim_token,item_key,item_kind,state)
            VALUES (?,?,?,?,?,'pending')`).bind(this.scope.tenantId,ticketId,token,`attachment:${row.attachment_id}`,'attachment'),
          this.db.prepare(`UPDATE retention_ticket_progress SET attachment_article_id=?,attachment_id=?,updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(row.article_id,row.attachment_id,this.scope.tenantId,ticketId,token),
        ]); return true;
      }
      await this.db.prepare(`UPDATE retention_ticket_progress SET attachments_done=1,updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(this.scope.tenantId,ticketId,token).run(); return true;
    }
    if (!p.bodies_done) {
      const row = await this.db.prepare(`SELECT id FROM articles WHERE tenant_id=? AND ticket_id=? AND body_r2_key IS NOT NULL
        AND (? IS NULL OR id>?) ORDER BY id LIMIT 1`).bind(this.scope.tenantId,ticketId,p.body_article_id,p.body_article_id).first<{id:string}>();
      if (row) { await this.db.batch([
        this.db.prepare(`INSERT OR IGNORE INTO retention_cleanup_work (tenant_id,ticket_id,claim_token,item_key,item_kind,state)
          VALUES (?,?,?,?,?,'pending')`).bind(this.scope.tenantId,ticketId,token,`body:${row.id}`,'article_body'),
        this.db.prepare(`UPDATE retention_ticket_progress SET body_article_id=?,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(row.id,this.scope.tenantId,ticketId,token),
      ]); return true; }
      await this.db.prepare(`UPDATE retention_ticket_progress SET bodies_done=1,updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(this.scope.tenantId,ticketId,token).run(); return true;
    }
    if (!p.legacy_done) {
      const row = await this.db.prepare(`SELECT id,chunk_count FROM articles WHERE tenant_id=? AND ticket_id=?
        AND (qa_type IS NOT NULL OR chunk_count > 0) AND (? IS NULL OR id>=?) ORDER BY id LIMIT 1`)
        .bind(this.scope.tenantId,ticketId,p.legacy_article_id,p.legacy_article_id).first<{id:string;chunk_count:number|null}>();
      if (!row) { await this.db.prepare(`UPDATE retention_ticket_progress SET legacy_done=1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(this.scope.tenantId,ticketId,token).run(); return true; }
      const count = row.chunk_count;
      if (!Number.isSafeInteger(count) || !count || count < 1 || count > 10_000) throw new Error('Vector cleanup manifest unavailable');
      const offset = p.legacy_article_id === row.id ? p.legacy_offset : 0;
      if (offset >= count) { await this.db.prepare(`UPDATE retention_ticket_progress SET legacy_article_id=?,legacy_offset=0,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(`${row.id}\uffff`,this.scope.tenantId,ticketId,token).run(); return true; }
      await this.db.batch([
        this.db.prepare(`INSERT OR IGNORE INTO retention_cleanup_work (tenant_id,ticket_id,claim_token,item_key,item_kind,state)
          VALUES (?,?,?,?,?,'pending')`).bind(this.scope.tenantId,ticketId,token,`legacy:${row.id}:${offset}`,'legacy_vector'),
        this.db.prepare(`UPDATE retention_ticket_progress SET legacy_article_id=?,legacy_offset=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND ticket_id=? AND claim_token=?`).bind(row.id,offset + RETENTION_EXTERNAL_BATCH,this.scope.tenantId,ticketId,token),
      ]); return true;
    }
    return false;
  }

  async recoverExpired(ticketId: string, token: string, now: string): Promise<void> {
    await this.db.prepare(`UPDATE retention_cleanup_work SET state='uncertain',updated_at=?
      WHERE tenant_id=? AND ticket_id=? AND claim_token=? AND state='claimed' AND lease_expires_at<=?`)
      .bind(now,this.scope.tenantId,ticketId,token,now).run();
  }

  async claimNext(ticketId: string, token: string, now: string, leaseExpiresAt: string): Promise<RetentionWork | null> {
    const row = await this.db.prepare(`SELECT item_key AS itemKey,item_kind AS itemKind,attempts FROM retention_cleanup_work
      WHERE tenant_id=? AND ticket_id=? AND claim_token=? AND state IN ('pending','uncertain') ORDER BY item_key LIMIT 1`)
      .bind(this.scope.tenantId,ticketId,token).first<RetentionWork>();
    if (!row) return null;
    const result = await this.db.prepare(`UPDATE retention_cleanup_work SET state='claimed',attempts=attempts+1,lease_expires_at=?,updated_at=?
      WHERE tenant_id=? AND ticket_id=? AND item_key=? AND claim_token=? AND state IN ('pending','uncertain') AND attempts<1000000`)
      .bind(leaseExpiresAt,now,this.scope.tenantId,ticketId,row.itemKey,token).run();
    return result.meta.changes === 1 ? { ...row, attempts: row.attempts + 1 } : null;
  }

  async recordAdmission(ticketId: string, itemKey: string, token: string, authorityRevision: number, reservationId: string): Promise<void> {
    await this.db.prepare(`UPDATE retention_cleanup_work SET authority_revision=?,recovery_reservation=?,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND ticket_id=? AND item_key=? AND claim_token=? AND state='claimed'`).bind(authorityRevision,reservationId,this.scope.tenantId,ticketId,itemKey,token).run();
  }
  async complete(ticketId: string, itemKey: string, token: string): Promise<void> { await this.db.prepare(`UPDATE retention_cleanup_work SET state='complete',lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE tenant_id=? AND ticket_id=? AND item_key=? AND claim_token=? AND state='claimed'`).bind(this.scope.tenantId,ticketId,itemKey,token).run(); }
  async uncertain(ticketId: string, itemKey: string, token: string): Promise<void> { await this.db.prepare(`UPDATE retention_cleanup_work SET state='uncertain',lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE tenant_id=? AND ticket_id=? AND item_key=? AND claim_token=? AND state='claimed'`).bind(this.scope.tenantId,ticketId,itemKey,token).run(); }
  async hasOutstanding(ticketId: string, token: string): Promise<boolean> { return !!await this.db.prepare(`SELECT 1 FROM retention_cleanup_work
    WHERE tenant_id=? AND ticket_id=? AND claim_token=? AND state!='complete' LIMIT 1`).bind(this.scope.tenantId,ticketId,token).first(); }
  async finished(ticketId: string, token: string): Promise<boolean> { const p = await this.progress(ticketId,token); return !!p && !!p.attachments_done && !!p.bodies_done && !!p.legacy_done && !await this.hasOutstanding(ticketId,token); }
}
