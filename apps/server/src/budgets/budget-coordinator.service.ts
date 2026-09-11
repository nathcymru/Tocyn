import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetPurpose, ResourceAmounts } from '@luminatick/shared';
import { sumResourceEnvelopes } from '../utils/cost-policy';
import { BudgetAuthorityRepository, type BudgetAuthorityPrincipal } from '../repositories/budget-authority.repository';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import type { BudgetGrantHolderDO } from '../durable_objects/BudgetGrantHolderDO';

export type ServerBudgetReservationRequest = Readonly<{
  holderId: string;
  idempotencyKey: string;
  purpose: BudgetPurpose;
  envelope: ResourceAmounts;
}>;
export type ServerBudgetReservationResult = Awaited<ReturnType<BudgetCoordinatorDO['reserveFromTrustedAuthority']>>
  | Readonly<{ status: 'rejected'; reason: 'unavailable' | 'stale-policy' }>;

/**
 * A route-specific credential gate must return the current verified principal.
 * `VerifiedTenantScope` carries no expiry or API-key capability proof by itself.
 */
export interface CurrentBudgetAuthorityGate {
  authorize(scope: VerifiedTenantScope): Promise<BudgetAuthorityPrincipal | null>;
}

export type ServerWarmBudgetSpendRequest = Readonly<{
  holderId: string;
  reservationId: string;
  operationId: string;
  envelope: ResourceAmounts;
}>;

/**
 * Every warm operation still has one bounded current-authority read and three
 * Durable Object RPCs: coordinator refresh, holder refresh, then the durable
 * holder decrement. Route-specific callers must include their own canonical
 * work envelope; this fixed envelope charges the control plane before that
 * work can start. Custom authority gates must remain bounded current lookups
 * and add their own cost if they exceed this one-credential-read allowance.
 */
export const WARM_SPEND_CONTROL_PLANE_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  d1RowsRead: 1_536,
  doRequests: 3,
  doRowsWritten: 3,
});

/** One operation acknowledgement and one lost-acknowledgement recovery only. */
export const MAX_WARM_SPEND_ATTEMPTS = 2;

/**
 * Optional server-only durable-holder adapter retained for foundation/runtime
 * validation. The active API routes use IsolateBudgetAdmissionCache instead:
 * this adapter's per-operation DO RPCs are not the #64 warm-path acceptance.
 * Its caller must select a credential-specific current-authority gate; a scope
 * or matching policy revision alone is never enough to admit new work.
 */
export class BudgetCoordinatorService {
  constructor(
    private readonly repository: BudgetAuthorityRepository,
    private readonly namespace: DurableObjectNamespace,
    private readonly holderNamespace: DurableObjectNamespace,
    private readonly authorization: CurrentBudgetAuthorityGate,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private holder(scope: VerifiedTenantScope, holderId: string, reservationId: string): BudgetGrantHolderDO {
    const name = JSON.stringify(['budget-grant-holder-v2', scope.tenantId, holderId, reservationId]);
    return this.holderNamespace.get(this.holderNamespace.idFromName(name)) as unknown as BudgetGrantHolderDO;
  }

  async reserveForVerifiedScope(scope: VerifiedTenantScope, request: ServerBudgetReservationRequest): Promise<ServerBudgetReservationResult> {
    const principal = await this.authorization.authorize(scope);
    if (!principal) return { status: 'rejected', reason: 'unavailable' };
    const checkedAt = this.now();
    const resolution = await this.repository.resolveForVerifiedPrincipal(scope, principal, checkedAt);
    if (resolution.kind === 'unavailable') return { status: 'rejected', reason: 'unavailable' };
    const coordinator = this.namespace.get(this.namespace.idFromName(
      resolution.kind === 'active' ? resolution.authority.aggregateId : resolution.revocation.aggregateId,
    )) as unknown as BudgetCoordinatorDO;
    if (resolution.kind === 'revoked') {
      await coordinator.revokeFromTrustedAuthority(resolution.revocation);
      return { status: 'rejected', reason: 'stale-policy' };
    }
    await coordinator.refreshFromTrustedAuthority(resolution.authority);
    const policy = resolution.authority.tenantAllocations.find(allocation => allocation.effectivePolicy.tenantId === scope.tenantId)?.effectivePolicy;
    if (!policy) return { status: 'rejected', reason: 'unavailable' };
    const outcome = await coordinator.reserveFromTrustedAuthority({
      ...request,
      tenantId: scope.tenantId,
      expectedPolicyId: policy.policyId,
      expectedPolicyRevision: policy.revision,
      expectedRestrictionRevision: policy.restrictionRevision,
      now: checkedAt,
    });
    if ((outcome.status === 'granted' || outcome.status === 'idempotent') && outcome.reservation) {
      if (outcome.reservation.status !== 'reserved' || outcome.reservation.expiresAt <= checkedAt) return { status: 'rejected', reason: 'stale-policy' };
      await this.holder(scope, request.holderId, outcome.reservation.reservationId).seedFromTrustedAuthority({
        grant: outcome.reservation, tenantId: scope.tenantId, authorityRevision: resolution.authority.authorityRevision, authorityExpiresAt: Math.min(outcome.reservation.expiresAt, resolution.authority.authorityExpiresAt),
      });
    }
    return outcome;
  }

  /**
   * A warm decrement still starts with a fresh D1 credential/authority read.
   * The holder avoids a central balance RPC, but it cannot treat its old lease
   * as evidence that a policy change or revocation has not happened.
   */
  async spendWarmForVerifiedScope(scope: VerifiedTenantScope, request: ServerWarmBudgetSpendRequest) {
    const principal = await this.authorization.authorize(scope);
    if (!principal) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    const checkedAt = this.now();
    const resolution = await this.repository.resolveForVerifiedPrincipal(scope, principal, checkedAt);
    if (resolution.kind === 'unavailable') return { status: 'rejected' as const, reason: 'stale-policy' as const };
    const coordinator = this.namespace.get(this.namespace.idFromName(
      resolution.kind === 'active' ? resolution.authority.aggregateId : resolution.revocation.aggregateId,
    )) as unknown as BudgetCoordinatorDO;
    if (resolution.kind === 'revoked') {
      await coordinator.revokeFromTrustedAuthority(resolution.revocation);
      return { status: 'rejected' as const, reason: 'stale-policy' as const };
    }
    await coordinator.refreshFromTrustedAuthority(resolution.authority);
    const policy = resolution.authority.tenantAllocations.find(allocation => allocation.effectivePolicy.tenantId === scope.tenantId)?.effectivePolicy;
    if (!policy) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    const holder = this.holder(scope, request.holderId, request.reservationId);
    const fresh = await holder.refreshFromTrustedAuthority({
      tenantId: scope.tenantId, policyRevision: policy.revision, restrictionRevision: policy.restrictionRevision,
      authorityRevision: resolution.authority.authorityRevision, authorityExpiresAt: resolution.authority.authorityExpiresAt,
      now: checkedAt,
    });
    if (!fresh) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    // Reserve both bounded attempts before the first operation runs. The
    // holder rejects a third same-operation delivery, so repeating an RPC
    // cannot turn an old local balance into unbounded refresh work.
    const reservedEnvelope = sumResourceEnvelopes(
      request.envelope,
      ...Array.from({ length: MAX_WARM_SPEND_ATTEMPTS }, () => WARM_SPEND_CONTROL_PLANE_ENVELOPE),
    );
    return holder.spendFromTrustedAuthority({
      ...request,
      envelope: reservedEnvelope,
      tenantId: scope.tenantId,
      now: checkedAt,
    });
  }
}
