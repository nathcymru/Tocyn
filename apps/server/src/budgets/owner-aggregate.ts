/**
 * Pure aggregate transitions used by BudgetCoordinatorDO. One state holds all
 * tenant allocations sharing an owner allocation, so a single Durable Object
 * storage commit can reserve both layers together. This is deliberately not a
 * request-facing authority: its input must come from verified server policy,
 * deployment and tenant-membership loading.
 */
import {
  type BudgetPurpose,
  type CostPolicy,
  type EffectiveTenantCostPolicy,
  type ResourceAmounts,
  type ResourceDimension,
} from '@luminatick/shared';
import {
  BudgetCoordinatorStateError,
  applyTrustedCoordinatorAuthority,
  createBudgetCoordinatorState,
  expireBudgetGrants,
  reconcileBudgetGrant,
  reserveBudgetGrant,
  type BudgetCoordinatorState,
  type CoordinatorAllocation,
  type CoordinatorCapacityDefect,
  type ReconcileBudgetGrantInput,
  type ReserveBudgetGrantInput,
  type ReserveBudgetGrantResult,
} from './coordinator-state';

const STATE_VERSION = 1 as const;
const MAX_TENANT_ALLOCATIONS = 128;
const MAX_RESERVATIONS = 4_096;

export type TrustedTenantAllocation = Readonly<{
  /** Server-issued global reservation namespace; never supplied by a client. */
  reservationNamespace: string;
  effectivePolicy: EffectiveTenantCostPolicy;
}>;

/**
 * This is an internal boundary only. The D1 authority repository supplies its
 * snapshots; application composition and owner-authoring/audit remain later
 * #64/#90 work. A matching revision alone is not evidence of freshness.
 */
export type TrustedBudgetCoordinatorAuthority = Readonly<{
  /** Server-derived Durable Object name for this deployment/owner allocation. */
  aggregateId: string;
  ownerPolicy: CostPolicy;
  tenantAllocations: readonly TrustedTenantAllocation[];
  authorityCheckedAt: number;
  /** Monotonic deployment-owner authority epoch, loaded only from D1 authority state. */
  authorityRevision: number;
  /** A new reservation fails closed at this time unless server authority refreshes it. */
  authorityExpiresAt: number;
  maxReservations: number;
}>;

export type TrustedBudgetCoordinatorRevocation = Readonly<{
  aggregateId: string;
  authorityRevision: number;
  authorityCheckedAt: number;
}>;

export type OwnerAggregateCapacityDefect = Readonly<{
  tenantId: string;
  defect: CoordinatorCapacityDefect;
}>;

export type BudgetOwnerAggregateState = Readonly<{
  schemaVersion: typeof STATE_VERSION;
  aggregateId: string;
  deploymentId: string;
  ownerPolicyId: string;
  ownerPolicyRevision: number;
  authorityCheckedAt: number;
  authorityRevision: number;
  authorityExpiresAt: number;
  /** A higher authority revision or revocation freezes grants; reconciliation remains allowed. */
  newAdmissionsBlocked: boolean;
  maxReservations: number;
  ownerAllocations: readonly CoordinatorAllocation[];
  /** Current owner allocation set; historical allocations remain above for reconciliation only. */
  activeOwnerAllocations: readonly CoordinatorAllocation[];
  tenantStates: readonly BudgetCoordinatorState[];
  capacityDefects: readonly OwnerAggregateCapacityDefect[];
}>;

export type ReserveOwnerAggregateInput = Readonly<ReserveBudgetGrantInput & {
  /** Resolved from server-verified tenant membership, never a client claim. */
  tenantId: string;
}>;
export type ReconcileOwnerAggregateInput = Readonly<ReconcileBudgetGrantInput & {
  /** Resolved from the trusted reservation record at the server boundary. */
  tenantId: string;
}>;

function assertIdentity(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new BudgetCoordinatorStateError(`${description} must be a non-empty bounded identifier without control characters`);
  }
}

function assertReservationLimit(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_RESERVATIONS) {
    throw new BudgetCoordinatorStateError(`maximum aggregate reservations must be a safe integer from 1 to ${MAX_RESERVATIONS}`);
  }
}

function sameWindow(left: CoordinatorAllocation['window'], right: CoordinatorAllocation['window']): boolean {
  return left.kind === right.kind && left.id === right.id
    && (left.kind === 'stock' || (right.kind === 'interval' && left.startsAt === right.startsAt && left.endsAt === right.endsAt));
}

