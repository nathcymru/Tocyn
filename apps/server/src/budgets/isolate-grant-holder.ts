import { RESOURCE_DIMENSIONS, type BudgetPurpose, type ResourceAmounts } from '@luminatick/shared';
import type { CoordinatorGrant } from './coordinator-state';

export const MAX_ISOLATE_GRANT_OPERATIONS = 256;
export const MAX_ISOLATE_OPERATION_ATTEMPTS = 2;
/** Estimated upper allowance for one bounded credential/authority lookup, not provider billing. */
export const ISOLATE_WARM_CONTROL_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1, d1RowsRead: 1_536,
});

export type IsolateGrantScope = Readonly<{
  tenantId: string;
  /** Server-derived credential identity/version/capability key; never a credential secret. */
  credentialKey: string;
  /** Server-derived operation/target authorization scope; never request authority. */
  workScopeKey: string;
  purpose: BudgetPurpose;
}>;

/** Construct afresh from the current credential gate and coherent D1 authority on EVERY attempt. */
export type CurrentIsolateGrantAuthority = IsolateGrantScope & Readonly<{
  aggregateId: string;
  policyId: string;
  policyRevision: number;
  restrictionRevision: number;
  authorityRevision: number;
  authorityCheckedAt: number;
  authorityExpiresAt: number;
  allocations: CoordinatorGrant['allocations'];
}>;

export type IsolateGrantSpend = Readonly<{
  holderId: string;
  reservationId: string;
  operationId: string;
  /** Bounded digest of the canonical work; equal costs do not establish equal operations. */
  operationFingerprint: string;
  envelope: ResourceAmounts;
}>;

export type IsolateGrantSpendResult = Readonly<{
  status: 'spent' | 'idempotent' | 'rejected';
  reason?: 'stale-policy' | 'invalid-request' | 'exhausted' | 'capacity-exhausted' | 'replay-conflict' | 'replay-exhausted';
}>;

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 160 && !/[\u0000-\u001F\u007F]/.test(value);
}
function instant(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function positive(value: number): boolean { return Number.isSafeInteger(value) && value >= 1; }
function amounts(value: ResourceAmounts): ResourceAmounts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: ResourceAmounts = {};
  for (const [dimension, units] of Object.entries(value)) {
    if (!(RESOURCE_DIMENSIONS as readonly string[]).includes(dimension) || !Number.isSafeInteger(units) || units < 0) return null;
    if (units > 0) result[dimension as keyof ResourceAmounts] = units;
  }
  return Object.keys(result).length ? result : null;
}
function canonicalAmounts(value: ResourceAmounts): string {
  return JSON.stringify(RESOURCE_DIMENSIONS.map(dimension => [dimension, value[dimension] ?? 0]));
}
function subtract(balance: ResourceAmounts, cost: ResourceAmounts): ResourceAmounts | null {
  const next = { ...balance };
  for (const dimension of RESOURCE_DIMENSIONS) {
    const units = (next[dimension] ?? 0) - (cost[dimension] ?? 0);
    if (units < 0) return null;
    if (units > 0) next[dimension] = units; else delete next[dimension];
  }
  return next;
}
function scopeMatches(left: IsolateGrantScope, right: IsolateGrantScope): boolean {
  return left.tenantId === right.tenantId && left.credentialKey === right.credentialKey
    && left.workScopeKey === right.workScopeKey && left.purpose === right.purpose;
}
function allocationKey(allocations: CoordinatorGrant['allocations']): string | null {
  if (!Array.isArray(allocations) || allocations.length < 1 || allocations.length > RESOURCE_DIMENSIONS.length) return null;
  const keys = new Map<string, string>();
  for (const allocation of allocations) {
    if (!(RESOURCE_DIMENSIONS as readonly string[]).includes(allocation.dimension)
      || !identity(allocation.allocationId) || !identity(allocation.windowId) || keys.has(allocation.dimension)) return null;
    keys.set(allocation.dimension, JSON.stringify([allocation.dimension, allocation.allocationId, allocation.windowId]));
  }
  return JSON.stringify([...keys.values()].sort());
}
function authorityKey(authority: CurrentIsolateGrantAuthority): string | null {
  const allocations = allocationKey(authority.allocations);
  if (!allocations || !identity(authority.aggregateId) || !identity(authority.policyId)
    || !positive(authority.policyRevision) || !positive(authority.restrictionRevision) || !positive(authority.authorityRevision)) return null;
  return JSON.stringify([authority.aggregateId, authority.policyId, authority.policyRevision,
    authority.restrictionRevision, authority.authorityRevision, allocations]);
}

