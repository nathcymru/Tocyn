import { DurableObject } from 'cloudflare:workers';
import { RESOURCE_DIMENSIONS, type ResourceAmounts } from '@luminatick/shared';
import type { CoordinatorGrant } from '../budgets/coordinator-state';
import type { Env } from '../bindings';

const STATE_KEY = 'budget-grant-holder-v1';
const MAX_RECEIPTS = 4_096;
const MAX_OPERATION_DELIVERY_ATTEMPTS = 2;

type WarmSpendReceipt = Readonly<{ operationId: string; fingerprint: string; envelope: ResourceAmounts; spentAt: number; deliveryAttempts: number }>;
type HolderState = Readonly<{
  grant: CoordinatorGrant;
  tenantId: string;
  authorityRevision: number;
  authorityExpiresAt: number;
  receipts: readonly WarmSpendReceipt[];
}>;
export type SeedBudgetGrantInput = Readonly<{ grant: CoordinatorGrant; tenantId: string; authorityRevision: number; authorityExpiresAt: number }>;
export type RefreshBudgetGrantAuthorityInput = Readonly<{ tenantId: string; policyRevision: number; restrictionRevision: number; authorityRevision: number; authorityExpiresAt: number; now: number }>;
export type SpendBudgetGrantInput = Readonly<{ tenantId: string; reservationId: string; operationId: string; envelope: ResourceAmounts; now: number }>;

function assertIdentity(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || /[\u0000-\u001F\u007F]/.test(value)) throw new Error(`${name} must be a bounded identifier`);
}
function amounts(value: unknown): ResourceAmounts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: ResourceAmounts = {};
  for (const [dimension, units] of Object.entries(value)) {
    if (!(RESOURCE_DIMENSIONS as readonly string[]).includes(dimension) || !Number.isSafeInteger(units) || units < 0) return null;
    if (units > 0) result[dimension as keyof ResourceAmounts] = units;
  }
  return Object.keys(result).length ? result : null;
}
function fingerprint(value: unknown): string { return JSON.stringify(value, Object.keys(value as object).sort()); }
/** Delivery counters and local decrements are not immutable grant identity.
 * Compare the original committed fields without resetting a holder's balance
 * or receipts when acknowledgement of its first seed was lost.
 */
function immutableGrantIdentity(grant: CoordinatorGrant): string {
  return JSON.stringify({ reservationId: grant.reservationId, holderId: grant.holderId,
    idempotencyKey: grant.idempotencyKey, purpose: grant.purpose,
    policyRevision: grant.policyRevision, restrictionRevision: grant.restrictionRevision,
    createdAt: grant.createdAt, expiresAt: grant.expiresAt,
    envelope: fingerprint(grant.envelope), allocations: grant.allocations,
  });
}
function subtract(remaining: ResourceAmounts, envelope: ResourceAmounts): ResourceAmounts | null {
  const next = { ...remaining };
  for (const [dimension, units] of Object.entries(envelope)) {
    const value = (next[dimension as keyof ResourceAmounts] ?? 0) - units;
    if (value < 0) return null;
    if (value === 0) delete next[dimension as keyof ResourceAmounts]; else next[dimension as keyof ResourceAmounts] = value;
  }
  return next;
}

/**
 * Durable warm-path grant holder. It has no fetch handler. A server-derived
 * holder object receives a committed coordinator grant once, then persists an
 * operation receipt and decrement before it reports a spend. It never calls
 * the central coordinator for a warm spend.
 */