function ownerAllocations(authority: TrustedBudgetCoordinatorAuthority): readonly CoordinatorAllocation[] {
  for (const budget of authority.ownerPolicy.budgets) {
    if (budget.provenance !== 'owner-allocation') throw new BudgetCoordinatorStateError('owner policy budgets must be owner-selected allocations');
  }
  // The existing strict normalizer validates resource units, windows and the
  // 80/20 purpose partition without treating this synthetic identifier as an
  // authorization decision.
  return createBudgetCoordinatorState({
    coordinatorId: 'owner-policy-validation',
    maxReservations: authority.maxReservations,
    authority: {
      authorityCheckedAt: authority.authorityCheckedAt,
      effectivePolicy: {
        ...authority.ownerPolicy,
        tenantId: 'owner-policy-validation',
        restrictionRevision: 1,
        disabledFeatures: [],
      },
    },
  }).allocations;
}

function assertTenantMatchesOwner(
  tenant: TrustedTenantAllocation,
  authority: TrustedBudgetCoordinatorAuthority,
  owners: readonly CoordinatorAllocation[],
): void {
  assertIdentity(tenant.reservationNamespace, 'trusted reservation namespace');
  const policy = tenant.effectivePolicy;
  if (policy.policyId !== authority.ownerPolicy.policyId || policy.revision !== authority.ownerPolicy.revision
    || policy.deploymentId !== authority.ownerPolicy.deploymentId || policy.catalogueVersion !== authority.ownerPolicy.catalogueVersion
    || policy.maxGrantLifetimeMs > authority.ownerPolicy.maxGrantLifetimeMs) {
    throw new BudgetCoordinatorStateError('tenant allocation must derive from the configured owner policy');
  }
  for (const budget of policy.budgets) {
    const owner = owners.find(candidate => candidate.dimension === budget.dimension
      && candidate.allocationId === budget.allocationId && sameWindow(candidate.window, budget.window));
    if (!owner || budget.provenance !== 'owner-allocation' || budget.limit > owner.limit
      || budget.recoveryPercent !== authority.ownerPolicy.budgets.find(candidate => candidate.dimension === budget.dimension)?.recoveryPercent) {
      throw new BudgetCoordinatorStateError('tenant allocation must only lower its matching owner allocation');
    }
  }
}

/** Creates a bounded, serializable state from a server-trusted aggregate snapshot. */
export function createBudgetOwnerAggregateState(authority: TrustedBudgetCoordinatorAuthority): BudgetOwnerAggregateState {
  assertIdentity(authority.aggregateId, 'trusted aggregate id');
  assertReservationLimit(authority.maxReservations);
  if (!Number.isSafeInteger(authority.authorityCheckedAt) || authority.authorityCheckedAt < 0) throw new BudgetCoordinatorStateError('authority check time must be a non-negative safe integer');
  if (!Number.isSafeInteger(authority.authorityRevision) || authority.authorityRevision < 1) throw new BudgetCoordinatorStateError('authority revision must be a positive safe integer');
  if (!Number.isSafeInteger(authority.authorityExpiresAt) || authority.authorityExpiresAt <= authority.authorityCheckedAt) throw new BudgetCoordinatorStateError('authority expiry must follow its check time');
  if (!Array.isArray(authority.tenantAllocations) || authority.tenantAllocations.length < 1 || authority.tenantAllocations.length > MAX_TENANT_ALLOCATIONS) {
    throw new BudgetCoordinatorStateError(`trusted authority must contain from 1 to ${MAX_TENANT_ALLOCATIONS} tenant allocations`);
  }
  const owners = ownerAllocations(authority);
  const tenantIds = new Set<string>();
  const namespaces = new Set<string>();
  const tenantStates = authority.tenantAllocations.map(tenant => {
    assertTenantMatchesOwner(tenant, authority, owners);
    const tenantId = tenant.effectivePolicy.tenantId;
    if (tenantIds.has(tenantId)) throw new BudgetCoordinatorStateError('trusted authority must not repeat a tenant allocation');
    if (namespaces.has(tenant.reservationNamespace)) throw new BudgetCoordinatorStateError('trusted authority must not repeat a reservation namespace');
    tenantIds.add(tenantId); namespaces.add(tenant.reservationNamespace);
    return createBudgetCoordinatorState({
      coordinatorId: tenant.reservationNamespace,
      maxReservations: authority.maxReservations,
      authority: { effectivePolicy: tenant.effectivePolicy, authorityCheckedAt: authority.authorityCheckedAt },
    });
  });
  return {
    schemaVersion: STATE_VERSION,
    aggregateId: authority.aggregateId,
    deploymentId: authority.ownerPolicy.deploymentId,
    ownerPolicyId: authority.ownerPolicy.policyId,
    ownerPolicyRevision: authority.ownerPolicy.revision,
    authorityCheckedAt: authority.authorityCheckedAt,
    authorityRevision: authority.authorityRevision,
    authorityExpiresAt: authority.authorityExpiresAt,
    newAdmissionsBlocked: false,
    maxReservations: authority.maxReservations,
    ownerAllocations: owners,
    activeOwnerAllocations: owners,
    tenantStates,
    capacityDefects: [],
  };
}

