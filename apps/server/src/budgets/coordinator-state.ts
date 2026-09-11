/**
 * Pure, JSON-serializable state transitions for the future #64 budget
 * authority. This module does not authenticate callers or persist atomically:
 * the Durable Object slice must obtain its policy from verified server
 * authority and commit each returned state transition before acting on it.
 * `authorityCheckedAt` records the trusted snapshot used to create/update state;
 * matching revisions fence that snapshot but do not establish current-policy
 * freshness. The caller must revalidate authority and apply revocations at the
 * approved boundary before authorizing a new reservation.
 * This state represents one tenant allocation only. It must never be wired as
 * an independent copy of an account-wide ceiling for each tenant: the later
 * authority must atomically enforce the owner aggregate and this allocation.
 */
import { RESOURCE_DIMENSIONS, type BudgetPurpose, type EffectiveTenantCostPolicy, type ResourceAmounts, type ResourceDimension, type ResourceWindow } from '@luminatick/shared';

const STATE_VERSION = 1 as const;
const MAX_RESERVATIONS = 4_096;
/** Initial holder delivery plus exactly one crash-recovery delivery. */
export const MAX_HOLDER_SEED_ATTEMPTS = 2;

export class BudgetCoordinatorStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetCoordinatorStateError';
  }
}

export type CoordinatorGrantStatus = 'reserved' | 'consumed' | 'uncertain' | 'reconciled';
export type CoordinatorAllocation = Readonly<{
  dimension: ResourceDimension;
  allocationId: string;
  window: ResourceWindow;
  limit: number;
  newWorkLimit: number;
  recoveryLimit: number;
}>;
export type CoordinatorGrant = Readonly<{
  reservationId: string;
  holderId: string;
  idempotencyKey: string;
  purpose: BudgetPurpose;
  policyRevision: number;
  restrictionRevision: number;
  createdAt: number;
  expiresAt: number;
  status: CoordinatorGrantStatus;
  /**
   * Delivery is deliberately finite. The coordinator commits this before each
   * holder RPC, so a lost seed acknowledgement cannot turn one reservation
   * into unbounded fresh-authority and holder work.
   */
  holderSeedAttempts: number;
  envelope: ResourceAmounts;
  remaining: ResourceAmounts;
  /** Charged amounts remain held until trusted terminal evidence changes them. */
  accounted: ResourceAmounts;
  allocations: readonly Readonly<{ dimension: ResourceDimension; allocationId: string; windowId: string }>[];
  reconciliation?: Readonly<{
    terminalEvidenceId: string;
    fingerprint: string;
    measured: ResourceAmounts;
    uncertain: ResourceAmounts;
    reconciledAt: number;
  }>;
}>;
export type CoordinatorCapacityDefect = Readonly<{
  reservationId: string;
  observedAt: number;
  envelope: ResourceAmounts;
  measured: ResourceAmounts;
  uncertain: ResourceAmounts;
  overrun: ResourceAmounts;
}>;
/**
 * A certified whole-grant closure releases its slot, but its observed charge
 * remains in this bounded allocation/window rollup. Stock keys intentionally
 * ignore a later allocation-id replacement: stock never resets.
 */
export type ClosedGrantCharge = Readonly<{
  dimension: ResourceDimension;
  allocationId: string;
  window: ResourceWindow;
  purpose: BudgetPurpose;
  units: number;
}>;
export type BudgetCoordinatorState = Readonly<{
  schemaVersion: typeof STATE_VERSION;
  coordinatorId: string;
  maxReservations: number;
  tenantId: string;
  policyId: string;
  policyRevision: number;
  restrictionRevision: number;
  maxGrantLifetimeMs: number;
  authorityCheckedAt: number;
  nextReservationSequence: number;
  /** Current budgets plus historical allocation identities still charged by grants. */
  allocations: readonly CoordinatorAllocation[];
  activeAllocationKeys: readonly string[];
  grants: readonly CoordinatorGrant[];
  closedCharges: readonly ClosedGrantCharge[];
  /** An observed overrun blocks new reservations until a later authority remediates it. */
  capacityDefects: readonly CoordinatorCapacityDefect[];
}>;