export class BudgetGrantHolderDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env); }

  async seedFromTrustedAuthority(input: SeedBudgetGrantInput): Promise<void> {
    assertIdentity(input.tenantId, 'tenant id');
    if (!Number.isSafeInteger(input.authorityRevision) || input.authorityRevision < 1) throw new Error('authority revision must be a positive safe integer');
    if (!Number.isSafeInteger(input.authorityExpiresAt) || input.authorityExpiresAt < input.grant.createdAt || input.authorityExpiresAt > input.grant.expiresAt) throw new Error('authority expiry must be within the committed grant');
    if (input.grant.status !== 'reserved') throw new Error('holder requires an active reserved grant');
    const existing = await this.ctx.storage.get<HolderState>(STATE_KEY);
    if (existing) {
      if (existing.grant.reservationId !== input.grant.reservationId || existing.tenantId !== input.tenantId || existing.authorityRevision > input.authorityRevision || immutableGrantIdentity(existing.grant) !== immutableGrantIdentity(input.grant)) throw new Error('holder cannot replace an immutable grant');
      if (existing.authorityRevision !== input.authorityRevision || existing.authorityExpiresAt !== input.authorityExpiresAt) {
        await this.ctx.storage.put(STATE_KEY, { ...existing, authorityRevision: input.authorityRevision, authorityExpiresAt: input.authorityExpiresAt });
      }
      return;
    }
    await this.ctx.storage.put(STATE_KEY, { grant: input.grant, tenantId: input.tenantId, authorityRevision: input.authorityRevision, authorityExpiresAt: input.authorityExpiresAt, receipts: [] });
  }

  /** Refuses an old policy/restriction before a holder can spend its local balance. */
  async refreshFromTrustedAuthority(input: RefreshBudgetGrantAuthorityInput): Promise<boolean> {
    assertIdentity(input.tenantId, 'tenant id');
    if (!Number.isSafeInteger(input.policyRevision) || input.policyRevision < 1 || !Number.isSafeInteger(input.restrictionRevision) || input.restrictionRevision < 1
      || !Number.isSafeInteger(input.authorityRevision) || input.authorityRevision < 1 || !Number.isSafeInteger(input.authorityExpiresAt)
      || !Number.isSafeInteger(input.now) || input.now < 0) return false;
    const state = await this.ctx.storage.get<HolderState>(STATE_KEY);
    if (!state || state.tenantId !== input.tenantId || state.grant.policyRevision !== input.policyRevision
      || state.grant.restrictionRevision !== input.restrictionRevision || input.authorityRevision < state.authorityRevision) return false;
    // A fresh authority lease may outlive this grant; the grant's original
    // policy/window expiry remains the hard local limit.
    const expiresAt = Math.min(input.authorityExpiresAt, state.grant.expiresAt);
    if (expiresAt <= input.now) return false;
    if (state.authorityRevision === input.authorityRevision && state.authorityExpiresAt === expiresAt) return true;
    await this.ctx.storage.put(STATE_KEY, { ...state, authorityRevision: input.authorityRevision, authorityExpiresAt: expiresAt });
    return true;
  }

  async spendFromTrustedAuthority(input: SpendBudgetGrantInput): Promise<Readonly<{ status: 'spent' | 'idempotent' | 'rejected'; reason?: 'stale-policy' | 'exhausted' | 'replay-conflict' | 'capacity-exhausted' | 'replay-exhausted' }>> {
    assertIdentity(input.tenantId, 'tenant id'); assertIdentity(input.reservationId, 'reservation id'); assertIdentity(input.operationId, 'operation id');
    const envelope = amounts(input.envelope);
    if (!envelope || !Number.isSafeInteger(input.now) || input.now < 0) return { status: 'rejected', reason: 'exhausted' };
    const state = await this.ctx.storage.get<HolderState>(STATE_KEY);
    if (!state || state.tenantId !== input.tenantId || state.grant.reservationId !== input.reservationId) return { status: 'rejected', reason: 'stale-policy' };
    if (input.now >= state.authorityExpiresAt || input.now >= state.grant.expiresAt) return { status: 'rejected', reason: 'stale-policy' };
    const digest = fingerprint(envelope);
    const prior = state.receipts.find(receipt => receipt.operationId === input.operationId);
    if (prior) {
      if (prior.fingerprint !== digest) return { status: 'rejected', reason: 'replay-conflict' };
      // The service pre-reserves the first delivery plus this one recovery.
      // Retaining the counter durably avoids unlimited replay acknowledgements
      // after a caller loses every response.
      const deliveryAttempts = Number.isSafeInteger(prior.deliveryAttempts) && prior.deliveryAttempts >= 1
        ? prior.deliveryAttempts : MAX_OPERATION_DELIVERY_ATTEMPTS;
      if (deliveryAttempts >= MAX_OPERATION_DELIVERY_ATTEMPTS) return { status: 'rejected', reason: 'replay-exhausted' };
      const receipts = state.receipts.map(receipt => receipt.operationId === input.operationId
        ? { ...receipt, deliveryAttempts: deliveryAttempts + 1 } : receipt);
      await this.ctx.storage.put(STATE_KEY, { ...state, receipts });
      return { status: 'idempotent' };
    }
    if (state.grant.status !== 'reserved') return { status: 'rejected', reason: 'stale-policy' };
    if (state.receipts.length >= MAX_RECEIPTS) return { status: 'rejected', reason: 'capacity-exhausted' };
    const remaining = subtract(state.grant.remaining, envelope);
    if (!remaining) return { status: 'rejected', reason: 'exhausted' };
    await this.ctx.storage.put(STATE_KEY, {
      ...state,
      grant: { ...state.grant, remaining, status: Object.keys(remaining).length ? 'reserved' : 'consumed' },
      receipts: [...state.receipts, { operationId: input.operationId, fingerprint: digest, envelope, spentAt: input.now, deliveryAttempts: 1 }],
    });
    return { status: 'spent' };
  }

  async inspectForTrustedRuntime(): Promise<HolderState | null> { return (await this.ctx.storage.get<HolderState>(STATE_KEY)) ?? null; }
}
