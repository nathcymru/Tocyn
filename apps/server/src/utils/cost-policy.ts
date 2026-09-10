import { z } from 'zod';
import { RESOURCE_DIMENSIONS, STOCK_DIMENSIONS, type BudgetReservation, type CostPolicy, type EffectiveTenantCostPolicy, type ResourceAmounts, type TenantBudgetRestriction } from '@luminatick/shared';

const units = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identity = z.string().min(1).max(160);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const dimension = z.enum(RESOURCE_DIMENSIONS);
const window = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), id: identity, startsAt: units, endsAt: units }).strict(),
  z.object({ kind: z.literal('stock'), id: identity }).strict(),
]).refine(value => value.kind === 'stock' || value.startsAt < value.endsAt, 'Window must have positive duration');
const amounts = z.record(dimension, units);

export const costPolicySchema = z.object({
  schemaVersion: z.literal(1), policyId: identity, revision, deploymentId: identity,
  mode: z.enum(['conservative', 'aggressive']).default('conservative'), catalogueVersion: identity,
  maxGrantLifetimeMs: revision,
  budgets: z.array(z.object({
    dimension, allocationId: identity, window, limit: units,
    recoveryPercent: z.number().int().min(0).max(100).default(20), provenance: z.literal('owner-allocation'),
  }).strict()).min(1).max(RESOURCE_DIMENSIONS.length),
}).strict().refine(policy => new Set(policy.budgets.map(b => b.dimension)).size === policy.budgets.length,
  'One allocation per dimension per policy; aggregate multi-policy ceilings at the durable owner authority')
  .refine(policy => policy.budgets.every(b => (b.window.kind === 'stock') === STOCK_DIMENSIONS.includes(b.dimension)),
    'Persistent resource stock cannot reset as an interval; metered operations require an interval');

export const tenantBudgetRestrictionSchema = z.object({
  schemaVersion: z.literal(1), tenantId: identity, ownerPolicyId: identity,
  ownerPolicyRevision: revision, revision, mode: z.enum(['conservative', 'aggressive']),
  limits: amounts, disabledFeatures: z.array(identity).max(128),
}).strict();

export const budgetReservationSchema = z.object({
  schemaVersion: z.literal(1), reservationId: identity, tenantId: identity,
  holderId: identity, policyId: identity, policyRevision: revision, restrictionRevision: revision,
  purpose: z.enum(['new-work', 'recovery']), createdAt: units, expiresAt: units,
  grants: z.array(z.object({ dimension, allocationId: identity, windowId: identity, units: revision }).strict())
    .min(1).max(RESOURCE_DIMENSIONS.length),
  state: z.enum(['reserved', 'consumed', 'reconciled', 'uncertain']),
}).strict().refine(value => value.createdAt < value.expiresAt, 'Grant lifetime must be positive')
  .refine(value => new Set(value.grants.map(g => g.dimension)).size === value.grants.length,
    'Grant dimensions must be unique');

/**
 * Structural/fencing validation for a grant already loaded from durable authority.
 * This cannot prove that credits exist or prevent replay; #64 must atomically spend
 * the unique holder's durable remaining balance before executing admitted work.
 */
export function validateSpendableReservation(input: unknown, policy: EffectiveTenantCostPolicy,
  verifiedHolderId: string, now: number): BudgetReservation {
  const grant = budgetReservationSchema.parse(input);
  units.parse(now);
  identity.parse(verifiedHolderId);
  if (grant.tenantId !== policy.tenantId || grant.holderId !== verifiedHolderId
      || grant.policyId !== policy.policyId || grant.policyRevision !== policy.revision
      || grant.restrictionRevision !== policy.restrictionRevision) throw new Error('Grant authority mismatch');
  if (grant.state !== 'reserved' || now < grant.createdAt || now >= grant.expiresAt
      || grant.expiresAt - grant.createdAt > policy.maxGrantLifetimeMs) throw new Error('Grant not spendable');
  for (const item of grant.grants) {
    const budget = policy.budgets.find(b => b.dimension === item.dimension);
    if (!budget || item.allocationId !== budget.allocationId || item.windowId !== budget.window.id)
      throw new Error('Grant allocation mismatch');
    if (budget.window.kind === 'interval' && (grant.createdAt < budget.window.startsAt
        || grant.expiresAt > budget.window.endsAt)) throw new Error('Grant crosses resource window');
    const split = partitionBudget(budget.limit, budget.recoveryPercent);
    if (item.units > (grant.purpose === 'new-work' ? split.newWork : split.recovery))
      throw new Error('Grant exceeds purpose ceiling');
  }
  return grant;
}