/** The caller must construct this only from authenticated server authority. */
export type TrustedCoordinatorAuthority = Readonly<{
  effectivePolicy: EffectiveTenantCostPolicy;
  authorityCheckedAt: number;
}>;
export type CreateBudgetCoordinatorStateInput = Readonly<{
  coordinatorId: string;
  maxReservations: number;
  authority: TrustedCoordinatorAuthority;
}>;
export type ReserveBudgetGrantInput = Readonly<{
  holderId: string;
  idempotencyKey: string;
  expectedPolicyId: string;
  expectedPolicyRevision: number;
  expectedRestrictionRevision: number;
  purpose: BudgetPurpose;
  envelope: ResourceAmounts;
  now: number;
}>;
export type ReserveBudgetGrantResult = Readonly<{
  state: BudgetCoordinatorState;
  outcome: Readonly<{
    status: 'granted' | 'idempotent' | 'rejected';
    reason?: 'exhausted' | 'stale-policy' | 'capacity-exhausted' | 'capacity-defect' | 'delivery-exhausted';
    reservation?: CoordinatorGrant;
  }>;
}>;
export type ConsumeBudgetGrantInput = Readonly<{
  reservationId: string;
  holderId: string;
  expectedPolicyRevision: number;
  expectedRestrictionRevision: number;
  envelope: ResourceAmounts;
  now: number;
}>;
export type ReconcileBudgetGrantInput = Readonly<{
  reservationId: string;
  holderId: string;
  expectedPolicyId: string;
  expectedPolicyRevision: number;
  expectedRestrictionRevision: number;
  terminalEvidenceId: string;
  measured: ResourceAmounts;
  uncertain: ResourceAmounts;
  now: number;
  /** Supplied only after the existing 0040 closure journal has accepted the exact whole-grant set. */
  certifiedClosure?: Readonly<{ operationSetFingerprint: string; expiresAt: number }>;
}>;

function assertIdentity(value: unknown, description: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160) throw new BudgetCoordinatorStateError(`${description} must be a non-empty bounded identifier`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new BudgetCoordinatorStateError(`${description} must not contain control characters`);
}

function assertPositiveSafeInteger(value: unknown, description: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new BudgetCoordinatorStateError(`${description} must be a positive safe integer`);
}

function assertSafeInstant(value: unknown, description: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new BudgetCoordinatorStateError(`${description} must be a non-negative safe integer`);
}

function assertReservationLimit(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_RESERVATIONS) {
    throw new BudgetCoordinatorStateError(`maximum reservations must be a safe integer from 1 to ${MAX_RESERVATIONS}`);
  }
}

function isDimension(value: string): value is ResourceDimension {
  return (RESOURCE_DIMENSIONS as readonly string[]).includes(value);
}

function normalizedAmounts(value: unknown, description: string, allowEmpty: boolean): ResourceAmounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BudgetCoordinatorStateError(`${description} must be a resource-amount object`);
  const result: ResourceAmounts = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isDimension(key) || !Number.isSafeInteger(raw) || raw < 0) throw new BudgetCoordinatorStateError(`${description} has an invalid resource amount`);
    if (raw > 0) result[key] = raw;
  }
  if (!allowEmpty && Object.keys(result).length === 0) throw new BudgetCoordinatorStateError(`${description} must contain at least one positive resource amount`);
  return result;
}

function amountFor(amounts: ResourceAmounts, dimension: ResourceDimension): number {
  return amounts[dimension] ?? 0;
}

function sumAmounts(left: ResourceAmounts, right: ResourceAmounts): ResourceAmounts {
  const result: ResourceAmounts = { ...left };
  for (const [key, raw] of Object.entries(right)) {
    const dimension = key as ResourceDimension;
    const next = amountFor(result, dimension) + raw;
    if (!Number.isSafeInteger(next)) throw new BudgetCoordinatorStateError('resource amount overflow');
    if (next > 0) result[dimension] = next;
  }
  return result;
}