function tenantIndex(state: BudgetOwnerAggregateState, tenantId: string): number {
  assertIdentity(tenantId, 'trusted tenant id');
  return state.tenantStates.findIndex(candidate => candidate.tenantId === tenantId);
}

function allocationMatches(reference: { dimension: ResourceDimension; allocationId: string; windowId: string }, allocation: CoordinatorAllocation): boolean {
  return reference.dimension === allocation.dimension && reference.allocationId === allocation.allocationId && reference.windowId === allocation.window.id;
}

function charged(state: BudgetOwnerAggregateState, allocation: CoordinatorAllocation, purpose: BudgetPurpose): number {
  let total = 0;
  for (const tenant of state.tenantStates) {
    for (const grant of tenant.grants) {
      if (grant.purpose !== purpose || !grant.allocations.some(reference => allocationMatches(reference, allocation))) continue;
      const next = total + (grant.accounted[allocation.dimension] ?? 0);
      if (!Number.isSafeInteger(next)) throw new BudgetCoordinatorStateError('owner aggregate charge overflow');
      total = next;
    }
  }
  return total;
}

function aggregateExhausted(state: BudgetOwnerAggregateState, tenant: BudgetCoordinatorState, input: ReserveBudgetGrantInput): boolean {
  for (const [dimension, units] of Object.entries(input.envelope) as [ResourceDimension, number][]) {
    const tenantAllocation = tenant.allocations.find(allocation => allocation.dimension === dimension && tenant.activeAllocationKeys.includes(`${allocation.dimension}\u0000${allocation.allocationId}\u0000${allocation.window.id}`));
    if (!tenantAllocation) return true;
    const owner = state.activeOwnerAllocations.find(allocation => allocationMatches({ dimension, allocationId: tenantAllocation.allocationId, windowId: tenantAllocation.window.id }, allocation));
    if (!owner) return true;
    const limit = input.purpose === 'new-work' ? owner.newWorkLimit : owner.recoveryLimit;
    if (charged(state, owner, input.purpose) + units > limit) return true;
  }
  return false;
}

function replaceTenant(state: BudgetOwnerAggregateState, index: number, tenant: BudgetCoordinatorState, patch: Partial<BudgetOwnerAggregateState> = {}): BudgetOwnerAggregateState {
  const tenantStates = [...state.tenantStates];
  tenantStates[index] = tenant;
  return { ...state, ...patch, tenantStates, capacityDefects: patch.capacityDefects ?? state.capacityDefects };
}

function totalGrants(state: BudgetOwnerAggregateState): number {
  return state.tenantStates.reduce((total, tenant) => total + tenant.grants.length, 0);
}

/** A grant cannot remain valid after the authority lease that approved it. */
function clipGrantToAuthorityLease(result: ReserveBudgetGrantResult, authorityExpiresAt: number): ReserveBudgetGrantResult {
  const reservation = result.outcome.reservation;
  if (result.outcome.status !== 'granted' || !reservation || reservation.expiresAt <= authorityExpiresAt) return result;
  const clipped = { ...reservation, expiresAt: authorityExpiresAt };
  return {
    state: {
      ...result.state,
      grants: result.state.grants.map(grant => grant.reservationId === reservation.reservationId ? clipped : grant),
    },
    outcome: { ...result.outcome, reservation: clipped },
  };
}

/**
 * Reserves the tenant allocation and owner aggregate in one returned state.
 * The Durable Object commits this exact state before responding, which is the
 * atomicity boundary; this helper alone does not persist or authenticate.
 */