/** Exact integer split: rounding belongs to recovery, never to additional new work. */
export function partitionBudget(limit: number, recoveryPercent = 20): { newWork: number; recovery: number } {
  units.parse(limit);
  z.number().int().min(0).max(100).parse(recoveryPercent);
  const newWork = Number(BigInt(limit) * BigInt(100 - recoveryPercent) / 100n);
  return { newWork, recovery: limit - newWork };
}

/**
 * Call with an owner allocation loaded through verified server authority, not a request's
 * claimed owner policy. This validates restrictions; it does not authenticate a caller.
 */
export function effectiveTenantPolicy(
  ownerAllocation: unknown, restrictionInput: unknown, verifiedTenantId: string,
): EffectiveTenantCostPolicy {
  const owner = costPolicySchema.parse(ownerAllocation);
  const restriction = tenantBudgetRestrictionSchema.parse(restrictionInput);
  identity.parse(verifiedTenantId);
  if (restriction.tenantId !== verifiedTenantId || restriction.ownerPolicyId !== owner.policyId
      || restriction.ownerPolicyRevision !== owner.revision) throw new Error('Restriction authority or revision mismatch');
  if (owner.mode === 'aggressive' && restriction.mode !== 'aggressive') throw new Error('Tenant cannot relax owner mode');
  for (const [key, value] of Object.entries(restriction.limits)) {
    const budget = owner.budgets.find(b => b.dimension === key);
    if (!budget || value > budget.limit) throw new Error('Tenant cannot add or increase an owner allocation');
  }
  return { ...owner, tenantId: verifiedTenantId, restrictionRevision: restriction.revision,
    disabledFeatures: [...new Set(restriction.disabledFeatures)],
    mode: restriction.mode, budgets: owner.budgets.map(b => ({
    ...b, limit: restriction.limits[b.dimension] ?? b.limit,
  })) };
}

export function defaultTenantRestriction(ownerAllocation: unknown, verifiedTenantId: string): TenantBudgetRestriction {
  const owner = costPolicySchema.parse(ownerAllocation);
  return tenantBudgetRestrictionSchema.parse({ schemaVersion: 1, tenantId: verifiedTenantId,
    ownerPolicyId: owner.policyId, ownerPolicyRevision: owner.revision, revision: 1,
    mode: owner.mode, limits: {}, disabledFeatures: [] });
}

/** The envelope includes each retry and reconciliation operation before acknowledgment. */
export function sumResourceEnvelopes(...envelopes: ResourceAmounts[]): ResourceAmounts {
  if (envelopes.length > 128) throw new Error('Envelope count exceeds bounded planning input');
  const result: ResourceAmounts = {};
  for (const envelope of envelopes) {
    const parsed = amounts.parse(envelope);
    for (const [key, value] of Object.entries(parsed)) {
      const d = dimension.parse(key);
      const next = (result[d] ?? 0) + value;
      if (!Number.isSafeInteger(next)) throw new Error('Resource envelope overflow');
      result[d] = next;
    }
  }
  return result;
}

/** Monotonic shedding order; canonical audit, authentication and recovery are not optional. */
export function optionalAiFeatures(mode: CostPolicy['mode'], pressure: 'normal' | 'tight' | 'exhausted') {
  if (mode === 'aggressive' || pressure === 'exhausted') return { gratitude: false, enrichment: false };
  return { gratitude: pressure === 'normal', enrichment: true };
}
