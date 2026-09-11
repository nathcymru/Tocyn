import { DurableObject } from 'cloudflare:workers';
import { RESOURCE_DIMENSIONS, type ResourceAmounts } from '@luminatick/shared';
import type { CoordinatorGrant } from '../budgets/coordinator-state';
import type { Env } from '../bindings';

const STATE_KEY = 'budget-grant-holder-v1';
const MAX_RECEIPTS = 4_096;

type WarmSpendReceipt = Readonly<{ operationId: string; fingerprint: string; envelope: ResourceAmounts; spentAt: number }>;
type HolderState = Readonly<{
  grant: CoordinatorGrant;
  tenantId: string;
  authorityExpiresAt: number;
  receipts: readonly WarmSpendReceipt[];
}>;
export type SeedBudgetGrantInput = Readonly<{ grant: CoordinatorGrant; tenantId: string; authorityExpiresAt: number }>;
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
    if (!Number.isSafeInteger(input.authorityExpiresAt) || input.authorityExpiresAt < input.grant.createdAt || input.authorityExpiresAt > input.grant.expiresAt) throw new Error('authority expiry must be within the committed grant');
    const existing = await this.ctx.storage.get<HolderState>(STATE_KEY);
    if (existing) {
      if (existing.grant.reservationId !== input.grant.reservationId || existing.tenantId !== input.tenantId || JSON.stringify(existing.grant) !== JSON.stringify(input.grant)) throw new Error('holder cannot replace an immutable grant');
      return;
    }
    await this.ctx.storage.put(STATE_KEY, { grant: input.grant, tenantId: input.tenantId, authorityExpiresAt: input.authorityExpiresAt, receipts: [] });
  }

  async spendFromTrustedAuthority(input: SpendBudgetGrantInput): Promise<Readonly<{ status: 'spent' | 'idempotent' | 'rejected'; reason?: 'stale-policy' | 'exhausted' | 'replay-conflict' | 'capacity-exhausted' }>> {
    assertIdentity(input.tenantId, 'tenant id'); assertIdentity(input.reservationId, 'reservation id'); assertIdentity(input.operationId, 'operation id');
    const envelope = amounts(input.envelope);
    if (!envelope || !Number.isSafeInteger(input.now) || input.now < 0) return { status: 'rejected', reason: 'exhausted' };
    const state = await this.ctx.storage.get<HolderState>(STATE_KEY);
    if (!state || state.tenantId !== input.tenantId || state.grant.reservationId !== input.reservationId) return { status: 'rejected', reason: 'stale-policy' };
    if (input.now >= state.authorityExpiresAt || input.now >= state.grant.expiresAt || state.grant.status !== 'reserved') return { status: 'rejected', reason: 'stale-policy' };
    const digest = fingerprint(envelope);
    const prior = state.receipts.find(receipt => receipt.operationId === input.operationId);
    if (prior) return prior.fingerprint === digest ? { status: 'idempotent' } : { status: 'rejected', reason: 'replay-conflict' };
    if (state.receipts.length >= MAX_RECEIPTS) return { status: 'rejected', reason: 'capacity-exhausted' };
    const remaining = subtract(state.grant.remaining, envelope);
    if (!remaining) return { status: 'rejected', reason: 'exhausted' };
    await this.ctx.storage.put(STATE_KEY, {
      ...state,
      grant: { ...state.grant, remaining, status: Object.keys(remaining).length ? 'reserved' : 'consumed' },
      receipts: [...state.receipts, { operationId: input.operationId, fingerprint: digest, envelope, spentAt: input.now }],
    });
    return { status: 'spent' };
  }

  async inspectForTrustedRuntime(): Promise<HolderState | null> { return (await this.ctx.storage.get<HolderState>(STATE_KEY)) ?? null; }
}