function subtractAmounts(total: ResourceAmounts, spent: ResourceAmounts): ResourceAmounts | null {
  const result: ResourceAmounts = { ...total };
  for (const [key, raw] of Object.entries(spent)) {
    const dimension = key as ResourceDimension;
    const remaining = amountFor(result, dimension) - raw;
    if (remaining < 0) return null;
    if (remaining === 0) delete result[dimension]; else result[dimension] = remaining;
  }
  return result;
}

function overrunAmounts(envelope: ResourceAmounts, observed: ResourceAmounts): ResourceAmounts {
  const result: ResourceAmounts = {};
  for (const [key, units] of Object.entries(observed)) {
    const dimension = key as ResourceDimension;
    const overrun = units - amountFor(envelope, dimension);
    if (overrun > 0) result[dimension] = overrun;
  }
  return result;
}

function allocationKey(allocation: Pick<CoordinatorAllocation, 'dimension' | 'allocationId' | 'window'>): string {
  return allocationReferenceKey(allocation.dimension, allocation.allocationId, allocation.window.id);
}

function allocationReferenceKey(dimension: ResourceDimension, allocationId: string, windowId: string): string {
  return `${dimension}\u0000${allocationId}\u0000${windowId}`;
}

function idempotencyScope(state: BudgetCoordinatorState, holderId: string, purpose: BudgetPurpose, idempotencyKey: string): string {
  return `${state.tenantId}\u0000${holderId}\u0000${state.policyId}\u0000${purpose}\u0000${idempotencyKey}`;
}

