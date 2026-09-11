import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { articleBodyFormat, type ArticleBodyFormat } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import { BetaAdmissionError } from '../types/local-beta';
import { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import { budgetCommitConstraint } from './budget-commit-fence';
import { DRAFT_EXPIRY_SQL } from '../types/operator-draft-retention';
import type {
  OperatorDraft, OperatorDraftAttachment, OperatorDraftMode, OperatorWorkspaceFilters,
  OperatorWorkspaceSort, OperatorWorkspaceState, OperatorWorkspaceView,
  OperatorThemeMode, OperatorThemePreference,
} from '../types/operator-workspace';

type DraftRow = {
  ticket_id: string; generation: string; revision: number; mode: OperatorDraftMode; body: string; body_format?: ArticleBodyFormat; attachments: string; mentioned_user_ids: string;
  base_conversation_revision: number; expires_at: string | null; updated_at: string;
};
type StateRow = {
  revision: number; view_key: OperatorWorkspaceView; sort_key: OperatorWorkspaceSort; filters: string;
  list_query: string; list_anchor: string; selected_ticket_id: string | null; panel: 'conversation' | 'details'; updated_at: string;
};

const draftColumns = 'ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at,updated_at';
const stateColumns = 'revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel,updated_at';

function draftFromRow(row: DraftRow): OperatorDraft {
  return {
    ticketId: row.ticket_id, generation: row.generation, revision: row.revision, mode: row.mode, body: row.body,
    bodyFormat: articleBodyFormat(row.body_format),
    attachments: JSON.parse(row.attachments) as OperatorDraftAttachment[], mentionedUserIds: JSON.parse(row.mentioned_user_ids) as string[], baseConversationRevision: row.base_conversation_revision,
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
  attachments: readonly OperatorDraftAttachment[]; mentionedUserIds?: readonly string[]; expiresAt: string | null;
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
export type WorkspaceAdmissionOperation = 'workspace.state.read'|'workspace.state.write'|'workspace.theme.read'|'workspace.theme.write'|'workspace.drafts.list'|'workspace.draft.read'|'workspace.draft.write'|'workspace.draft.rebase'|'workspace.draft.delete';
export type OperatorWorkspaceCommit = Readonly<{ operation: WorkspaceAdmissionOperation; ticketId?: string;
  credential: SessionBudgetCredential; authority: BudgetCommitAuthority }>;

/** A current session or exact budget fence changed between admission and D1 work. */
export class OperatorWorkspaceFenceError extends Error {}

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

  private workspaceAuthority(commit: OperatorWorkspaceCommit, operation: WorkspaceAdmissionOperation, ticketId?: string): MutationCondition {
    const c = commit.credential;
    const valid = commit.operation === operation && commit.ticketId === ticketId && c.tenantId === this.scope.tenantId
      && c.actorId === this.scope.actorId && this.scope.roles.includes(c.role) && c.sessionVersion === this.scope.authVersion
      && c.mfaVerified === true && Number.isSafeInteger(c.expiresAt) && Number.isSafeInteger(c.sessionVersion)
      && commit.authority.operationId.length > 0 && commit.authority.operationFingerprint.length > 0;
    const budget = budgetCommitConstraint(commit.authority, this.scope.tenantId);
    const sql = [`?=1`, `EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=? AND mfa_enabled=1 AND ?>unixepoch())`, budget.sql];
    const values: unknown[] = [valid ? 1 : 0, this.scope.tenantId, c.actorId, c.role, c.sessionVersion, c.expiresAt, ...budget.values];
    if (ticketId !== undefined) {
      sql.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=?
        AND (?='admin' OR t.group_id IS NULL OR EXISTS (SELECT 1 FROM user_groups
          WHERE tenant_id=t.tenant_id AND user_id=? AND group_id=t.group_id)))`);
      values.push(this.scope.tenantId, ticketId, c.role, c.actorId);
    }
    return { sql: sql.join(' AND '), values };
  }

  private async readWorkspace<T>(statement: D1PreparedStatement, commit: OperatorWorkspaceCommit | undefined,
    operation: WorkspaceAdmissionOperation, ticketId?: string): Promise<T[]> {
    if (!commit) return (await statement.all<T>()).results ?? [];
    const authority = this.workspaceAuthority(commit, operation, ticketId);
    const results = await this.db.batch([
      this.db.prepare(`SELECT 1 AS authorized WHERE ${authority.sql}`).bind(...authority.values),
      statement,
    ]);
    if (!results[0]?.results?.[0]) throw new OperatorWorkspaceFenceError('Operator workspace authority changed');
    return (results[1]?.results ?? []) as T[];
  }

  /** An absent preference has an authoritative revision-zero default; a revoked actor has no row. */
  async getThemePreference(credential: OperatorPresentationCredential, commit?: OperatorWorkspaceCommit): Promise<OperatorThemePreference | null> {
    const authority = this.themeAuthority(credential);
    const rows = await this.readWorkspace<{revision: number; mode: OperatorThemeMode; updated_at: string | null}>(this.db.prepare(`SELECT COALESCE(p.revision,0) AS revision,COALESCE(p.mode,'system') AS mode,p.updated_at
      FROM users u LEFT JOIN operator_theme_preference p ON p.tenant_id=u.tenant_id AND p.user_id=u.id
      WHERE u.tenant_id=? AND u.id=? AND ${authority.sql}`)
      .bind(this.scope.tenantId, this.scope.actorId, ...authority.values), commit, 'workspace.theme.read');
    const row = rows[0];
    return row ? { revision: row.revision, mode: row.mode, updatedAt: row.updated_at } : null;
  }

  async saveThemePreference(input: { expectedRevision: number; mode: OperatorThemeMode }, credential: OperatorPresentationCredential,
    commit?: OperatorWorkspaceCommit): Promise<OperatorThemePreference | null> {
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
    const row = await this.runWorkspaceMutation<{ revision: number; mode: OperatorThemeMode; updated_at: string }>(statement, condition, commit, 'workspace.theme.write');
    return row ? { revision: row.revision, mode: row.mode, updatedAt: row.updated_at } : null;
  }

  /** A local-beta assertion and counter share the same D1 batch as the CAS mutation. */
  private async runWorkspaceMutation<T>(statement: D1PreparedStatement, condition: MutationCondition,
    commit?: OperatorWorkspaceCommit, operation?: WorkspaceAdmissionOperation, ticketId?: string): Promise<T | null> {
    if (!this.betaAdmission && !commit) return statement.first<T>();
    try {
      const workspace = commit && operation ? this.workspaceAuthority(commit, operation, ticketId) : undefined;
      const workspaceStatements = workspace ? [this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
        VALUES (?,CASE WHEN ${workspace.sql} THEN 1 ELSE 0 END)
        ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId, ...workspace.values)] : [];
      const betaStatements = this.betaAdmission?.conditionalConversationStatements(condition) ?? [];
      const results = await this.db.batch([...workspaceStatements, ...betaStatements, statement]);
      return (results[results.length - 1]?.results?.[0] as T | undefined) ?? null;
    } catch {
      // Keep the externally visible local-beta failure classification, never turn an admission fault into a successful save.
      if (this.betaAdmission) {
        await this.betaAdmission.authorize('conversation');
        throw new BetaAdmissionError('beta_admission_unavailable', 503);
      }
      if (commit) throw new OperatorWorkspaceFenceError('Operator workspace authority changed');
      throw new Error('Operator workspace mutation unavailable');
    }
  }

  async getDraft(ticketId: string, notExpiredAt?: string, commit?: OperatorWorkspaceCommit): Promise<OperatorDraft | null> {
    const rows = await this.readWorkspace<DraftRow>(this.db.prepare(`SELECT ${draftColumns} FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?
      AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?)`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, notExpiredAt ?? null, notExpiredAt ?? null), commit, 'workspace.draft.read', ticketId);
    const row = rows[0];
    return row ? draftFromRow(row) : null;
  }

  /** Bounded, body-free input for Drafts views; current group membership is checked in the read. */
  async listDrafts(afterTicketId = '', limit = 50, notExpiredAt?: string, commit?: OperatorWorkspaceCommit): Promise<{ items: { ticketId: string; updatedAt: string }[]; next: string | null }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || afterTicketId.length > 128) throw new Error('Invalid draft page');
    const rows = await this.readWorkspace<{ ticket_id: string; updated_at: string }>(this.db.prepare(`SELECT d.ticket_id,d.updated_at FROM operator_drafts d
      JOIN tickets t ON t.tenant_id=d.tenant_id AND t.id=d.ticket_id
      WHERE d.tenant_id=? AND d.user_id=? AND d.ticket_id>?
        AND (? IS NULL OR ${DRAFT_EXPIRY_SQL.replaceAll('expires_at', 'd.expires_at').replaceAll('updated_at', 'd.updated_at')}>?)
        AND (?=0 OR t.group_id IS NULL OR EXISTS (
          SELECT 1 FROM user_groups ug WHERE ug.tenant_id=t.tenant_id AND ug.group_id=t.group_id AND ug.user_id=?
        )) ORDER BY d.ticket_id LIMIT ?`)
      .bind(this.scope.tenantId, this.scope.actorId, afterTicketId, notExpiredAt ?? null, notExpiredAt ?? null, this.scope.roles.includes('agent') ? 1 : 0, this.scope.actorId, limit + 1),
      commit, 'workspace.drafts.list');
    const items = rows.slice(0, limit).map(row => ({ ticketId: row.ticket_id, updatedAt: row.updated_at }));
    return { items, next: rows.length > limit ? items[items.length - 1].ticketId : null };
  }

  /** A returned row is the only completed save signal. Generation prevents delete/recreate ABA. */
  async saveDraft(input: DraftSaveInput, commit?: OperatorWorkspaceCommit): Promise<OperatorDraft | null> {
    const generation = crypto.randomUUID();
    const attachments = JSON.stringify(input.attachments);
    const mentionedUserIds = JSON.stringify(input.mentionedUserIds ?? []);
    const bodyFormat = articleBodyFormat(input.bodyFormat);
    const statement = this.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at,created_at,updated_at)
      SELECT ?,?,?,?,1,?,?,?,?,?,COALESCE((SELECT MAX(sequence) FROM conversation_events
        WHERE tenant_id=? AND ticket_id=?),0),?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE EXISTS (SELECT 1 FROM tickets WHERE tenant_id=? AND id=?)
        AND ((?=0 AND ? IS NULL) OR EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=?))
      ON CONFLICT(tenant_id,user_id,ticket_id) DO UPDATE SET
        revision=operator_drafts.revision+1, mode=excluded.mode, body=excluded.body, body_format=excluded.body_format, attachments=excluded.attachments, mentioned_user_ids=excluded.mentioned_user_ids,
        expires_at=excluded.expires_at, updated_at=excluded.updated_at
      WHERE operator_drafts.revision=? AND operator_drafts.generation IS ?
        AND (? IS NULL OR ${DRAFT_EXPIRY_SQL}>?)
      RETURNING ${draftColumns}`)
      .bind(
        this.scope.tenantId, this.scope.actorId, input.ticketId, generation, input.mode, input.body, bodyFormat, attachments, mentionedUserIds,
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
    const row = await this.runWorkspaceMutation<DraftRow>(statement, condition, commit, 'workspace.draft.write', input.ticketId);
    return row ? draftFromRow(row) : null;
  }

  /** Rebase only an exact retained draft after the caller reviewed the current full event revision. */
  async rebaseDraft(input: DraftRebaseInput, commit?: OperatorWorkspaceCommit): Promise<OperatorDraft | null> {
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
    const row = await this.runWorkspaceMutation<DraftRow>(statement, condition, commit, 'workspace.draft.rebase', input.ticketId);
    return row ? draftFromRow(row) : null;
  }

  /** Deletes only the draft instance and revision named by a confirmed canonical sender or explicit discard. */
  async deleteDraftIfVersion(ticketId: string, generation: string, revision: number, commit?: OperatorWorkspaceCommit): Promise<boolean> {
    const statement = this.db.prepare(`DELETE FROM operator_drafts
      WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=? RETURNING revision`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, generation, revision);
    const row = await this.runWorkspaceMutation<{ revision: number }>(statement, {
      sql: 'EXISTS (SELECT 1 FROM operator_drafts WHERE tenant_id=? AND user_id=? AND ticket_id=? AND generation=? AND revision=?)',
      values: [this.scope.tenantId, this.scope.actorId, ticketId, generation, revision],
    }, commit, 'workspace.draft.delete', ticketId);
    return row !== null;
  }

  /** Actor cleanup is bounded; cross-operator cleanup requires an explicit system scope. */
  async purgeExpiredForActor(now: string, limit = 100, legacyCutoff?: string, commit?: OperatorWorkspaceCommit): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid operator draft cleanup limit');
    const statement = this.db.prepare(`DELETE FROM operator_drafts WHERE rowid IN (
      SELECT rowid FROM operator_drafts WHERE tenant_id=? AND user_id=?
        AND ((expires_at IS NOT NULL AND expires_at <= ?) OR (expires_at IS NULL AND ? IS NOT NULL AND updated_at <= ?))
      ORDER BY expires_at LIMIT ?
    )`).bind(this.scope.tenantId, this.scope.actorId, now, legacyCutoff ?? null, legacyCutoff ?? null, limit);
    if (!commit) return (await statement.run()).meta.changes ?? 0;
    const authority = this.workspaceAuthority(commit, commit.operation, commit.ticketId);
    try {
      const results = await this.db.batch([
        this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted) VALUES (?,CASE WHEN ${authority.sql} THEN 1 ELSE 0 END)
          ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId, ...authority.values),
        statement,
      ]);
      return results[1]?.meta?.changes ?? 0;
    } catch { throw new OperatorWorkspaceFenceError('Operator workspace authority changed'); }
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

  async getWorkspaceState(commit?: OperatorWorkspaceCommit): Promise<OperatorWorkspaceState | null> {
    const rows = await this.readWorkspace<StateRow>(this.db.prepare(`SELECT ${stateColumns} FROM operator_workspace_state WHERE tenant_id=? AND user_id=?`)
      .bind(this.scope.tenantId, this.scope.actorId), commit, 'workspace.state.read');
    const row = rows[0];
    return row ? stateFromRow(row) : null;
  }

  async saveWorkspaceState(input: WorkspaceStateSaveInput, commit?: OperatorWorkspaceCommit): Promise<OperatorWorkspaceState | null> {
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
    const row = await this.runWorkspaceMutation<StateRow>(statement, condition, commit, 'workspace.state.write', input.selectedTicketId ?? undefined);
    return row ? stateFromRow(row) : null;
  }

  /** Revision-qualified clearing returns the exact row that committed. */
  async clearSelectedTicketIfVersion(ticketId: string, revision: number, commit?: OperatorWorkspaceCommit): Promise<OperatorWorkspaceState | null> {
    const statement = this.db.prepare(`UPDATE operator_workspace_state
      SET selected_ticket_id=NULL,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND user_id=? AND selected_ticket_id=? AND revision=? RETURNING ${stateColumns}`)
      .bind(this.scope.tenantId, this.scope.actorId, ticketId, revision);
    const row = await this.runWorkspaceMutation<StateRow>(statement, {
      sql: 'EXISTS (SELECT 1 FROM operator_workspace_state WHERE tenant_id=? AND user_id=? AND selected_ticket_id=? AND revision=?)',
      values: [this.scope.tenantId, this.scope.actorId, ticketId, revision],
    }, commit, 'workspace.state.read');
    return row ? stateFromRow(row) : null;
  }
}