export function reserveOwnerAggregate(state: BudgetOwnerAggregateState, input: ReserveOwnerAggregateInput): Readonly<{ state: BudgetOwnerAggregateState; outcome: ReserveBudgetGrantResult['outcome'] }> {
  const index = tenantIndex(state, input.tenantId);
  if (index < 0) return { state, outcome: { status: 'rejected', reason: 'stale-policy' } };
  const tenant = state.tenantStates[index];
  const request: ReserveBudgetGrantInput = { ...input };
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new BudgetCoordinatorStateError('current time must be a non-negative safe integer');
  if (state.newAdmissionsBlocked || input.now >= state.authorityExpiresAt) {
    return { state: replaceTenant(state, index, expireBudgetGrants(tenant, input.now)), outcome: { status: 'rejected', reason: 'stale-policy' } };
  }
  const hasPrior = tenant.grants.some(grant => grant.holderId === input.holderId && grant.idempotencyKey === input.idempotencyKey && grant.purpose === input.purpose);
  if (input.expectedPolicyId !== tenant.policyId || input.expectedPolicyRevision !== tenant.policyRevision || input.expectedRestrictionRevision !== tenant.restrictionRevision
    || hasPrior) {
    const result = reserveBudgetGrant(tenant, request);
    return { state: replaceTenant(state, index, result.state), outcome: result.outcome };
  }
  const expired = expireBudgetGrants(tenant, input.now);
  const expiredState = replaceTenant(state, index, expired);
  if (state.capacityDefects.length > 0) return { state: expiredState, outcome: { status: 'rejected', reason: 'capacity-defect' } };
  if (totalGrants(state) >= state.maxReservations) return { state: expiredState, outcome: { status: 'rejected', reason: 'capacity-exhausted' } };
  if (aggregateExhausted(expiredState, expired, input)) return { state: expiredState, outcome: { status: 'rejected', reason: 'exhausted' } };
  const result = clipGrantToAuthorityLease(reserveBudgetGrant(expired, request), expiredState.authorityExpiresAt);
  return { state: replaceTenant(expiredState, index, result.state), outcome: result.outcome };
}

function sameAuthorityShape(state: BudgetOwnerAggregateState, candidate: BudgetOwnerAggregateState): boolean {
  if (state.aggregateId !== candidate.aggregateId || state.deploymentId !== candidate.deploymentId
    || state.ownerPolicyId !== candidate.ownerPolicyId || state.ownerPolicyRevision !== candidate.ownerPolicyRevision
    || state.maxReservations !== candidate.maxReservations || state.tenantStates.length !== candidate.tenantStates.length
    || state.ownerAllocations.length !== candidate.ownerAllocations.length
    || state.activeOwnerAllocations.length !== candidate.activeOwnerAllocations.length) return false;
  const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (!state.ownerAllocations.every((allocation, index) => sameJson(allocation, candidate.ownerAllocations[index]))) return false;
  if (!state.activeOwnerAllocations.every((allocation, index) => sameJson(allocation, candidate.activeOwnerAllocations[index]))) return false;
  return state.tenantStates.every((tenant, index) => tenant.tenantId === candidate.tenantStates[index]?.tenantId
    && tenant.coordinatorId === candidate.tenantStates[index]?.coordinatorId
    && tenant.policyId === candidate.tenantStates[index]?.policyId
    && tenant.policyRevision === candidate.tenantStates[index]?.policyRevision
    && tenant.restrictionRevision === candidate.tenantStates[index]?.restrictionRevision
    && sameJson(tenant.allocations, candidate.tenantStates[index]?.allocations));
}

function mergeAllocations(existing: readonly CoordinatorAllocation[], current: readonly CoordinatorAllocation[]): readonly CoordinatorAllocation[] {
  const result = [...existing];
  for (const allocation of current) {
    if (!result.some(candidate => allocationMatches({ dimension: allocation.dimension, allocationId: allocation.allocationId, windowId: allocation.window.id }, candidate))) result.push(allocation);
  }
  return result;
}

/**
 * Applies a monotonic policy/restriction transition without releasing earlier
 * allocations. Core tenant transitions mark in-flight grants uncertain, while
 * historical owner allocations remain available to terminal reconciliation.
 */
