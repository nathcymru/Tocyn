import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { articleBodyFormat, type ArticleBodyFormat } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import { BetaAdmissionError } from '../types/local-beta';
import { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import { DRAFT_EXPIRY_SQL } from '../types/operator-draft-retention';
import type {
  OperatorDraft, OperatorDraftAttachment, OperatorDraftMode, OperatorWorkspaceFilters,
  OperatorWorkspaceSort, OperatorWorkspaceState, OperatorWorkspaceView,
  OperatorThemeMode, OperatorThemePreference,
} from '../types/operator-workspace';

type DraftRow = {
  ticket_id: string; generation: string; revision: number; mode: OperatorDraftMode; body: string; body_format?: ArticleBodyFormat; attachments: string;
  base_conversation_revision: number; expires_at: string | null; updated_at: string;
};
type StateRow = {
  revision: number; view_key: OperatorWorkspaceView; sort_key: OperatorWorkspaceSort; filters: string;
  list_query: string; list_anchor: string; selected_ticket_id: string | null; panel: 'conversation' | 'details'; updated_at: string;
};

const draftColumns = 'ticket_id,generation,revision,mode,body,body_format,attachments,base_conversation_revision,expires_at,updated_at';
const stateColumns = 'revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,updated_at';

function draftFromRow(row: DraftRow): OperatorDraft {
  return {
    ticketId: row.ticket_id, generation: row.generation, revision: row.revision, mode: row.mode, body: row.body,
    bodyFormat: articleBodyFormat(row.body_format),
    attachments: JSON.parse(row.attachments) as OperatorDraftAttachment[], baseConversationRevision: row.base_conversation_revision,
    expiresAt: row.expires_at, updatedAt: row.updated_at,
  };
}
function stateFromRow(row: StateRow): OperatorWorkspaceState {
  return {
    revision: row.revision, view: row.view_key, sort: row.sort_key, filters: JSON.parse(row.filters) as OperatorWorkspaceFilters,
    listQuery: row.list_query, listAnchor: row.list_anchor, selectedTicketId: row.selected_ticket_id, panel: row.panel, updatedAt: row.updated_at,
  };
}

export type DraftSaveInput = Readonly<{
  ticketId: string; expectedGeneration: string | null; expectedRevision: number; mode: OperatorDraftMode; body: string;
  /** Omitted legacy callers remain stored as plain text. */
  bodyFormat?: ArticleBodyFormat;
  attachments: readonly OperatorDraftAttachment[]; expiresAt: string | null;
  notExpiredAt?: string;
}>;
export type WorkspaceStateSaveInput = Readonly<{
  expectedRevision: number; view: OperatorWorkspaceView; sort: OperatorWorkspaceSort;
  filters: OperatorWorkspaceFilters; listQuery: string; listAnchor: string; selectedTicketId: string | null; panel: 'conversation' | 'details';
}>;
export type DraftRebaseInput = Readonly<{
  ticketId: string; expectedGeneration: string; expectedRevision: number; expectedReviewedConversationRevision: number;
  expiresAt: string | null; notExpiredAt?: string;
}>;
type MutationCondition = Readonly<{ sql: string; values: unknown[] }>;
export type OperatorPresentationCredential = Readonly<{ sessionVersion: number; expiresAt: number; role: 'agent' | 'admin' }>;

/** D1 persistence only; caller supplies trusted actor and ticket authorization. */
export class OperatorWorkspaceRepository {
  constructor(
    private readonly scope: VerifiedTenantScope,
    private readonly db: D1Database,
    private readonly betaAdmission?: LocalBetaAdmissionRepository,
  ) {}

  private themeAuthority(credential: OperatorPresentationCredential): MutationCondition {
    if (!this.scope.roles.includes(credential.role) || !Number.isSafeInteger(credential.sessionVersion)
      || credential.sessionVersion < 0 || !Number.isSafeInteger(credential.expiresAt)) return { sql: '0', values: [] };
    return {
      sql: `EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=? AND ? > unixepoch())`,
      values: [this.scope.tenantId, this.scope.actorId, credential.role, credential.sessionVersion, credential.expiresAt],
    };
  }

  /** An absent preference has an authoritative revision-zero default; a revoked actor has no row. */
  async getThemePreference(credential: OperatorPresentationCredential): Promise<OperatorThemePreference | null> {
    const authority = this.themeAuthority(credential);
    const row = await this.db.prepare(`SELECT COALESCE(p.revision,0) AS revision,COALESCE(p.mode,'system') AS mode,p.updated_at
      FROM users u LEFT JOIN operator_theme_preference p ON p.tenant_id=u.tenant_id AND p.user_id=u.id
      WHERE u.tenant_id=? AND u.id=? AND ${authority.sql}`)
      .bind(this.scope.tenantId, this.scope.actorId, ...authority.values)
      .first<{revision: number; mode: OperatorThemeMode; updated_at: string | null}>();
    return row ? { revision: row.revision, mode: row.mode, updatedAt: row.updated_at } : null;
  }

  async saveThemePreference(input: { expectedRevision: number; mode: OperatorThemeMode }, credential: OperatorPresentationCredential): Promise<OperatorThemePreference | null> {
    const authority = this.themeAuthority(credential);
    const condition: MutationCondition = {
      sql: `${authority.sql} AND ((?=0 AND NOT EXISTS (SELECT 1 FROM operator_theme_preference WHERE tenant_id=? AND user_id=?))
        OR EXISTS (SELECT 1 FROM operator_theme_preference WHERE tenant_id=? AND user_id=? AND revision=?))`,
      values: [...authority.values, input.expectedRevision, this.scope.tenantId, this.scope.actorId, this.scope.tenantId, this.scope.actorId, input.expectedRevision],
    };
    const statement = this.db.prepare(`INSERT INTO operator_theme_preference (tenant_id,user_id,revision,mode,updated_at)
      SELECT ?,?,1,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${condition.sql}
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET revision=operator_theme_preference.revision+1,
        mode=excluded.mode,updated_at=excluded.updated_at WHERE operator_theme_preference.revision=?
      RETURNING revision,mode,updated_at`)
      .bind(this.scope.tenantId, this.scope.actorId, input.mode, ...condition.values, input.expectedRevision);
    const row = await this.runWorkspaceMutation<{ revision: number; mode: OperatorThemeMode; updated_at: string }>(statement, condition);
    return row ? { revision: row.revision, mode: row.mode, updatedAt: row.updated_at } : null;
  }

  /** A local-beta assertion and counter share the same D1 batch as the CAS mutation. */
  private async runWorkspaceMutation<T>(statement: D1PreparedStatement, condition: MutationCondition): Promise<T | null> {
    if (!this.betaAdmission) return statement.first<T>();
    try {
      const results = await this.db.batch([...this.betaAdmission.conditionalConversationStatements(condition), statement]);
      return (results[results.length - 1]?.results?.[0] as T | undefined) ?? null;
    } catch {
      // Keep the externally visible local-beta failure classification, never turn an admission fault into a successful save.
      await this.betaAdmission.authorize('conversation');
      throw new BetaAdmissionError('beta_admission_unavailable', 503);
    }
  }

  async getDraft(ticketId: string, notExpiredAt?: string): Promise<OperatorDraft | null> {
    const row = await this.db.prepare(`SELECT ${draftColumns} FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?
      AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?)`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, notExpiredAt ?? null, notExpiredAt ?? null).first<DraftRow>();
    return row ? draftFromRow(row) : null;
  }

  /** Bounded, body-free input for Drafts views; current group membership is checked in the read. */
  async listDrafts(afterTicketId = '', limit = 50, notExpiredAt?: string): Promise<{ items: { ticketId: string; updatedAt: string }[]; next: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || afterTicketId.length > 128) throw new Error('Invalid draft page');
    const { results } = await this.db.prepare(`SELECT d.ticket_id,d.updated_at FROM operator_drafts d
      JOIN tickets t ON t.tenant_id=d.tenant_id AND t.id=d.ticket_id
      WHERE d.tenant_id=? AND d.user_id=? AND d.ticket_id>?
        AND (? IS NULL OR ${DRAFT_EXPIRY_SQL.replaceAll('expires_at', 'd.expires_at').replaceAll('updated_at', 'd.updated_at')}>?)
        AND (?=0 OR t.group_id IS NULL OR EXISTS (
          SELECT 1 FROM user_groups ug WHERE ug.tenant_id=t.tenant_id AND ug.group_id=t.group_id AND ug.user_id=?
        )) ORDER BY d.ticket_id LIMIT ?`)
      .bind(this.scope.tenantId, this.scope.actorId, afterTicketId, notExpiredAt ?? null, notExpiredAt ?? null, this.scope.roles.includes('agent') ? 1 : 0, this.scope.actorId, limit + 1)
      .all<{ ticket_id: string; updated_at: string }>();
    const rows = results ?? [];
    const items = rows.slice(0, limit).map(row => ({ ticketId: row.ticket_id, updatedAt: row.updated_at }));
    return { items, next: rows.length > limit ? items[items.length - 1].ticketId : null };
  }

  /** A returned row is the only completed save signal. Generation prevents delete/recreate ABA. */
  async saveDraft(input: DraftSaveInput): Promise<OperatorDraft | null> {
    const generation = crypto.randomUUID();
    const attachments = JSON.stringify(input.attachments);
    const bodyFormat = articleBodyFormat(input.bodyFormat);
    const statement = this.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,base_conversation_revision,expires_at,created_at,updated_at)
      SELECT ?,?,?,?,1,?,?,?,?,COALESCE((SELECT MAX(sequence) FROM conversation_events
        WHERE tenant_id=? AND ticket_id=?),0),?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND id=?)
        AND ((?=0 AND ? IS NULL) OR EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?))
      ON CONFLICT(tenant_id,user_id,ticket_id) DO UPDATE SET
        revision=operator_drafts.revision+1, mode=excluded.mode, body=excluded.body, body_format=excluded.body_format, attachments=excluded.attachments,
        expires_at=excluded.expires_at, updated_at=excluded.updated_at
      WHERE operator_drafts.revision=? AND operator_drafts.generation IS ?
        AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?)
      RETURNING ${draftColumns}`)
      .bind(
        this.scope.tenantId, this.scope.actorId, input.ticketId, generation, input.mode, input.body, bodyFormat, attachments,
        this.scope.tenantId, input.ticketId, input.expiresAt, this.scope.tenantId, input.ticketId,
        input.expectedRevision, input.expectedGeneration, this.scope.tenantId, this.scope.actorId, input.ticketId,
        input.expectedRevision, input.expectedGeneration,
        input.notExpiredAt ?? null, input.notExpiredAt ?? null,
      );
    const condition: MutationCondition = {
      sql: `EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND id=?) AND (
        (?=0 AND ? IS NULL AND NOT EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?))
        OR EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?
          AND revision=? AND generation IS ? AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?))
      )`,
      values: [
        this.scope.tenantId, input.ticketId,
        input.expectedRevision, input.expectedGeneration, this.scope.tenantId, this.scope.actorId, input.ticketId,
        this.scope.tenantId, this.scope.actorId, input.ticketId, input.expectedRevision, input.expectedGeneration,
        input.notExpiredAt ?? null, input.notExpiredAt ?? null,
      ],
    };
    const row = await this.runWorkspaceMutation<DraftRow>(statement, condition);
    return row ? draftFromRow(row) : null;
  }

  /** Rebase only an exact retained draft after the caller reviewed the current full event revision. */
  async rebaseDraft(input: DraftRebaseInput): Promise<OperatorDraft | null> {
    const statement = this.db.prepare(`UPDATE operator_drafts SET revision=revision+1,
      base_conversation_revision=?,expires_at=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=?
        AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?)
        AND ?=COALESCE((SELECT MAX(sequence) FROM conversation_events WHERE tenant_id=? AND ticket_id=?),0)
      RETURNING ${draftColumns}`).bind(
      input.expectedReviewedConversationRevision,input.expiresAt,this.scope.tenantId,this.scope.actorId,input.ticketId,
      input.expectedGeneration,input.expectedRevision,input.notExpiredAt ?? null,input.notExpiredAt ?? null,
      input.expectedReviewedConversationRevision,this.scope.tenantId,input.ticketId,
    );
    const condition: MutationCondition = {
      sql: `EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=?
        AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?))
        AND ?=COALESCE((SELECT MAX(sequence) FROM conversation_events WHERE tenant_id=? AND ticket_id=?),0)`,
      values: [this.scope.tenantId,this.scope.actorId,input.ticketId,input.expectedGeneration,input.expectedRevision,
        input.notExpiredAt ?? null,input.notExpiredAt ?? null,input.expectedReviewedConversationRevision,this.scope.tenantId,input.ticketId],
    };
    const row = await this.runWorkspaceMutation<DraftRow>(statement, condition);
    return row ? draftFromRow(row) : null;
  }

  /** Deletes only the draft instance and revision named by a confirmed canonical sender or explicit discard. */
  async deleteDraftIfVersion(ticketId: string, generation: string, revision: number): Promise<boolean> {
    const statement = this.db.prepare(`DELETE FROM operator_drafts
      WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=? RETURNING revision`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, generation, revision);
    const row = await this.runWorkspaceMutation<{ revision: number }>(statement, {
      sql: 'EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=?)',
      values: [this.scope.tenantId, this.scope.actorId, ticketId, generation, revision],
    });
    return row !== null;
  }

  /** Actor cleanup is bounded; cross-operator cleanup requires an explicit system scope. */
  async purgeExpiredForActor(now: string, limit = 100, legacyCutoff?: string): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid operator draft cleanup limit');
    const result = await this.db.prepare(`DELETE FROM operator_drafts WHERE rowid IN (
      SELECT rowid FROM operator_drafts WHERE tenant_id=? AND user_id=?
        AND ((expires_at IS NOT NULL AND expires_at <= ?) OR (expires_at IS NULL AND ? IS NOT NULL AND updated_at <= ?))
      ORDER BY expires_at LIMIT ?
    )`).bind(this.scope.tenantId, this.scope.actorId, now, legacyCutoff ?? null, legacyCutoff ?? null, limit).run();
    return result.meta.changes ?? 0;
  }

  async purgeExpiredForSystem(now: string, limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid operator draft cleanup limit');
    if (!this.scope.roles.includes('system')) throw new Error('System scope required for cross-operator draft cleanup');
    const result = await this.db.prepare(`DELETE FROM operator_drafts WHERE rowid IN (
      SELECT rowid FROM operator_drafts WHERE tenant_id=? AND expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at LIMIT ?
    )`).bind(this.scope.tenantId, now, limit).run();
    return result.meta.changes ?? 0;
  }

  async getWorkspaceState(): Promise<OperatorWorkspaceState | null> {
    const row = await this.db.prepare(`SELECT ${stateColumns} FROM operator_workspace_state WHERE tenant_id=? AND user_id=?`)
      .bind(this.scope.tenantId, this.scope.actorId).first<StateRow>();
    return row ? stateFromRow(row) : null;
  }

  async saveWorkspaceState(input: WorkspaceStateSaveInput): Promise<OperatorWorkspaceState | null> {
    const serializedFilters = JSON.stringify(input.filters);
    const statement = this.db.prepare(`INSERT INTO operator_workspace_state
      (tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,created_at,updated_at)
      SELECT ?,?,1,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE ?=0 OR EXISTS (SELECT 1 FROM operator_workspace_state WHERE tenant_id=? AND user_id=?)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET revision=operator_workspace_state.revision+1,
        view_key=excluded.view_key,sort_key=excluded.sort_key,filters=excluded.filters,
        list_query=excluded.list_query,list_anchor=excluded.list_anchor,selected_ticket_id=excluded.selected_ticket_id,panel=excluded.panel,updated_at=excluded.updated_at
      WHERE operator_workspace_state.revision=?
      RETURNING ${stateColumns}`)
      .bind(
        this.scope.tenantId, this.scope.actorId, input.view, input.sort, serializedFilters, input.listQuery, input.listAnchor,
        input.selectedTicketId, input.panel, input.expectedRevision, this.scope.tenantId, this.scope.actorId, input.expectedRevision,
      );
    const condition: MutationCondition = {
      sql: `(?=0 AND NOT EXISTS (SELECT 1 FROM operator_workspace_state WHERE tenant_id=? AND user_id=?))
        OR EXISTS (SELECT 1 FROM operator_workspace_state WHERE tenant_id=? AND user_id=? AND revision=?
        )`,
      values: [
        input.expectedRevision, this.scope.tenantId, this.scope.actorId,
        this.scope.tenantId, this.scope.actorId, input.expectedRevision,
      ],
    };
    const row = await this.runWorkspaceMutation<StateRow>(statement, condition);
    return row ? stateFromRow(row) : null;
  }

  /** Revision-qualified clearing returns the exact row that committed. */
  async clearSelectedTicketIfVersion(ticketId: string, revision: number): Promise<OperatorWorkspaceState | null> {
    const row = await this.db.prepare(`UPDATE operator_workspace_state
      SET selected_ticket_id=NULL,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND user_id=? AND selected_ticket_id=? AND revision=? RETURNING ${stateColumns}`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, revision).first<StateRow>();
    return row ? stateFromRow(row) : null;
  }
}