/** Adds both finite control attempts before admitting the first business execution. */
export function isolateWarmReservedEnvelope(business: ResourceAmounts): ResourceAmounts | null {
  const total = amounts(business);
  if (!total) return null;
  for (const dimension of RESOURCE_DIMENSIONS) {
    const units = (total[dimension] ?? 0) + MAX_ISOLATE_OPERATION_ATTEMPTS * (ISOLATE_WARM_CONTROL_ENVELOPE[dimension] ?? 0);
    if (!Number.isSafeInteger(units)) return null;
    if (units > 0) total[dimension] = units;
  }
  return total;
}

/**
 * One prepaid grant, owned exclusively by this live instance. Create BEFORE the
 * cold allocation and use its fresh holderId in that durable request. A lost
 * allocation acknowledgement may retry only into this same instance. No caller
 * can select/reconstruct its identity, import local balances, reset it, or
 * reclaim unused units. A replacement instance must obtain a NEW charged grant.
 *
 * The service must select isolate ownership instead of also seeding a durable
 * holder, bound its holder cache and refill attempts, and never reconcile an
 * evicted/lost instance as unused. The coordinator's original full charge stays
 * held until separately proven terminal reconciliation. Expiry is not a refund.
 *
 * This class does not authenticate. Each attempt needs a fresh credential and
 * coherent authority read before calling spend; failed/revoked reads must call
 * invalidate. 'idempotent' permits only the prepaid second attempt behind an
 * atomic application receipt; it cannot establish that business work is absent.
 * Durable receipts remain required across isolate loss. No method performs I/O or awaits.
 */
export class IsolateBudgetGrantHolder {
  readonly holderId = `isolate:${crypto.randomUUID()}`;
  private readonly scope: IsolateGrantScope;
  private readonly maxOperations: number;
  private installed?: { grant: CoordinatorGrant; identity: string; epoch: string };
  private remaining: ResourceAmounts = {};
  private receipts = new Map<string, { fingerprint: string; attempts: number }>();
  private retired = false;
  private lastCheckedAt = 0;

  constructor(scope: IsolateGrantScope, maxOperations = MAX_ISOLATE_GRANT_OPERATIONS) {
    if (!identity(scope.tenantId) || !identity(scope.credentialKey) || !identity(scope.workScopeKey)
      || !['new-work', 'recovery'].includes(scope.purpose)) throw new Error('invalid isolate grant scope');
    if (!positive(maxOperations) || maxOperations > MAX_ISOLATE_GRANT_OPERATIONS) throw new Error('invalid isolate operation bound');
    this.scope = { ...scope };
    this.maxOperations = maxOperations;
  }

  invalidate(): void { this.retired = true; }

  private current(authority: CurrentIsolateGrantAuthority, now: number): boolean {
    return !this.retired && scopeMatches(this.scope, authority) && instant(now)
      && instant(authority.authorityCheckedAt) && authority.authorityCheckedAt <= now
      && authority.authorityCheckedAt >= this.lastCheckedAt && instant(authority.authorityExpiresAt)
      && authority.authorityCheckedAt < authority.authorityExpiresAt && now < authority.authorityExpiresAt;
  }

