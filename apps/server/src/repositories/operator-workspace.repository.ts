import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type {
  OperatorDraft, OperatorDraftAttachment, OperatorDraftMode, OperatorWorkspaceFilters,
  OperatorWorkspaceSort, OperatorWorkspaceState, OperatorWorkspaceView,
} from '../types/operator-workspace';

type DraftRow = {
  ticket_id: string; generation: string; revision: number; mode: OperatorDraftMode; body: string; attachments: string;
  base_conversation_revision: number; expires_at: string | null; updated_at: string;
};
type StateRow = {
  revision: number; view_key: OperatorWorkspaceView; sort_key: OperatorWorkspaceSort; filters: string;
  list_query: string; list_anchor: string; selected_ticket_id: string | null; panel: 'conversation' | 'details'; updated_at: string;
};

const draftColumns = 'ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,expires_at,updated_at';
const stateColumns = 'revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,updated_at';

function draftFromRow(row: DraftRow): OperatorDraft {
  return {
    ticketId: row.ticket_id, generation: row.generation, revision: row.revision, mode: row.mode, body: row.body,
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
  attachments: readonly OperatorDraftAttachment[]; expiresAt: string | null;
}>;
export type WorkspaceStateSaveInput = Readonly<{
  expectedRevision: number; view: OperatorWorkspaceView; sort: OperatorWorkspaceSort;
  filters: OperatorWorkspaceFilters; listQuery: string; listAnchor: string; selectedTicketId: string | null; panel: 'conversation' | 'details';
}>;

/** D1 persistence only; caller supplies trusted actor and ticket authorization. */
export class OperatorWorkspaceRepository {
  constructor(private readonly scope: VerifiedTenantScope, private readonly db: D1Database) {}

  async getDraft(ticketId: string): Promise<OperatorDraft | null> {
    const row = await this.db.prepare(`SELECT ${draftColumns} FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId).first<DraftRow>();
    return row ? draftFromRow(row) : null;
  }

  /** A returned row is the only completed save signal. Generation prevents delete/recreate ABA. */
  async saveDraft(input: DraftSaveInput): Promise<OperatorDraft | null> {
    const generation = crypto.randomUUID();
    const row = await this.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,expires_at,created_at,updated_at)
      SELECT ?,?,?,?,1,?,?,?,COALESCE((SELECT MAX(sequence) FROM conversation_events
        WHERE tenant_id=? AND ticket_id=?),0),?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND id=?)
        AND ((?=0 AND ? IS NULL) OR EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?))
      ON CONFLICT(tenant_id,user_id,ticket_id) DO UPDATE SET
        revision=operator_drafts.revision+1, mode=excluded.mode, body=excluded.body, attachments=excluded.attachments,
        expires_at=excluded.expires_at, updated_at=excluded.updated_at
      WHERE operator_drafts.revision=? AND operator_drafts.generation IS ?
      RETURNING ${draftColumns}`)
      .bind(
        this.scope.tenantId, this.scope.actorId, input.ticketId, generation, input.mode, input.body, JSON.stringify(input.attachments),
        this.scope.tenantId, input.ticketId, input.expiresAt, this.scope.tenantId, input.ticketId,
        input.expectedRevision, input.expectedGeneration, this.scope.tenantId, this.scope.actorId, input.ticketId,
        input.expectedRevision, input.expectedGeneration,
      ).first<DraftRow>();
    return row ? draftFromRow(row) : null;
  }

  /** Deletes only the draft instance and revision named by a confirmed canonical sender or explicit discard. */
  async deleteDraftIfVersion(ticketId: string, generation: string, revision: number): Promise<boolean> {
    const row = await this.db.prepare(`DELETE FROM operator_drafts
      WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=? RETURNING revision`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, generation, revision).first<{ revision: number }>();
    return row !== null;
  }

  /** Actor cleanup is bounded; cross-operator cleanup requires an explicit system scope. */
  async purgeExpiredForActor(now: string, limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid operator draft cleanup limit');
    const result = await this.db.prepare(`DELETE FROM operator_drafts WHERE rowid IN (
      SELECT rowid FROM operator_drafts WHERE tenant_id=? AND user_id=? AND expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at LIMIT ?
    )`).bind(this.scope.tenantId, this.scope.actorId, now, limit).run();
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
    const row = await this.db.prepare(`INSERT INTO operator_workspace_state
      (tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,created_at,updated_at)
      SELECT ?,?,1,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE ?=0 OR EXISTS (SELECT 1 FROM operator_workspace_state WHERE tenant_id=? AND user_id=?)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET revision=operator_workspace_state.revision+1,
        view_key=excluded.view_key,sort_key=excluded.sort_key,filters=excluded.filters,
        list_query=excluded.list_query,list_anchor=excluded.list_anchor,selected_ticket_id=excluded.selected_ticket_id,panel=excluded.panel,updated_at=excluded.updated_at
      WHERE operator_workspace_state.revision=?
      RETURNING ${stateColumns}`)
      .bind(
        this.scope.tenantId, this.scope.actorId, input.view, input.sort, JSON.stringify(input.filters), input.listQuery, input.listAnchor,
        input.selectedTicketId, input.panel, input.expectedRevision, this.scope.tenantId, this.scope.actorId, input.expectedRevision,
      ).first<StateRow>();
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
