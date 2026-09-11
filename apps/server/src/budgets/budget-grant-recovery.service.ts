import type { DurableObjectNamespace, D1Database } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import { BudgetAuthorityRepository, type BudgetCommitSnapshot } from '../repositories/budget-authority.repository';
import { BudgetGrantClosureRepository } from '../repositories/budget-grant-closure.repository';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import type { SealedIsolateBudgetGrant } from './isolate-admission.service';

/** Conservative recovery-only allowance; it is reserved from the 20% purpose partition and never reclaimed here. */
export const API_GRANT_CLOSURE_RECOVERY_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 2, d1RowsRead: 4_096, d1RowsWritten: 64, doRequests: 6, doRowsRead: 12, doRowsWritten: 12, logEvents: 6,
});

/** Composes current API authority, durable closure, and one whole-grant reconciliation. */
export class BudgetGrantRecoveryService {
  constructor(private readonly db: D1Database, private readonly repository: BudgetAuthorityRepository, private readonly namespace: DurableObjectNamespace,
    private readonly scope: VerifiedTenantScope, private readonly apiKeyId: string) {}

  async recover(sealed: SealedIsolateBudgetGrant, now: number): Promise<'reconciled' | 'pending' | 'rejected'> {
    if (sealed.tenantId !== this.scope.tenantId || this.scope.actorId !== this.apiKeyId
      || sealed.credentialKey !== `api-key:${this.apiKeyId}:tickets:write`
      || !Number.isSafeInteger(now) || !Number.isSafeInteger(sealed.expiresAt) || now >= sealed.expiresAt) return 'rejected';
    const principal = await this.repository.authorizeApiKeyTicket(this.scope,this.scope.tenantId,this.apiKeyId);
    if (!principal) return 'rejected';
    const current = await this.repository.resolveForVerifiedPrincipal(this.scope,principal,now);
    if (current.kind !== 'active' || current.authority.aggregateId !== sealed.aggregateId) return 'rejected';
    const policy = current.authority.tenantAllocations.find(item => item.effectivePolicy.tenantId === sealed.tenantId)?.effectivePolicy;
    if (!sealed.snapshot || Object.entries(current.commitSnapshot).some(([key,value]) => sealed.snapshot[key as keyof BudgetCommitSnapshot] !== value)) return 'rejected';
    if (!policy || policy.restrictionRevision !== sealed.restrictionRevision || current.commitSnapshot.policy_id !== sealed.policyId || current.commitSnapshot.policy_revision !== sealed.policyRevision) return 'rejected';
    const coordinator = this.namespace.get(this.namespace.idFromName(sealed.aggregateId)) as unknown as BudgetCoordinatorDO;
    try {
      await coordinator.refreshFromTrustedAuthority(current.authority);
      // Recovery itself consumes only recovery-purpose capacity. Its outcome is
      // intentionally not reconciled by this path, so its conservative charge remains.
      const reserved = await coordinator.reserveFromTrustedAuthority({ tenantId: sealed.tenantId, holderId: `recovery:${sealed.terminalEvidenceId}`,
        idempotencyKey: sealed.terminalEvidenceId, purpose: 'recovery', envelope: API_GRANT_CLOSURE_RECOVERY_ENVELOPE,
        expectedPolicyId: sealed.policyId, expectedPolicyRevision: sealed.policyRevision, expectedRestrictionRevision: sealed.restrictionRevision, now });
      if (reserved.status === 'rejected') return 'pending';
      const closure = await new BudgetGrantClosureRepository(this.db).close(sealed);
      if (!closure) return 'pending';
      const outcome = await coordinator.reconcileFromTrustedAuthority({ tenantId: sealed.tenantId, reservationId: sealed.reservationId, holderId: sealed.holderId,
        expectedPolicyId: sealed.policyId, expectedPolicyRevision: sealed.policyRevision, expectedRestrictionRevision: sealed.restrictionRevision,
        terminalEvidenceId: closure.terminalEvidenceId, measured: {}, uncertain: closure.uncertain, now,
        certifiedClosure: { operationSetFingerprint: closure.operationSetFingerprint, expiresAt: sealed.expiresAt } });
      if (outcome !== 'reconciled' && outcome !== 'already-reconciled') return 'rejected';
      // This uses the recovery reservation already accepted above. It never
      // deletes a live/uncertain grant and its finite batch is safe to retry.
      try { await new BudgetGrantClosureRepository(this.db).pruneExpired(sealed.tenantId,now); } catch { /* Later recovery retries cleanup. */ }
      return 'reconciled';
    } catch { return 'pending'; }
  }
}