function transitionBudgetOwnerAggregateAuthority(state: BudgetOwnerAggregateState, candidate: BudgetOwnerAggregateState, authority: TrustedBudgetCoordinatorAuthority): BudgetOwnerAggregateState {
  if (candidate.aggregateId !== state.aggregateId || candidate.deploymentId !== state.deploymentId
    || candidate.ownerPolicyId !== state.ownerPolicyId || candidate.maxReservations !== state.maxReservations
    || candidate.tenantStates.length !== state.tenantStates.length) throw new BudgetCoordinatorStateError('material authority transition changes coordinator identity or tenant allocation set');
  const nextTenants = state.tenantStates.map(current => {
    const next = candidate.tenantStates.find(tenant => tenant.tenantId === current.tenantId && tenant.coordinatorId === current.coordinatorId);
    if (!next) throw new BudgetCoordinatorStateError('material authority transition changes a tenant reservation namespace');
    if (next.policyRevision === current.policyRevision && next.restrictionRevision === current.restrictionRevision) {
      if (JSON.stringify(next.allocations) !== JSON.stringify(current.allocations)) throw new BudgetCoordinatorStateError('material authority allocation changed without a policy or restriction revision');
      return current;
    }
    const trustedTenant = authority.tenantAllocations.find(tenant => tenant.effectivePolicy.tenantId === current.tenantId
      && tenant.reservationNamespace === current.coordinatorId);
    if (!trustedTenant) throw new BudgetCoordinatorStateError('material authority transition loses trusted tenant policy');
    return applyTrustedCoordinatorAuthority(current, {
      authorityCheckedAt: candidate.authorityCheckedAt,
      effectivePolicy: trustedTenant.effectivePolicy,
    });
  });
  return {
    ...state,
    ownerPolicyRevision: candidate.ownerPolicyRevision,
    authorityCheckedAt: candidate.authorityCheckedAt,
    authorityExpiresAt: candidate.authorityExpiresAt,
    authorityRevision: candidate.authorityRevision,
    newAdmissionsBlocked: false,
    ownerAllocations: mergeAllocations(state.ownerAllocations, candidate.activeOwnerAllocations),
    activeOwnerAllocations: candidate.activeOwnerAllocations,
    tenantStates: nextTenants,
  };
}

/** Refreshes an identical authority lease or safely transitions a newer revision. */
export function refreshBudgetOwnerAggregateAuthority(state: BudgetOwnerAggregateState, authority: TrustedBudgetCoordinatorAuthority): BudgetOwnerAggregateState {
  const candidate = createBudgetOwnerAggregateState(authority);
  if (authority.authorityRevision < state.authorityRevision) throw new BudgetCoordinatorStateError('trusted authority revision cannot move backwards');
  if (authority.authorityRevision > state.authorityRevision) return transitionBudgetOwnerAggregateAuthority(state, candidate, authority);
  if (!sameAuthorityShape(state, candidate)) throw new BudgetCoordinatorStateError('material authority changed without an authority revision');
  if (authority.authorityCheckedAt < state.authorityCheckedAt) throw new BudgetCoordinatorStateError('trusted authority check time cannot move backwards');
  return { ...state, authorityCheckedAt: authority.authorityCheckedAt, authorityExpiresAt: authority.authorityExpiresAt };
}

/** Delivers a newer deployment authority revocation without releasing any accepted charge. */
export function revokeBudgetOwnerAggregateAuthority(state: BudgetOwnerAggregateState, revocation: TrustedBudgetCoordinatorRevocation): BudgetOwnerAggregateState {
  assertIdentity(revocation.aggregateId, 'trusted aggregate id');
  if (revocation.aggregateId !== state.aggregateId) throw new BudgetCoordinatorStateError('revocation aggregate does not match coordinator');
  if (!Number.isSafeInteger(revocation.authorityRevision) || revocation.authorityRevision < state.authorityRevision) throw new BudgetCoordinatorStateError('revocation authority revision cannot move backwards');
  if (!Number.isSafeInteger(revocation.authorityCheckedAt) || revocation.authorityCheckedAt < state.authorityCheckedAt) throw new BudgetCoordinatorStateError('revocation check time cannot move backwards');
  return {
    ...state,
    authorityRevision: revocation.authorityRevision,
    authorityCheckedAt: revocation.authorityCheckedAt,
    authorityExpiresAt: revocation.authorityCheckedAt,
    newAdmissionsBlocked: true,
  };
}

/** Reconciliation remains bound to the tenant/holder grant and blocks the whole aggregate on an overrun. */
export function reconcileOwnerAggregate(state: BudgetOwnerAggregateState, input: ReconcileOwnerAggregateInput): Readonly<{ state: BudgetOwnerAggregateState; outcome: ReturnType<typeof reconcileBudgetGrant>['outcome'] }> {
  const index = tenantIndex(state, input.tenantId);
  if (index < 0) return { state, outcome: 'rejected' };
  const result = reconcileBudgetGrant(state.tenantStates[index], input);
  let next = replaceTenant(state, index, result.state);
  if (result.outcome === 'capacity-defect') {
    const defect = result.state.capacityDefects.at(-1);
    if (!defect) throw new BudgetCoordinatorStateError('reconciliation capacity defect was not retained');
    next = replaceTenant(next, index, result.state, { capacityDefects: [...state.capacityDefects, { tenantId: input.tenantId, defect }] });
  }
  return { state: next, outcome: result.outcome };
}

export const BUDGET_COORDINATOR_BOUNDS = Object.freeze({ maxTenantAllocations: MAX_TENANT_ALLOCATIONS, maxReservations: MAX_RESERVATIONS });
