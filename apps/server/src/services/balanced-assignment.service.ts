import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import { BalancedAssignmentRepository } from '../repositories/balanced-assignment.repository';
import { balancedAssignmentFingerprint, BalancedAssignmentError, type BalancedAssignmentCommit, type BalancedAssignmentOutcome } from '../types/balanced-assignment';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
/** Two bounded ranking probes, credential/group guards, receipt cleanup and canonical audit/activity writes.
 * Bounds are supported by the scoped native evidence; provider release clearance is separate. */
export const BALANCED_ASSIGNMENT_ENVELOPE = Object.freeze({
  workerRequests: 1, d1RowsRead: 150000, d1RowsWritten: 2048, d1StorageBytes: 65536,
  ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 1 })
});
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export class BalancedAssignmentService {
  private attempt?: {
    authority: BudgetCommitAuthority;
    result?: BalancedAssignmentOutcome;
    finished: boolean;
  };
  /** Route completion only: acknowledged journal proof plus the exact returned outcome is required. */
  finish(result?: BalancedAssignmentOutcome): void {
    const attempt = this.attempt;
    if (!attempt || attempt.finished)
      return;
    attempt.finished = true;
    this.budget.settle(attempt.authority, result !== undefined && result === attempt.result ? 'committed' : 'unknown', this.budget.now());
  }
  private acknowledge(result: BalancedAssignmentOutcome): BalancedAssignmentOutcome {
    if (!this.attempt)
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    const outcome = Object.freeze({ ...result });
    this.attempt.result = outcome;
    return outcome;
  }
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope, private readonly credential: SessionBudgetCredential, private readonly repository: BalancedAssignmentRepository, private readonly budget: {
    service: SessionBudgetAdmissionService;
    repository: BudgetAuthorityRepository;
    namespace: DurableObjectNamespace;
    now: () => number;
    settle: (authority: BudgetCommitAuthority, state: 'committed' | 'unknown', now: number) => void;
  }, private readonly capability?: CapabilityWriteFence) { }
  async execute(ticketId: string, key: string): Promise<BalancedAssignmentOutcome> {
    if (this.attempt)
      throw new BalancedAssignmentError(400, 'routing_attempt_already_started');
    if (!id.test(ticketId) || !id.test(this.scope.actorId) || this.scope.tenantId.length > 256 || !key || !/^[A-Za-z0-9._~-]{1,128}$/.test(key))
      throw new BalancedAssignmentError(400, 'invalid_routing_request');
    const credential = structuredClone(this.credential), requirements = { readTicketId: ticketId, ...(this.capability ? { capability: structuredClone(this.capability) } : {}) };
    const sessions = new SessionBudgetAuthorityRepository(this.db, this.scope);
    if (!await sessions.authorize(credential, requirements, this.budget.now()))
      throw new BalancedAssignmentError(403, 'routing_denied');
    const keyHash = await hash(['balanced-key-v1', this.scope.tenantId, this.scope.actorId, key]);
    const payloadHash = await balancedAssignmentFingerprint(this.scope.tenantId, this.scope.actorId, ticketId, keyHash);
    const operationId = crypto.randomUUID();
    const admission = await this.budget.service.admit({
      database: this.db, repository: this.budget.repository, sessions, namespace: this.budget.namespace, scope: this.scope,
      credential, requirements, intent: { operationId, operationFingerprint: payloadHash, workScopeKey: 'dashboard.ticket.balance' }, business: BALANCED_ASSIGNMENT_ENVELOPE, now: this.budget.now
    });
    if ((admission.status !== 'spent' && admission.status !== 'idempotent') || !admission.commitAuthority)
      throw new BalancedAssignmentError(503, 'routing_admission_unavailable');
    this.attempt = { authority: admission.commitAuthority, finished: false };
    const commit: BalancedAssignmentCommit = { ticketId, keyHash, payloadHash, operationId, credential, requirements, authority: admission.commitAuthority };
    try {
      const replay = await this.repository.replay(commit);
      if (replay) {
        await this.repository.completeReplay(commit);
        return this.acknowledge(replay);
      }
      const decision = await this.repository.decide(commit);
      let result: BalancedAssignmentOutcome;
      try {
        result = await this.repository.commit(commit, decision, new Date(this.budget.now()).toISOString());
      }
      catch (error) {
        // A same-key concurrent winner is replayed; ranking/owner races never silently overwrite or auto-loop.
        const winner = await this.repository.replay(commit);
        if (!winner)
          throw error;
        await this.repository.completeReplay(commit);
        result = winner;
      }
      return this.acknowledge(result);
    }
    catch (error) {
      if (error instanceof BalancedAssignmentError)
        throw error;
      throw new BalancedAssignmentError(503, 'routing_unavailable');
    }
  }
}
