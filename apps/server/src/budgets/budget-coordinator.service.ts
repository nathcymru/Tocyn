import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetPurpose, ResourceAmounts } from '@luminatick/shared';
import { BudgetAuthorityRepository } from './authority-repository';
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

/** The eventual handler must revalidate session/expiry and capability before budget admission. */
export interface CurrentBudgetAuthorityGate {
  authorize(scope: VerifiedTenantScope): Promise<boolean>;
}

export type ServerWarmBudgetSpendRequest = Readonly<{
  holderId: string;
  reservationId: string;
  operationId: string;
  envelope: ResourceAmounts;
}>;

/**
 * This is the future active-path integration contract. It is not wired to an
 * endpoint in this slice. It derives tenant, policy/restriction revisions,
 * authority expiry and coordinator lookup from verified server state.
 */
export class BudgetCoordinatorService {
  constructor(
    private readonly repository: BudgetAuthorityRepository,
    private readonly namespace: DurableObjectNamespace,
    private readonly holderNamespace: DurableObjectNamespace,
    private readonly authorization: CurrentBudgetAuthorityGate,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private holder(scope: VerifiedTenantScope, holderId: string): BudgetGrantHolderDO {
    // This tuple is composed only after trusted scope/holder selection. No HTTP
    // or client parameter can select a Durable Object name in this slice.
    const name = JSON.stringify(['budget-grant-holder-v1', scope.tenantId, holderId]);
    return this.holderNamespace.get(this.holderNamespace.idFromName(name)) as unknown as BudgetGrantHolderDO;
  }

  async reserveForVerifiedScope(scope: VerifiedTenantScope, request: ServerBudgetReservationRequest): Promise<ServerBudgetReservationResult> {
    if (!await this.authorization.authorize(scope)) return { status: 'rejected', reason: 'unavailable' };
    const checkedAt = this.now();
    const resolution = await this.repository.resolveForVerifiedScope(scope, checkedAt);
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
    if (outcome.status === 'granted' && outcome.reservation) {
      await this.holder(scope, request.holderId).seedFromTrustedAuthority({
        grant: outcome.reservation, tenantId: scope.tenantId, authorityExpiresAt: outcome.reservation.expiresAt,
      });
    }
    return outcome;
  }

  /** Warm path: only the holder DO receives this durable decrement/replay write. */
  async spendWarmForVerifiedScope(scope: VerifiedTenantScope, request: ServerWarmBudgetSpendRequest) {
    if (!await this.authorization.authorize(scope)) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    return this.holder(scope, request.holderId).spendFromTrustedAuthority({ ...request, tenantId: scope.tenantId, now: this.now() });
  }
}
