import type { DurableObjectNamespace, D1Database } from '@cloudflare/workers-types';
import type { CurrentBudgetAuthorityGate } from './budget-coordinator.service';
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

/** Whole-state DO accounting uses the enforced 128 KiB serialized-state bound, in 1 KiB units. */
export const SESSION_GRANT_CLOSURE_RECOVERY_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  ...API_GRANT_CLOSURE_RECOVERY_ENVELOPE, doRowsRead: 768, doRowsWritten: 768,
});
type RecoveryCredential = Readonly<{ credentialKey: string; authorization: CurrentBudgetAuthorityGate }>;

/** Composes a current credential gate, durable closure, and one whole-grant reconciliation. */
export class BudgetGrantRecoveryService {
  constructor(private readonly db: D1Database, private readonly repository: BudgetAuthorityRepository, private readonly namespace: DurableObjectNamespace,
    private readonly scope: VerifiedTenantScope, private readonly credential: string | RecoveryCredential) {}

  async recover(sealed: SealedIsolateBudgetGrant, now: number): Promise<'reconciled' | 'pending' | 'rejected'> {
    const apiKeyId = typeof this.credential === 'string' ? this.credential : null;
    const credentialKey = typeof this.credential === 'string' ? `api-key:${this.credential}:tickets:write` : this.credential.credentialKey;
    if (sealed.tenantId !== this.scope.tenantId || (apiKeyId !== null && this.scope.actorId !== apiKeyId)
      || sealed.credentialKey !== credentialKey || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(sealed.expiresAt)
      || (sealed.retireExpired ? now < sealed.expiresAt : now >= sealed.expiresAt)) return 'rejected';
    const principal = typeof this.credential === 'string'
      ? await this.repository.authorizeApiKeyTicket(this.scope,this.scope.tenantId,this.credential)
      : await this.credential.authorization.authorize(this.scope);
    if (!principal) return 'rejected';
    const current = await this.repository.resolveForVerifiedPrincipal(this.scope,principal,now);
    if (current.kind !== 'active' || current.authority.aggregateId !== sealed.aggregateId) return 'rejected';
    const policy = current.authority.tenantAllocations.find(item => item.effectivePolicy.tenantId === sealed.tenantId)?.effectivePolicy;
    if (!sealed.snapshot || Object.entries(current.commitSnapshot).some(([key,value]) => sealed.snapshot[key as keyof BudgetCommitSnapshot] !== value)) return 'rejected';
    if (!policy || policy.restrictionRevision !== sealed.restrictionRevision || current.commitSnapshot.policy_id !== sealed.policyId || current.commitSnapshot.policy_revision !== sealed.policyRevision) return 'rejected';
    const coordinator = this.namespace.get(this.namespace.idFromName(sealed.aggregateId)) as unknown as BudgetCoordinatorDO;
    try {
      await coordinator.refreshFromTrustedAuthority(current.authority);
      // Recovery itself consumes only recovery-purpose capacity. Its slot is
      // compacted atomically with the closed work grant; its full charge remains.
      const reserved = await coordinator.reserveFromTrustedAuthority({ tenantId: sealed.tenantId, holderId: `recovery:${sealed.terminalEvidenceId}`,
        idempotencyKey: sealed.terminalEvidenceId, purpose: 'recovery', recoversReservationId: sealed.reservationId, envelope: typeof this.credential === 'string' ? API_GRANT_CLOSURE_RECOVERY_ENVELOPE : SESSION_GRANT_CLOSURE_RECOVERY_ENVELOPE,
        expectedPolicyId: sealed.policyId, expectedPolicyRevision: sealed.policyRevision, expectedRestrictionRevision: sealed.restrictionRevision, now });
      if (reserved.status === 'rejected' || !reserved.reservation) return 'pending';
      const closure = await new BudgetGrantClosureRepository(this.db).close(sealed);
      if (!closure) return 'pending';
      const outcome = await coordinator.reconcileFromTrustedAuthority({ tenantId: sealed.tenantId, reservationId: sealed.reservationId, holderId: sealed.holderId,
        expectedPolicyId: sealed.policyId, expectedPolicyRevision: sealed.policyRevision, expectedRestrictionRevision: sealed.restrictionRevision,
        terminalEvidenceId: closure.terminalEvidenceId, measured: {}, uncertain: closure.uncertain, now,
        certifiedClosure: { operationSetFingerprint: closure.operationSetFingerprint, expiresAt: sealed.expiresAt,
          ...(sealed.retireExpired ? { retireExpired: true } : {}),
          recoveryReservationId: reserved.reservation.reservationId, recoveryHolderId: reserved.reservation.holderId } });
      if (outcome !== 'reconciled' && outcome !== 'already-reconciled') return 'rejected';
      // This uses the recovery reservation already accepted above. It never
      // deletes a live/uncertain grant and its finite batch is safe to retry.
      try {
        const closures = new BudgetGrantClosureRepository(this.db);
        await closures.markReconciled(sealed,closure,now);
        await closures.pruneExpired(sealed.tenantId,now);
      } catch { /* Unconfirmed acknowledgment retains durable evidence for later cleanup. */ }
      return 'reconciled';
    } catch { return 'pending'; }
  }
}
