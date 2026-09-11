import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

export type TicketListScanSnapshot = Readonly<{
  ticketRows: number;
  ticketSearchBytes: number;
  articleRows: number;
  articleSearchBytes: number;
  revision: number;
  filter?: Readonly<{ id: string; conditionBytes: number; revision: number; exists: boolean }>;
}>;
export type TicketListCurrentCredential = Readonly<{ role: 'admin' | 'agent' | 'customer'; sessionVersion: number; expiresAt: number; email?: string }>;

export class TicketListScanError extends Error {
  constructor(readonly code: 'unavailable' | 'fence_changed' | 'authority_changed') {
    super(code === 'fence_changed' ? 'Ticket list changed while capacity was being reserved' : 'Ticket list accounting is unavailable');
    this.name = 'TicketListScanError';
  }
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * This repository reads only compact maintained counters. It never counts a
 * ticket/article history in order to decide whether a request can be admitted.
 */
export class TicketListScanRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async snapshot(filterId?: string): Promise<TicketListScanSnapshot> {
    const base = await this.db.prepare(`SELECT ticket_rows,ticket_search_bytes,article_rows,article_search_bytes,revision
      FROM ticket_list_scan_counters WHERE tenant_id=? LIMIT 1`).bind(this.scope.tenantId).first<{
        ticket_rows: number; ticket_search_bytes: number; article_rows: number; article_search_bytes: number; revision: number;
      }>();
    const values = base && [base.ticket_rows, base.ticket_search_bytes, base.article_rows, base.article_search_bytes, base.revision].map(count);
    if (!values || values.some(value => value === null)) throw new TicketListScanError('unavailable');
    let filter: TicketListScanSnapshot['filter'];
    if (filterId) {
      const row = await this.db.prepare(`SELECT condition_bytes,revision FROM ticket_list_filter_scan_counters
        WHERE tenant_id=? AND filter_id=? LIMIT 1`).bind(this.scope.tenantId, filterId).first<{ condition_bytes: number; revision: number }>();
      // The established missing-filter behavior is an empty list. Record the
      // absence so a newly-created filter cannot be parsed after admission.
      if (row) {
        const conditionBytes = count(row.condition_bytes), revision = count(row.revision);
        if (conditionBytes === null || revision === null) throw new TicketListScanError('unavailable');
        filter = { id: filterId, conditionBytes, revision, exists: true };
      } else filter = { id: filterId, conditionBytes: 0, revision: 0, exists: false };
    }
    return {
      ticketRows: values[0]!, ticketSearchBytes: values[1]!, articleRows: values[2]!, articleSearchBytes: values[3]!, revision: values[4]!,
      ...(filter ? { filter } : {}),
    };
  }
}

/** SQL fence shared by the count and page statements in one D1 batch. */
export function ticketListScanFenceSql(snapshot: TicketListScanSnapshot, tableAlias = 'tickets'): { sql: string; values: readonly unknown[] } {
  const filter = snapshot.filter;
  const filterSql = !filter ? '' : filter.exists
    ? ` AND EXISTS (SELECT 1 FROM ticket_list_filter_scan_counters f
        WHERE f.tenant_id=${tableAlias}.tenant_id AND f.filter_id=? AND f.condition_bytes<=? AND f.revision=?)`
    : ` AND NOT EXISTS (SELECT 1 FROM ticket_list_filter_scan_counters f
        WHERE f.tenant_id=${tableAlias}.tenant_id AND f.filter_id=?)`;
  return {
    sql: `EXISTS (SELECT 1 FROM ticket_list_scan_counters c WHERE c.tenant_id=${tableAlias}.tenant_id
      AND c.ticket_rows<=? AND c.ticket_search_bytes<=? AND c.article_rows<=? AND c.article_search_bytes<=?)${filterSql}`,
    values: [snapshot.ticketRows, snapshot.ticketSearchBytes, snapshot.articleRows, snapshot.articleSearchBytes,
      ...(!filter ? [] : filter.exists ? [filter.id, filter.conditionBytes, filter.revision] : [filter.id])],
  };
}

/** One compact assertion in the same D1 batch as the retained count/page. */
export function ticketListScanAssertionSql(tenantId: string, snapshot: TicketListScanSnapshot): { sql: string; values: readonly unknown[] } {
  const filter = snapshot.filter;
  return {
    sql: `SELECT 1 AS admitted FROM ticket_list_scan_counters c WHERE c.tenant_id=?
      AND c.ticket_rows<=? AND c.ticket_search_bytes<=? AND c.article_rows<=? AND c.article_search_bytes<=?
      ${!filter ? '' : filter.exists ? `AND EXISTS (SELECT 1 FROM ticket_list_filter_scan_counters f WHERE f.tenant_id=c.tenant_id AND f.filter_id=? AND f.condition_bytes<=? AND f.revision=?)` : `AND NOT EXISTS (SELECT 1 FROM ticket_list_filter_scan_counters f WHERE f.tenant_id=c.tenant_id AND f.filter_id=?)`}
      LIMIT 1`,
    values: [tenantId, snapshot.ticketRows, snapshot.ticketSearchBytes, snapshot.articleRows, snapshot.articleSearchBytes,
      ...(!filter ? [] : filter.exists ? [filter.id, filter.conditionBytes, filter.revision] : [filter.id])],
  };
}

/** Current credential predicate executed in the same D1 batch as count/page. */
export function ticketListCurrentCredentialSql(tenantId: string, actorId: string, credential: TicketListCurrentCredential): { sql: string; values: readonly unknown[] } {
  if (!Number.isSafeInteger(credential.sessionVersion) || credential.sessionVersion < 0 || !Number.isSafeInteger(credential.expiresAt)) return { sql: '0', values: [] };
  if (credential.role === 'customer') return { sql: `EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=? AND u.id=? AND u.role='customer'
    AND u.session_version=? AND lower(trim(u.email))=lower(trim(?)) AND ? > unixepoch())`, values: [tenantId, actorId, credential.sessionVersion, credential.email ?? '', credential.expiresAt] };
  return { sql: `EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=? AND u.id=? AND u.role=? AND u.session_version=?
    AND u.mfa_enabled=1 AND ? > unixepoch())`, values: [tenantId, actorId, credential.role, credential.sessionVersion, credential.expiresAt] };
}
