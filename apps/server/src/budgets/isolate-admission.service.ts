import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { RESOURCE_DIMENSIONS, type EffectiveTenantCostPolicy, type ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import { BudgetAuthorityRepository, type BudgetCommitSnapshot } from '../repositories/budget-authority.repository';
import type { CurrentBudgetAuthorityGate } from './budget-coordinator.service';
import type { TrustedBudgetCoordinatorAuthority } from './owner-aggregate';
import { IsolateBudgetGrantHolder, isolateWarmReservedEnvelope, type CurrentIsolateGrantAuthority, type IsolateGrantScope, type IsolateGrantSpendResult } from './isolate-grant-holder';

export const MAX_ACTIVE_ISOLATE_SCOPES = 64;
export const MAX_ISOLATE_BLOCK_OPERATIONS = 8;
export const MAX_ISOLATE_SCOPE_REFILLS = 4;
// One initial identity plus two observations per possible renewal: retirement
// may see one policy, and the subsequent fresh attempt may see another.
const MAX_OBSERVED_POLICY_IDENTITIES = 1 + 2 * MAX_ISOLATE_SCOPE_REFILLS;
/** Estimated bound: two allocation sizes, each with one lost-response retry; four refresh/reserve pairs. */
export const ISOLATE_COLD_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({ doRequests: 8, doRowsRead: 8, doRowsWritten: 8, logEvents: 8 });
export type CanonicalBudgetIntent = Readonly<{ operationId: string; operationFingerprint: string; workScopeKey: string }>;
export type BudgetCommitAuthority = Readonly<{ snapshot: BudgetCommitSnapshot; expiresAt: number;
  purpose: 'new-work'; operationId: string; operationFingerprint: string }>;
export type IsolateAdmissionResult = IsolateGrantSpendResult & Readonly<{ commitAuthority?: BudgetCommitAuthority }>;
type ActiveAuthority = { commitSnapshot: BudgetCommitSnapshot; trusted: TrustedBudgetCoordinatorAuthority; policy: EffectiveTenantCostPolicy; local: CurrentIsolateGrantAuthority };
type HeldGrant = { holder: IsolateBudgetGrantHolder; reservationId: string; expiresAt: number; dimensions: readonly string[] };
type RevisionFloor = { deploymentId: string; policyId: string; authorityRevision: number; policyRevision: number; restrictionRevision: number };
type CacheEntry = {
  bindingIdentity: object; namespace: DurableObjectNamespace; key: string; epoch: string; snapshot: BudgetCommitSnapshot; expiresAt: number; refills: number;
  generation: number; authorityCheckedAt: number;
  revisionFloors: RevisionFloor[];
  holders: HeldGrant[]; operations: Map<string, HeldGrant>; blocked: boolean; pending?: Promise<HeldGrant | null>; failure?: IsolateGrantSpendResult;
};

function scaledEnvelope(cost: ResourceAmounts, operations: number): ResourceAmounts {
  const result: ResourceAmounts = {};
  for (const dimension of RESOURCE_DIMENSIONS) {
    const units = (cost[dimension] ?? 0) * operations + (ISOLATE_COLD_ENVELOPE[dimension] ?? 0);
    if (!Number.isSafeInteger(units)) throw new Error('isolate allocation overflow');
    if (units > 0) result[dimension] = units;
  }
  return result;
}

/** Static owner/tenant ceilings select a possible block; the coordinator remains the live balance authority. */
export function selectIsolateBlockSize(authority: TrustedBudgetCoordinatorAuthority, policy: EffectiveTenantCostPolicy, business: ResourceAmounts): number {
  const cost = isolateWarmReservedEnvelope(business);
  if (!cost) return 0;
  for (let size = MAX_ISOLATE_BLOCK_OPERATIONS; size >= 1; size--) {
    const envelope = scaledEnvelope(cost, size);
    const fits = Object.entries(envelope).every(([dimension, units]) => {
      const owner = authority.ownerPolicy.budgets.find(budget => budget.dimension === dimension);
      const tenant = policy.budgets.find(budget => budget.dimension === dimension);
      return !!owner && !!tenant && units <= Number(BigInt(owner.limit) * BigInt(100 - owner.recoveryPercent) / 100n)
        && units <= Number(BigInt(tenant.limit) * BigInt(100 - tenant.recoveryPercent) / 100n);
    });
    if (fits) return size;
  }
  return 0;
}

function epoch(authority: ActiveAuthority): string {
  return JSON.stringify([authority.trusted.aggregateId, authority.trusted.authorityRevision, authority.policy.policyId,
    authority.policy.revision, authority.policy.restrictionRevision, authority.policy.budgets.map(budget => [budget.dimension, budget.allocationId, budget.window])]);
}
function sameEpoch(entry: CacheEntry, authority: ActiveAuthority): boolean {
  // Retain the repository's frozen, size-bounded source snapshot by reference.
  // Compare exact source values without copying its JSON into another cache key:
  // an in-place edit must retire the paid holder even when revisions stay equal.
  return entry.epoch === epoch(authority) && Object.entries(entry.snapshot).every(
    ([key, value]) => value === authority.commitSnapshot[key as keyof BudgetCommitSnapshot]);
}
function localForGrant(authority: ActiveAuthority, grant: HeldGrant): CurrentIsolateGrantAuthority {
  return { ...authority.local, allocations: authority.local.allocations.filter(allocation => grant.dimensions.includes(allocation.dimension)) };
}
function intervalEnd(authority: ActiveAuthority): number {
  return Math.min(Number.MAX_SAFE_INTEGER, ...authority.policy.budgets.flatMap(budget => budget.window.kind === 'interval' ? [budget.window.endsAt] : []));
}
const stale = (): IsolateGrantSpendResult => ({ status: 'rejected', reason: 'stale-policy' });
const exhausted = (): IsolateGrantSpendResult => ({ status: 'rejected', reason: 'exhausted' });

/**
 * Bounded isolate registry: at most 64 entries TOTAL across all binding contexts,
 * four prepaid blocks per entry/window across all policy generations and eight
 * operations per block. Entries are not LRU-evicted to reset refill/replay
 * counters. Policy retirement can renew only into a newly charged holder.
 * Expiry retires holders and retains pending allocations until they settle;
 * it never releases their central charge. Stock-only entries remain bounded
 * and fail closed at the refill cap until isolate replacement.
 */
export class IsolateBudgetAdmissionCache {
  private entries: CacheEntry[] = [];

  private retire(entry: CacheEntry): void {
    if (!entry.blocked) entry.generation++;
    entry.blocked = true;
    for (const grant of entry.holders) grant.holder.invalidate();
  }

  private currentGeneration(entry: CacheEntry, generation: number): boolean {
    return !entry.blocked && entry.generation === generation;
  }

  private observeAuthority(entry: CacheEntry, authority: ActiveAuthority): boolean {
    // Retirement cannot erase a newer revision already observed locally, even
    // when that transition has not yet reached the central coordinator.
    const deploymentId = authority.commitSnapshot.deployment_id, policyId = authority.policy.policyId;
    const floor = entry.revisionFloors.find(item => item.deploymentId === deploymentId && item.policyId === policyId);
    if (authority.trusted.authorityCheckedAt < entry.authorityCheckedAt
      || entry.revisionFloors.some(item => item.deploymentId === deploymentId && authority.trusted.authorityRevision < item.authorityRevision)
      || (floor && (authority.policy.revision < floor.policyRevision || authority.policy.restrictionRevision < floor.restrictionRevision))
      || (!floor && entry.revisionFloors.length >= MAX_OBSERVED_POLICY_IDENTITIES)) return false;
    entry.authorityCheckedAt = authority.trusted.authorityCheckedAt;
    const current = { deploymentId, policyId, authorityRevision: authority.trusted.authorityRevision,
      policyRevision: authority.policy.revision, restrictionRevision: authority.policy.restrictionRevision };
    if (floor) Object.assign(floor,current); else entry.revisionFloors.push(current);
    return true;
  }

  private renew(entry: CacheEntry, authority: ActiveAuthority): void {
    // Only current authority can begin a replacement generation. Old balances
    // and attempts are never imported; the next allocation needs a new charge.
    // Refill credits and the existing eviction horizon survive source edits.
    entry.epoch = epoch(authority); entry.snapshot = authority.commitSnapshot;
    entry.authorityCheckedAt = authority.trusted.authorityCheckedAt;
    entry.expiresAt = Math.max(entry.expiresAt, intervalEnd(authority));
    entry.holders = []; entry.operations.clear(); entry.failure = undefined;
    entry.blocked = false;
  }

  /** Synthetic runtime diagnostics; no application route exposes this control. Loss is never a refund. */
  discardForTrustedRuntime(): void { for (const entry of this.entries) this.retire(entry); this.entries = []; }

  inspectForTrustedRuntime(): Readonly<{ scopes: number; holders: number; operations: number; refills: number }> {
    return { scopes: this.entries.length, holders: this.entries.reduce((sum, entry) => sum + entry.holders.length, 0),
      operations: this.entries.reduce((sum, entry) => sum + entry.operations.size, 0), refills: this.entries.reduce((sum, entry) => sum + entry.refills, 0) };
  }

  private async allocate(entry: CacheEntry, generation: number, authority: ActiveAuthority, scope: IsolateGrantScope, business: ResourceAmounts, now: () => number): Promise<HeldGrant | null> {
    if (entry.refills >= MAX_ISOLATE_SCOPE_REFILLS) { entry.failure = { status: 'rejected', reason: 'capacity-exhausted' }; return null; }
    entry.refills++;
    const size = selectIsolateBlockSize(authority.trusted, authority.policy, business);
    if (!size) { entry.failure = exhausted(); return null; }
    const holder = new IsolateBudgetGrantHolder(scope, MAX_ISOLATE_BLOCK_OPERATIONS);
    const coordinator = entry.namespace.get(entry.namespace.idFromName(authority.trusted.aggregateId)) as unknown as BudgetCoordinatorDO;
    const cost = isolateWarmReservedEnvelope(business)!;
    for (const operations of size === 1 ? [1] : [size, 1]) {
      const envelope = scaledEnvelope(cost, operations);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (!this.currentGeneration(entry,generation) || now() >= authority.trusted.authorityExpiresAt) { entry.failure = stale(); return null; }
          await coordinator.refreshFromTrustedAuthority(authority.trusted);
          if (!this.currentGeneration(entry,generation)) { entry.failure = stale(); return null; }
          const outcome = await coordinator.reserveFromTrustedAuthority({ tenantId: scope.tenantId, holderId: holder.holderId,
            idempotencyKey: `${holder.holderId}:block:${operations}`, purpose: scope.purpose, envelope,
            expectedPolicyId: authority.policy.policyId, expectedPolicyRevision: authority.policy.revision,
            expectedRestrictionRevision: authority.policy.restrictionRevision, now: now() });
          if (!this.currentGeneration(entry,generation)) { holder.invalidate(); entry.failure = stale(); return null; }
          if ((outcome.status === 'granted' || outcome.status === 'idempotent') && outcome.reservation) {
            const held = { holder, reservationId: outcome.reservation.reservationId, expiresAt: outcome.reservation.expiresAt, dimensions: Object.keys(envelope) };
            if (!holder.install(outcome.reservation, localForGrant(authority, held), now())) { holder.invalidate(); entry.failure = stale(); return null; }
            // Delivery only to this isolate instance: never seed BudgetGrantHolderDO.
            entry.holders.push(held);
            return held;
          }
          if (outcome.reason === 'exhausted') { entry.failure = exhausted(); break; }
          entry.failure = outcome.reason === 'capacity-exhausted' ? { status: 'rejected', reason: 'capacity-exhausted' } : stale();
          return null;
        } catch {
          if (!this.currentGeneration(entry,generation) || attempt === 1) { holder.invalidate(); entry.failure = stale(); return null; }
          // Same live holder and idempotency key only. An uncertain response
          // cannot trigger a new allocation-size fallback.
        }
      }
    }
    return null;
  }

  async admit(input: {
    repository: BudgetAuthorityRepository; namespace: DurableObjectNamespace; authorization: CurrentBudgetAuthorityGate; scope: VerifiedTenantScope;
    credentialKey: string; intent: CanonicalBudgetIntent; business: ResourceAmounts; now: () => number;
  }): Promise<IsolateAdmissionResult> {
    const holderScope: IsolateGrantScope = { tenantId: input.scope.tenantId, credentialKey: input.credentialKey,
      workScopeKey: input.intent.workScopeKey, purpose: 'new-work' };
    const key = JSON.stringify(holderScope);
    const checkedAt = input.now();
    this.entries = this.entries.filter(entry => { if (checkedAt < entry.expiresAt) return true; this.retire(entry); return !!entry.pending; });
    let entry = this.entries.find(candidate => candidate.bindingIdentity === input.repository.bindingIdentity && candidate.namespace === input.namespace && candidate.key === key);
    const observedEntry = entry, observedGeneration = entry?.generation;
    const resolve = async (): Promise<ActiveAuthority | null> => {
      const principal = await input.authorization.authorize(input.scope);
      if (!principal) return null;
      const authority = await input.repository.resolveForVerifiedPrincipal(input.scope, principal, input.now());
      if (authority.kind !== 'active') return null;
      const policy = authority.authority.tenantAllocations.find(allocation => allocation.effectivePolicy.tenantId === input.scope.tenantId)?.effectivePolicy;
      if (!policy) return null;
      return { commitSnapshot: authority.commitSnapshot, trusted: authority.authority, policy, local: { ...holderScope, aggregateId: authority.authority.aggregateId,
        policyId: policy.policyId, policyRevision: policy.revision, restrictionRevision: policy.restrictionRevision,
        authorityRevision: authority.authority.authorityRevision, authorityCheckedAt: authority.authority.authorityCheckedAt,
        authorityExpiresAt: authority.authority.authorityExpiresAt,
        allocations: policy.budgets.map(budget => ({ dimension: budget.dimension, allocationId: budget.allocationId, windowId: budget.window.id })) } };
    };
    let authority = await resolve();
    // Another request may have inserted the same entry while this one loaded D1.
    entry = this.entries.find(candidate => candidate.bindingIdentity === input.repository.bindingIdentity && candidate.namespace === input.namespace && candidate.key === key);
    if (entry && observedEntry === entry && observedGeneration !== entry.generation) return stale();
    if (!authority) { if (entry) this.retire(entry); return stale(); }
    if (entry && !this.observeAuthority(entry,authority)) return stale();
    if (entry?.blocked) {
      if (entry.pending) return stale();
      if (entry.refills >= MAX_ISOLATE_SCOPE_REFILLS) return { status: 'rejected', reason: 'capacity-exhausted' };
      this.renew(entry,authority);
    }
    if (entry && !sameEpoch(entry, authority)) { this.retire(entry); return stale(); }
    if (!entry) {
      if (this.entries.length >= MAX_ACTIVE_ISOLATE_SCOPES) return { status: 'rejected', reason: 'capacity-exhausted' };
      entry = { bindingIdentity: input.repository.bindingIdentity, namespace: input.namespace, key, epoch: epoch(authority), snapshot: authority.commitSnapshot, expiresAt: intervalEnd(authority),
        generation: 0, authorityCheckedAt: authority.trusted.authorityCheckedAt,
        revisionFloors: [{ deploymentId: authority.commitSnapshot.deployment_id, policyId: authority.policy.policyId,
          authorityRevision: authority.trusted.authorityRevision, policyRevision: authority.policy.revision, restrictionRevision: authority.policy.restrictionRevision }],
        refills: 0, holders: [], operations: new Map(), blocked: false };
      this.entries.push(entry);
    }
    const generation = entry.generation;
    const spend = (held: HeldGrant): IsolateAdmissionResult => {
      const result = held.holder.spend({ holderId: held.holder.holderId, reservationId: held.reservationId,
        operationId: input.intent.operationId, operationFingerprint: input.intent.operationFingerprint, envelope: input.business }, localForGrant(authority!, held), input.now());
      if (result.status === 'rejected') return result;
      return { ...result, commitAuthority: Object.freeze({ snapshot: authority!.commitSnapshot,
        expiresAt: Math.min(held.expiresAt, authority!.trusted.authorityExpiresAt), purpose: 'new-work',
        operationId: input.intent.operationId, operationFingerprint: input.intent.operationFingerprint }) };
    };
    const prior = entry.operations.get(input.intent.operationId);
    if (prior) return spend(prior);
    const latest = entry.holders.at(-1);
    if (latest) {
      const outcome = spend(latest);
      if (outcome.status === 'spent') { entry.operations.set(input.intent.operationId, latest); return outcome; }
      if (outcome.status !== 'rejected' || !['exhausted', 'capacity-exhausted', 'stale-policy'].includes(outcome.reason ?? '')) return outcome;
      if (outcome.reason === 'stale-policy' && input.now() < latest.expiresAt) return stale();
    }
    if (!entry.pending) {
      entry.failure = undefined;
      entry.pending = this.allocate(entry, generation, authority, holderScope, input.business, input.now);
    }
    const pending = entry.pending;
    const held = await pending;
    if (entry.pending === pending) entry.pending = undefined;
    if (!held) return entry.failure ?? stale();
    // A request may await a shared cold grant. Recheck its own credentials and
    // epoch after that await, then decrement synchronously before returning.
    // The business envelope includes this one extra bounded authority lookup.
    authority = await resolve();
    if (!this.currentGeneration(entry,generation)) return stale();
    if (!authority) { this.retire(entry); return stale(); }
    if (!this.observeAuthority(entry,authority)) return stale();
    if (!sameEpoch(entry, authority)) { this.retire(entry); return stale(); }
    const outcome = spend(held);
    if (outcome.status === 'spent') entry.operations.set(input.intent.operationId, held);
    return outcome;
  }
}
