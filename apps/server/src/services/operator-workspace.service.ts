import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { validateAttachmentReferences } from './attachment-references';
import type { OperatorDraft, OperatorWorkspaceState } from '../types/operator-workspace';
import type { DraftSaveInput, WorkspaceStateSaveInput } from '../repositories/operator-workspace.repository';
import { legacyDraftCutoff } from '../types/operator-draft-retention';

export class OperatorWorkspaceError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, message: string) { super(message); }
}

export type ExplicitDraftRetention = Readonly<{ expiresAt: (now: Date) => string }>;

/** Authorization and lifecycle boundary for per-operator drafts and presentation state. */
export class OperatorWorkspaceService {
  constructor(
    private readonly deps: TenantRequestDeps,
    private readonly options: Readonly<{ now?: () => Date; retention?: ExplicitDraftRetention }> = {},
  ) {}

  private now(): Date { return this.options.now?.() ?? new Date(); }

  private async authorizeTicket(ticketId: string) {
    const ticket = await this.deps.repositories.tickets.get(ticketId);
    if (!ticket) throw new OperatorWorkspaceError(404, 'Ticket not found');
    if (this.deps.scope.roles.includes('agent') && ticket.group_id &&
      !await this.deps.repositories.groups.isMember(ticket.group_id, this.deps.scope.actorId)) {
      throw new OperatorWorkspaceError(403, 'Forbidden');
    }
    return ticket;
  }

  async listDrafts(afterTicketId: string, limit: number) {
    const now = await this.expireLocalDrafts();
    return this.deps.repositories.operatorWorkspace.listDrafts(afterTicketId, limit, now);
  }

  async getDraft(ticketId: string): Promise<OperatorDraft | null> {
    await this.authorizeTicket(ticketId);
    const now = await this.expireLocalDrafts();
    return this.deps.repositories.operatorWorkspace.getDraft(ticketId, now);
  }

  async saveDraft(input: Omit<DraftSaveInput, 'attachments' | 'expiresAt' | 'notExpiredAt'> & { attachments: unknown }): Promise<OperatorDraft> {
    await this.authorizeTicket(input.ticketId);
    const attachments = await validateAttachmentReferences(this.deps, `agent-attachments/${this.deps.scope.actorId}/`, input.attachments);
    const now = this.now();
    const notExpiredAt = await this.expireLocalDrafts(now);
    const expiresAt = this.options.retention?.expiresAt(now) ?? null;
    const saved = await this.deps.repositories.operatorWorkspace.saveDraft({ ...input, attachments, expiresAt, notExpiredAt });
    if (!saved) throw new OperatorWorkspaceError(409, 'Draft changed before it could be saved');
    return saved;
  }

  async deleteDraftIfVersion(ticketId: string, generation: string, revision: number): Promise<void> {
    await this.authorizeTicket(ticketId);
    if (!await this.deps.repositories.operatorWorkspace.deleteDraftIfVersion(ticketId, generation, revision)) {
      throw new OperatorWorkspaceError(409, 'Draft changed before it could be removed');
    }
  }

  async getWorkspaceState(): Promise<OperatorWorkspaceState | null> {
    // One retry handles a concurrent normal state save without unbounded recursive work.
    for (let attempt = 0; attempt < 2; attempt++) {
      const state = await this.deps.repositories.operatorWorkspace.getWorkspaceState();
      if (!state?.selectedTicketId) return state;
      try { await this.authorizeTicket(state.selectedTicketId); return state; }
      catch (error) {
        if (!(error instanceof OperatorWorkspaceError) || (error.status !== 403 && error.status !== 404)) throw error;
        const cleared = await this.deps.repositories.operatorWorkspace.clearSelectedTicketIfVersion(state.selectedTicketId, state.revision);
        if (cleared) return cleared;
      }
    }
    throw new OperatorWorkspaceError(409, 'Workspace state changed during authorization');
  }

  async saveWorkspaceState(input: WorkspaceStateSaveInput): Promise<OperatorWorkspaceState> {
    if (input.selectedTicketId) await this.authorizeTicket(input.selectedTicketId);
    if (input.filters.filterId && !await this.deps.repositories.ticketFilters.get(input.filters.filterId)) {
      throw new OperatorWorkspaceError(400, 'Unknown workspace filter');
    }
    if (input.filters.groupId && !await this.deps.repositories.groups.get(input.filters.groupId)) {
      throw new OperatorWorkspaceError(400, 'Unknown workspace group');
    }
    if (input.filters.assignedTo && !await this.deps.repositories.users.get(input.filters.assignedTo)) {
      throw new OperatorWorkspaceError(400, 'Unknown workspace assignee');
    }
    const saved = await this.deps.repositories.operatorWorkspace.saveWorkspaceState(input);
    if (!saved) throw new OperatorWorkspaceError(409, 'Workspace state changed before it could be saved');
    return saved;
  }

  private async expireLocalDrafts(now = this.now()): Promise<string | undefined> {
    if (!this.options.retention) return undefined;
    const timestamp = now.toISOString();
    await this.deps.repositories.operatorWorkspace.purgeExpiredForActor(timestamp, 100, legacyDraftCutoff(now));
    return timestamp;
  }

  /** Only explicitly configured retention performs bounded, scoped cleanup. */
  async purgeExpired(): Promise<number> {
    if (!this.options.retention) throw new Error('Operator draft retention is not configured');
    const now = this.now();
    return this.deps.repositories.operatorWorkspace.purgeExpiredForActor(now.toISOString(), 100, legacyDraftCutoff(now));
  }
}