  /** Repeated same-grant delivery acknowledges installation without replenishing local balance. */
  install(grant: CoordinatorGrant, authority: CurrentIsolateGrantAuthority, now: number): boolean {
    const envelope = amounts(grant.envelope);
    const remaining = amounts(grant.remaining);
    const accounted = amounts(grant.accounted);
    const epoch = authorityKey(authority);
    if (this.installed && this.current(authority, now) && epoch !== this.installed.epoch) this.invalidate();
    if (!this.current(authority, now) || !epoch || !envelope || !remaining || !accounted || grant.holderId !== this.holderId
      || !identity(grant.reservationId) || !identity(grant.idempotencyKey) || grant.purpose !== this.scope.purpose
      || grant.status !== 'reserved' || grant.policyRevision !== authority.policyRevision
      || grant.restrictionRevision !== authority.restrictionRevision || !instant(grant.createdAt)
      || !instant(grant.expiresAt) || grant.createdAt > now || now >= grant.expiresAt
      || !positive(grant.holderSeedAttempts) || grant.holderSeedAttempts > 2
      || allocationKey(grant.allocations) !== allocationKey(authority.allocations)
      || Object.keys(envelope).some(dimension => !grant.allocations.some(allocation => allocation.dimension === dimension))
      || canonicalAmounts(remaining) !== canonicalAmounts(envelope)
      || canonicalAmounts(accounted) !== canonicalAmounts(envelope)) return false;
    const immutable = JSON.stringify([grant.reservationId, grant.idempotencyKey, grant.createdAt, grant.expiresAt, canonicalAmounts(envelope), epoch]);
    if (this.installed) {
      if (this.installed.identity !== immutable) return false;
      this.lastCheckedAt = authority.authorityCheckedAt;
      return true;
    }
    this.installed = { grant: structuredClone(grant), identity: immutable, epoch };
    this.remaining = { ...envelope };
    this.lastCheckedAt = authority.authorityCheckedAt;
    return true;
  }

  spend(input: IsolateGrantSpend, authority: CurrentIsolateGrantAuthority, now: number): IsolateGrantSpendResult {
    const stored = this.installed;
    if (!stored || !this.current(authority, now) || input.holderId !== this.holderId
      || input.reservationId !== stored.grant.reservationId) return { status: 'rejected', reason: 'stale-policy' };
    if (authorityKey(authority) !== stored.epoch || now >= stored.grant.expiresAt) {
      this.invalidate();
      return { status: 'rejected', reason: 'stale-policy' };
    }
    this.lastCheckedAt = authority.authorityCheckedAt;
    const envelope = isolateWarmReservedEnvelope(input.envelope);
    if (!identity(input.operationId) || !identity(input.operationFingerprint) || !envelope) return { status: 'rejected', reason: 'invalid-request' };
    const fingerprint = JSON.stringify([input.operationFingerprint, canonicalAmounts(envelope)]);
    const prior = this.receipts.get(input.operationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return { status: 'rejected', reason: 'replay-conflict' };
      if (prior.attempts >= MAX_ISOLATE_OPERATION_ATTEMPTS) return { status: 'rejected', reason: 'replay-exhausted' };
      prior.attempts += 1;
      return { status: 'idempotent' };
    }
    if (this.receipts.size >= this.maxOperations) return { status: 'rejected', reason: 'capacity-exhausted' };
    const next = subtract(this.remaining, envelope);
    if (!next) return { status: 'rejected', reason: 'exhausted' };
    // Synchronous decrement AND receipt precede any caller's asynchronous work.
    this.remaining = next;
    this.receipts.set(input.operationId, { fingerprint, attempts: 1 });
    return { status: 'spent' };
  }

  /** Diagnostic copy only; it is neither durable terminal evidence nor a refund instruction. */
  inspect(): Readonly<{ holderId: string; reservationId?: string; remaining: ResourceAmounts; operationCount: number; retired: boolean }> {
    return { holderId: this.holderId, reservationId: this.installed?.grant.reservationId,
      remaining: { ...this.remaining }, operationCount: this.receipts.size, retired: this.retired };
  }
}