function fingerprint(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${fingerprint((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new BudgetCoordinatorStateError('terminal evidence must be serializable');
}

function partition(limit: number, recoveryPercent: number): Readonly<{ newWorkLimit: number; recoveryLimit: number }> {
  assertSafeInstant(limit, 'budget limit');
  if (!Number.isInteger(recoveryPercent) || recoveryPercent < 0 || recoveryPercent > 100) throw new BudgetCoordinatorStateError('recovery percent must be an integer from 0 to 100');
  const newWorkLimit = Number(BigInt(limit) * BigInt(100 - recoveryPercent) / 100n);
  return { newWorkLimit, recoveryLimit: limit - newWorkLimit };
}

function copyWindow(window: ResourceWindow): ResourceWindow {
  assertIdentity(window.id, 'budget window id');
  if (window.kind === 'stock') return { kind: 'stock', id: window.id };
  assertSafeInstant(window.startsAt, 'budget window start');
  assertSafeInstant(window.endsAt, 'budget window end');
  if (window.startsAt >= window.endsAt) throw new BudgetCoordinatorStateError('budget interval window must be positive');
  return { kind: 'interval', id: window.id, startsAt: window.startsAt, endsAt: window.endsAt };
}

function allocationsFromAuthority(authority: TrustedCoordinatorAuthority): readonly CoordinatorAllocation[] {
  const policy = authority.effectivePolicy;
  assertIdentity(policy.tenantId, 'trusted policy tenant id');
  assertIdentity(policy.policyId, 'trusted policy id');
  assertPositiveSafeInteger(policy.revision, 'trusted policy revision');
  assertPositiveSafeInteger(policy.restrictionRevision, 'trusted restriction revision');
  assertPositiveSafeInteger(policy.maxGrantLifetimeMs, 'trusted maximum grant lifetime');
  if (!Array.isArray(policy.budgets) || policy.budgets.length === 0 || policy.budgets.length > RESOURCE_DIMENSIONS.length) throw new BudgetCoordinatorStateError('trusted policy must include bounded budgets');
  const dimensions = new Set<ResourceDimension>();
  return policy.budgets.map(budget => {
    if (!isDimension(budget.dimension) || dimensions.has(budget.dimension)) throw new BudgetCoordinatorStateError('trusted policy budgets must have unique dimensions');
    dimensions.add(budget.dimension);
    assertIdentity(budget.allocationId, 'trusted allocation id');
    assertSafeInstant(budget.limit, 'trusted budget limit');
    const window = copyWindow(budget.window);
    const split = partition(budget.limit, budget.recoveryPercent);
    return { dimension: budget.dimension, allocationId: budget.allocationId, window, limit: budget.limit, ...split };
  });
}

function cloneState(state: BudgetCoordinatorState, patch: Partial<BudgetCoordinatorState>): BudgetCoordinatorState {
  return {
    ...state,
    ...patch,
    allocations: patch.allocations ?? state.allocations,
    activeAllocationKeys: patch.activeAllocationKeys ?? state.activeAllocationKeys,
    grants: patch.grants ?? state.grants,
    closedCharges: patch.closedCharges ?? state.closedCharges ?? [],
    capacityDefects: patch.capacityDefects ?? state.capacityDefects,
  };
}

function closedChargeKey(allocation: CoordinatorAllocation, purpose: BudgetPurpose): string {
  // A stock allocation is lifetime capacity. A policy revision cannot turn an
  // allocation-id change into a fresh stock balance.
  return allocation.window.kind === 'stock'
    ? `${allocation.dimension}\u0000stock\u0000${purpose}`
    : `${allocation.dimension}\u0000${allocation.allocationId}\u0000${allocation.window.id}\u0000${purpose}`;
}

function allocationMatchesCharge(allocation: CoordinatorAllocation, charge: ClosedGrantCharge, purpose: BudgetPurpose): boolean {
  if (charge.purpose !== purpose || charge.dimension !== allocation.dimension) return false;
  if (allocation.window.kind === 'stock') return charge.window.kind === 'stock';
  return charge.window.kind === 'interval' && charge.allocationId === allocation.allocationId && charge.window.id === allocation.window.id;
}

function compactCharges(state: BudgetCoordinatorState, grant: CoordinatorGrant, now: number): BudgetCoordinatorState {
  const byKey = new Map((state.closedCharges ?? []).map(charge => [closedChargeKey({ dimension: charge.dimension,
    allocationId: charge.allocationId, window: charge.window, limit: 0, newWorkLimit: 0, recoveryLimit: 0 }, charge.purpose), charge]));
  for (const reference of grant.allocations) {
    const allocation = state.allocations.find(candidate => allocationReferenceKey(candidate.dimension, candidate.allocationId, candidate.window.id)
      === allocationReferenceKey(reference.dimension, reference.allocationId, reference.windowId));
    if (!allocation) throw new BudgetCoordinatorStateError('certified grant allocation is unavailable for compaction');
    const units = grant.accounted[reference.dimension] ?? 0;
    if (!units) continue;
    const key = closedChargeKey(allocation, grant.purpose);
    const prior = byKey.get(key);
    const next = (prior?.units ?? 0) + units;
    if (!Number.isSafeInteger(next)) throw new BudgetCoordinatorStateError('closed grant charge overflow');
    byKey.set(key, { dimension: allocation.dimension, allocationId: allocation.allocationId, window: allocation.window,
      purpose: grant.purpose, units: next });
  }
  return pruneHistoricalAccounting(cloneState(state, {
    grants: state.grants.filter(candidate => candidate.reservationId !== grant.reservationId),
    closedCharges: [...byKey.values()],
  }), now);
}

/** Retain only current interval accounting; stock stays charged for its lifetime. */
function pruneHistoricalAccounting(state: BudgetCoordinatorState, now: number): BudgetCoordinatorState {
  const charges = (state.closedCharges ?? []).filter(charge => charge.window.kind === 'stock' || now < charge.window.endsAt);
  const liveReferences = new Set(state.grants.flatMap(grant => grant.allocations.map(reference =>
    allocationReferenceKey(reference.dimension, reference.allocationId, reference.windowId))));
  const active = new Set(state.activeAllocationKeys);
  const allocations = state.allocations.filter(allocation => active.has(allocationKey(allocation))
    || liveReferences.has(allocationKey(allocation)) || (allocation.window.kind === 'interval' && now < allocation.window.endsAt));
  return cloneState(state, { closedCharges: charges, allocations });
}

function expire(state: BudgetCoordinatorState, now: number): BudgetCoordinatorState {
  assertSafeInstant(now, 'current time');
  let changed = false;
  const grants = state.grants.map(grant => {
    if (grant.status === 'reserved' && now >= grant.expiresAt) {
      changed = true;
      return { ...grant, status: 'uncertain' as const };
    }
    return grant;
  });
  return pruneHistoricalAccounting(changed ? cloneState(state, { grants }) : state, now);
}

function charged(state: BudgetCoordinatorState, key: string, purpose: BudgetPurpose): number {
  let total = 0;
  for (const grant of state.grants) {
    if (grant.purpose !== purpose) continue;
    const allocation = grant.allocations.find(item => allocationReferenceKey(item.dimension, item.allocationId, item.windowId) === key);
    if (!allocation) continue;
    total += amountFor(grant.accounted, allocation.dimension);
    if (!Number.isSafeInteger(total)) throw new BudgetCoordinatorStateError('durable budget charge overflow');
  }
  const allocation = state.allocations.find(candidate => allocationKey(candidate) === key);
  if (allocation) for (const charge of state.closedCharges ?? []) {
    if (!allocationMatchesCharge(allocation, charge, purpose)) continue;
    total += charge.units;
    if (!Number.isSafeInteger(total)) throw new BudgetCoordinatorStateError('durable closed charge overflow');
  }
  return total;
}

function currentAllocation(state: BudgetCoordinatorState, dimension: ResourceDimension): CoordinatorAllocation | undefined {
  const active = new Set(state.activeAllocationKeys);
  return state.allocations.find(allocation => allocation.dimension === dimension && active.has(allocationKey(allocation)));
}

/** Creates state only from a current server-derived effective tenant policy. */
export function createBudgetCoordinatorState(input: CreateBudgetCoordinatorStateInput): BudgetCoordinatorState {
  assertIdentity(input.coordinatorId, 'coordinator id');
  assertReservationLimit(input.maxReservations);
  assertSafeInstant(input.authority.authorityCheckedAt, 'authority check time');
  const allocations = allocationsFromAuthority(input.authority);
  return {
    schemaVersion: STATE_VERSION,
    coordinatorId: input.coordinatorId,
    maxReservations: input.maxReservations,
    tenantId: input.authority.effectivePolicy.tenantId,
    policyId: input.authority.effectivePolicy.policyId,
    policyRevision: input.authority.effectivePolicy.revision,
    restrictionRevision: input.authority.effectivePolicy.restrictionRevision,
    maxGrantLifetimeMs: input.authority.effectivePolicy.maxGrantLifetimeMs,
    authorityCheckedAt: input.authority.authorityCheckedAt,
    nextReservationSequence: 1,
    allocations,
    activeAllocationKeys: allocations.map(allocationKey),
    grants: [],
    closedCharges: [],
    capacityDefects: [],
  };
}

/** Marks expired credits uncertain; expiry is never evidence that they were unused. */
export function expireBudgetGrants(state: BudgetCoordinatorState, now: number): BudgetCoordinatorState {
  return expire(state, now);
}

/**
 * Atomically models a conservative, all-or-nothing allocation block. Revision
 * equality only fences this serialized snapshot; it never proves authority is
 * fresh, current, or unrevised outside the caller's verified authority flow.
 */
export function reserveBudgetGrant(state: BudgetCoordinatorState, input: ReserveBudgetGrantInput): ReserveBudgetGrantResult {
  assertIdentity(input.holderId, 'holder id');
  assertIdentity(input.idempotencyKey, 'idempotency key');
  assertIdentity(input.expectedPolicyId, 'expected policy id');
  assertPositiveSafeInteger(input.expectedPolicyRevision, 'expected policy revision');
  assertPositiveSafeInteger(input.expectedRestrictionRevision, 'expected restriction revision');
  assertSafeInstant(input.now, 'current time');
  const envelope = normalizedAmounts(input.envelope, 'reservation envelope', false);
  const expired = expire(state, input.now);
  if (input.expectedPolicyId !== expired.policyId || input.expectedPolicyRevision !== expired.policyRevision || input.expectedRestrictionRevision !== expired.restrictionRevision) {
    return { state: expired, outcome: { status: 'rejected', reason: 'stale-policy' } };
  }
  const scope = idempotencyScope(expired, input.holderId, input.purpose, input.idempotencyKey);
  const prior = expired.grants.find(grant => idempotencyScope(expired, grant.holderId, grant.purpose, grant.idempotencyKey) === scope);
  if (prior) {
    if (fingerprint(prior.envelope) !== fingerprint(envelope)) throw new BudgetCoordinatorStateError('idempotency key was already used with a different envelope');
    // A state written by an older implementation has no bounded delivery
    // record. Treat it as exhausted instead of reopening an unbounded retry.
    const deliveryAttempts = Number.isSafeInteger(prior.holderSeedAttempts) && prior.holderSeedAttempts >= 1
      ? prior.holderSeedAttempts : MAX_HOLDER_SEED_ATTEMPTS;
    if (deliveryAttempts >= MAX_HOLDER_SEED_ATTEMPTS) {
      // The charged grant remains held. A caller that never received a holder
      // acknowledgement must be reconciled rather than retrying forever.
      return { state: expired, outcome: { status: 'rejected', reason: 'delivery-exhausted' } };
    }
    const grants = [...expired.grants];
    const recovered = { ...prior, holderSeedAttempts: deliveryAttempts + 1 };
    grants[grants.indexOf(prior)] = recovered;
    return { state: cloneState(expired, { grants }), outcome: { status: 'idempotent', reservation: recovered } };
  }
  if (expired.capacityDefects.length > 0) return { state: expired, outcome: { status: 'rejected', reason: 'capacity-defect' } };
  if (expired.grants.length >= expired.maxReservations) return { state: expired, outcome: { status: 'rejected', reason: 'capacity-exhausted' } };
  const allocations: CoordinatorAllocation[] = [];
  for (const [key, units] of Object.entries(envelope)) {
    const dimension = key as ResourceDimension;
    const allocation = currentAllocation(expired, dimension);
    if (!allocation || units > (input.purpose === 'new-work' ? allocation.newWorkLimit : allocation.recoveryLimit)) {
      return { state: expired, outcome: { status: 'rejected', reason: 'exhausted' } };
    }
    const limit = input.purpose === 'new-work' ? allocation.newWorkLimit : allocation.recoveryLimit;
    if (charged(expired, allocationKey(allocation), input.purpose) + units > limit) return { state: expired, outcome: { status: 'rejected', reason: 'exhausted' } };
    allocations.push(allocation);
  }
  let expiresAt = input.now + expired.maxGrantLifetimeMs;
  if (!Number.isSafeInteger(expiresAt)) {
    return { state: expired, outcome: { status: 'rejected', reason: 'exhausted' } };
  }
  for (const allocation of allocations) {
    if (allocation.window.kind !== 'interval') continue;
    if (input.now < allocation.window.startsAt || input.now >= allocation.window.endsAt) return { state: expired, outcome: { status: 'rejected', reason: 'exhausted' } };
    expiresAt = Math.min(expiresAt, allocation.window.endsAt);
  }
  if (expiresAt <= input.now) return { state: expired, outcome: { status: 'rejected', reason: 'exhausted' } };
  const reservationId = `${expired.coordinatorId}:${expired.nextReservationSequence}`;
  const grant: CoordinatorGrant = {
    reservationId, holderId: input.holderId, idempotencyKey: input.idempotencyKey, purpose: input.purpose,
    policyRevision: expired.policyRevision, restrictionRevision: expired.restrictionRevision,
    createdAt: input.now, expiresAt, status: 'reserved', holderSeedAttempts: 1, envelope, remaining: { ...envelope }, accounted: { ...envelope },
    allocations: allocations.map(allocation => ({ dimension: allocation.dimension, allocationId: allocation.allocationId, windowId: allocation.window.id })),
  };
  const next = cloneState(expired, { grants: [...expired.grants, grant], nextReservationSequence: expired.nextReservationSequence + 1 });
  return { state: next, outcome: { status: 'granted', reservation: grant } };
}

/** Models the holder's durable decrement before a warm-path operation executes. */
export function consumeBudgetGrant(state: BudgetCoordinatorState, input: ConsumeBudgetGrantInput): Readonly<{ state: BudgetCoordinatorState; consumed: boolean }> {
  assertIdentity(input.reservationId, 'reservation id'); assertIdentity(input.holderId, 'holder id');
  assertPositiveSafeInteger(input.expectedPolicyRevision, 'expected policy revision');
  assertPositiveSafeInteger(input.expectedRestrictionRevision, 'expected restriction revision');
  assertSafeInstant(input.now, 'current time');
  const envelope = normalizedAmounts(input.envelope, 'spend envelope', false);
  const expired = expire(state, input.now);
  const index = expired.grants.findIndex(grant => grant.reservationId === input.reservationId);
  if (index < 0) return { state: expired, consumed: false };
  const grant = expired.grants[index];
  if (grant.holderId !== input.holderId || grant.status !== 'reserved' || grant.policyRevision !== expired.policyRevision
    || grant.restrictionRevision !== expired.restrictionRevision || input.expectedPolicyRevision !== expired.policyRevision
    || input.expectedRestrictionRevision !== expired.restrictionRevision) return { state: expired, consumed: false };
  const remaining = subtractAmounts(grant.remaining, envelope);
  if (!remaining) return { state: expired, consumed: false };
  const grants = [...expired.grants];
  grants[index] = { ...grant, remaining, status: Object.keys(remaining).length === 0 ? 'consumed' : 'reserved' };
  return { state: cloneState(expired, { grants }), consumed: true };
}

/** Lost-holder handling is conservative: it keeps every charged credit unavailable. */
export function markBudgetGrantUncertain(state: BudgetCoordinatorState, reservationId: string, holderId: string, now: number): Readonly<{ state: BudgetCoordinatorState; marked: boolean }> {
  assertIdentity(reservationId, 'reservation id'); assertIdentity(holderId, 'holder id'); assertSafeInstant(now, 'current time');
  const expired = expire(state, now);
  const index = expired.grants.findIndex(grant => grant.reservationId === reservationId);
  if (index < 0 || expired.grants[index].holderId !== holderId || expired.grants[index].status === 'reconciled') return { state: expired, marked: false };
  if (expired.grants[index].status === 'uncertain') return { state: expired, marked: true };
  const grants = [...expired.grants]; grants[index] = { ...grants[index], status: 'uncertain' };
  return { state: cloneState(expired, { grants }), marked: true };
}

/** Applies trusted terminal evidence; only its unaccounted remainder becomes reusable. */
export function reconcileBudgetGrant(state: BudgetCoordinatorState, input: ReconcileBudgetGrantInput): Readonly<{ state: BudgetCoordinatorState; outcome: 'reconciled' | 'already-reconciled' | 'capacity-defect' | 'rejected' }> {
  assertIdentity(input.reservationId, 'reservation id'); assertIdentity(input.holderId, 'holder id'); assertIdentity(input.expectedPolicyId, 'expected policy id');
  assertPositiveSafeInteger(input.expectedPolicyRevision, 'expected policy revision'); assertPositiveSafeInteger(input.expectedRestrictionRevision, 'expected restriction revision');
  assertIdentity(input.terminalEvidenceId, 'terminal evidence id'); assertSafeInstant(input.now, 'current time');
  const measured = normalizedAmounts(input.measured, 'measured reconciliation amounts', true);
  const uncertain = normalizedAmounts(input.uncertain, 'uncertain reconciliation amounts', true);
  const expired = expire(state, input.now);
  const certified = input.certifiedClosure;
  if (certified && (typeof certified.operationSetFingerprint !== 'string' || certified.operationSetFingerprint.length === 0
    || certified.operationSetFingerprint.length > 160 || /[\u0000-\u001f\u007f]/.test(certified.operationSetFingerprint)
    || !Number.isSafeInteger(certified.expiresAt) || certified.expiresAt <= input.now)) {
    return { state: expired, outcome: 'rejected' };
  }
  const index = expired.grants.findIndex(grant => grant.reservationId === input.reservationId);
  // The existing 0040 repository admits this path only after it has read the
  // exact durable closure row. A compacted grant has no detail left in the DO;
  // returning already-reconciled makes a lost DO response safe across restart.
  if (index < 0) return { state: expired, outcome: certified ? 'already-reconciled' : 'rejected' };
  const grant = expired.grants[index];
  if (grant.holderId !== input.holderId || input.expectedPolicyId !== expired.policyId || input.expectedPolicyRevision !== grant.policyRevision
    || input.expectedRestrictionRevision !== grant.restrictionRevision || (certified && certified.expiresAt !== grant.expiresAt)) return { state: expired, outcome: 'rejected' };
  const evidenceFingerprint = fingerprint({ terminalEvidenceId: input.terminalEvidenceId, measured, uncertain });
  if (grant.status === 'reconciled') {
    return { state: expired, outcome: grant.reconciliation?.fingerprint === evidenceFingerprint ? 'already-reconciled' : 'rejected' };
  }
  const accounted = sumAmounts(measured, uncertain);
  const overrun = overrunAmounts(grant.envelope, accounted);
  const grants = [...expired.grants];
  grants[index] = { ...grant, status: 'reconciled', accounted, reconciliation: { terminalEvidenceId: input.terminalEvidenceId, fingerprint: evidenceFingerprint, measured, uncertain, reconciledAt: input.now } };
  if (Object.keys(overrun).length > 0) {
    const capacityDefect: CoordinatorCapacityDefect = { reservationId: grant.reservationId, observedAt: input.now, envelope: grant.envelope, measured, uncertain, overrun };
    return { state: cloneState(expired, { grants, capacityDefects: [...expired.capacityDefects, capacityDefect] }), outcome: 'capacity-defect' };
  }
  const reconciled = cloneState(expired, { grants });
  return { state: certified ? compactCharges(reconciled, grants[index], input.now) : reconciled, outcome: 'reconciled' };
}

/**
 * Revisions arrive only from verified server authority. Existing credits are
 * made uncertain and remain charged; the new policy may issue only new grants.
 */
export function applyTrustedCoordinatorAuthority(state: BudgetCoordinatorState, authority: TrustedCoordinatorAuthority): BudgetCoordinatorState {
  assertSafeInstant(authority.authorityCheckedAt, 'authority check time');
  const current = expire(state, authority.authorityCheckedAt);
  const policy = authority.effectivePolicy;
  const nextAllocations = allocationsFromAuthority(authority);
  if (policy.tenantId !== current.tenantId || policy.policyId !== current.policyId) throw new BudgetCoordinatorStateError('trusted authority cannot change coordinator tenant or policy identity');
  if (policy.revision < current.policyRevision || policy.restrictionRevision < current.restrictionRevision
    || (policy.revision === current.policyRevision && policy.restrictionRevision === current.restrictionRevision)) {
    throw new BudgetCoordinatorStateError('trusted authority must advance a policy or restriction revision');
  }
  const byKey = new Map(current.allocations.map(allocation => [allocationKey(allocation), allocation]));
  for (const allocation of nextAllocations) byKey.set(allocationKey(allocation), allocation);
  const grants = current.grants.map(grant => grant.status === 'reserved' || grant.status === 'consumed'
    ? { ...grant, status: 'uncertain' as const } : grant);
  return cloneState(current, {
    policyRevision: policy.revision,
    restrictionRevision: policy.restrictionRevision,
    maxGrantLifetimeMs: policy.maxGrantLifetimeMs,
    authorityCheckedAt: authority.authorityCheckedAt,
    allocations: [...byKey.values()],
    activeAllocationKeys: nextAllocations.map(allocationKey),
    grants,
  });
}
