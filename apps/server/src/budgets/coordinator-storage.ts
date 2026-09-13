import { RESOURCE_DIMENSIONS, type ResourceAmounts } from '@luminatick/shared';
import type { BudgetOwnerAggregateState } from './owner-aggregate';
import { MAX_RETAINED_BUDGET_GRANTS, MAX_TENANT_BUDGET_ALLOCATIONS } from './coordinator-state';
import type { CoordinatorGrant, CoordinatorAllocation } from './coordinator-state';

// Compact representation of the existing grant records, under the existing
// state key. Equal amount maps are stored once. No uncertain record is removed.
function packedGrant(grant: CoordinatorGrant, allocations?: readonly CoordinatorAllocation[]): unknown[] {
  const same = (value: unknown) => JSON.stringify(value) === JSON.stringify(grant.envelope);
  const completed = grant.compacted && grant.reconciliation?.certifiedFingerprint?.startsWith('sha256:');
  return [grant.reservationId, grant.holderId, grant.idempotencyKey, grant.purpose, grant.policyRevision,
    grant.restrictionRevision, grant.createdAt, grant.expiresAt, grant.status, grant.holderSeedAttempts,
    grant.envelope, same(grant.remaining) ? null : grant.remaining, same(grant.accounted) ? null : grant.accounted,
    completed ? [] : grant.allocations.map(reference => {
      const index = allocations?.findIndex(allocation => allocation.dimension === reference.dimension && allocation.allocationId === reference.allocationId && allocation.window.id === reference.windowId);
      return index !== undefined && index >= 0 ? index : [reference.dimension, reference.allocationId, reference.windowId];
    }), grant.compacted ?? false, grant.recoversReservationId ?? null,
    completed ? grant.reconciliation!.certifiedFingerprint : grant.reconciliation ?? null];
}
function unpackedGrant(value: unknown[], metadata: readonly CoordinatorAllocation[]): CoordinatorGrant {
  const [reservationId, holderId, idempotencyKey, purpose, policyRevision, restrictionRevision, createdAt, expiresAt,
    status, holderSeedAttempts, envelope, remaining, accounted, allocations, compacted, recoversReservationId, reconciliation] = value;
  return { reservationId, holderId, idempotencyKey, purpose, policyRevision, restrictionRevision, createdAt, expiresAt,
    status, holderSeedAttempts, envelope, remaining: remaining ?? envelope, accounted: accounted ?? envelope, allocations: (allocations as (number | string[])[]).map(reference => {
      if (typeof reference !== 'number') { const [dimension, allocationId, windowId] = reference; return { dimension, allocationId, windowId }; }
      const allocation = metadata[reference];
      if (!allocation) throw new Error('persisted budget grant allocation reference is unavailable');
      return { dimension: allocation.dimension, allocationId: allocation.allocationId, windowId: allocation.window.id };
    }), compacted,
    ...(recoversReservationId ? { recoversReservationId } : {}), ...(reconciliation ? { reconciliation: typeof reconciliation === 'string'
      ? { terminalEvidenceId: '', fingerprint: '', measured: {}, uncertain: {}, reconciledAt: 0, certifiedFingerprint: reconciliation }
      : reconciliation } : {}) } as CoordinatorGrant;
}
type TenantState = BudgetOwnerAggregateState['tenantStates'][number];
const invalid = (): never => { throw new Error('persisted budget coordinator dictionary is invalid'); };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function amount(value: unknown): ResourceAmounts {
  if (!record(value)) return invalid();
  const result: Record<string, number> = {};
  for (const key of Object.keys(value).sort()) {
    const units = value[key];
    if (!(RESOURCE_DIMENSIONS as readonly string[]).includes(key)
      || typeof units !== 'number' || !Number.isSafeInteger(units) || units < 0) return invalid();
    result[key] = units;
  }
  return result;
}
function index(value: unknown, length: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= length) return invalid();
  return value;
}
function packedTenant(tenant: TenantState): unknown {
  const amounts: ResourceAmounts[] = [], proofs: string[] = [];
  const amountIndices = new Map<string, number>(), proofIndices = new Map<string, number>();
  const grants = tenant.grants.map(grant => {
    const row = packedGrant(grant, tenant.allocations);
    // Format4 stores only an exact suffix; decoding restores the original key.
    if (grant.holderId.length > 0 && grant.idempotencyKey.startsWith(grant.holderId)) {
      row[2] = [grant.idempotencyKey.slice(grant.holderId.length)];
    }
    for (const field of [10, 11, 12]) {
      if (row[field] === null) continue;
      const value = amount(row[field]), key = JSON.stringify(value);
      let reference = amountIndices.get(key);
      if (reference === undefined) { reference = amounts.length; amounts.push(value); amountIndices.set(key, reference); }
      row[field] = reference;
    }
    if (typeof row[16] === 'string') {
      const proof = row[16];
      let reference = proofIndices.get(proof);
      if (reference === undefined) { reference = proofs.length; proofs.push(proof); proofIndices.set(proof, reference); }
      row[16] = reference;
    }
    return row;
  });
  return { ...tenant, grants, amounts, proofs };
}
function unpackedTenant(value: unknown, relativeKeys: boolean): TenantState {
  if (!record(value) || !Array.isArray(value.grants) || value.grants.length > MAX_RETAINED_BUDGET_GRANTS
    || !Array.isArray(value.allocations) || value.allocations.length > MAX_TENANT_BUDGET_ALLOCATIONS
    || !Array.isArray(value.amounts) || value.amounts.length > 3 * value.grants.length
    || !Array.isArray(value.proofs) || value.proofs.length > value.grants.length) return invalid();
  const { amounts: rawAmounts, proofs, grants: rows, ...tenant } = value;
  const amounts = rawAmounts.map(amount);
  if (proofs.some(proof => typeof proof !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(proof))) return invalid();
  const allocations = value.allocations as CoordinatorAllocation[];
  const grants = rows.map(row => {
    if (!Array.isArray(row) || row.length !== 17 || !Array.isArray(row[13]) || row[13].length > RESOURCE_DIMENSIONS.length) return invalid();
    const expanded = [...row];
    if (Array.isArray(row[2])) {
      if (!relativeKeys || row[2].length !== 1 || typeof row[2][0] !== 'string'
        || typeof row[1] !== 'string' || row[1].length === 0 || row[1].length + row[2][0].length > 160
        || /[\u0000-\u001f\u007f]/.test(row[1]) || /[\u0000-\u001f\u007f]/.test(row[2][0])) return invalid();
      expanded[2] = row[1] + row[2][0];
    } else if (typeof row[2] !== 'string') return invalid();
    expanded[10] = { ...amounts[index(row[10], amounts.length)] };
    for (const field of [11, 12]) expanded[field] = {
      ...(row[field] === null ? expanded[10] as ResourceAmounts : amounts[index(row[field], amounts.length)]),
    };
    for (const reference of row[13]) {
      if (typeof reference === 'number') {
        const allocation = allocations[index(reference, allocations.length)];
        if (!record(allocation) || !record(allocation.window)) return invalid();
      } else if (!Array.isArray(reference) || reference.length !== 3
        || reference.some(value => typeof value !== 'string')
        || !(RESOURCE_DIMENSIONS as readonly string[]).includes(reference[0])) return invalid();
    }
    if (typeof row[16] === 'number') expanded[16] = proofs[index(row[16], proofs.length)];
    else if (row[16] !== null && !record(row[16])) return invalid();
    return unpackedGrant(expanded, allocations);
  });
  return { ...tenant, grants } as unknown as TenantState;
}
export function encodeCoordinatorState(state: BudgetOwnerAggregateState): string {
  return JSON.stringify({ format: 4, state: { ...state,
    ownerIngress: state.ownerIngress ? packedTenant(state.ownerIngress) : undefined,
    tenantStates: state.tenantStates.map(packedTenant) } });
}
export function decodeCoordinatorState(value: BudgetOwnerAggregateState | string | Uint8Array): BudgetOwnerAggregateState {
  if (value instanceof Uint8Array) value = new TextDecoder().decode(value);
  if (typeof value !== 'string') return value;
  const parsed = JSON.parse(value);
  if (parsed.format === 3 || parsed.format === 4) {
    if (!record(parsed.state) || !Array.isArray(parsed.state.tenantStates)
      || parsed.state.tenantStates.length > 128) return invalid();
    return { ...parsed.state,
      ...(parsed.state.ownerIngress ? { ownerIngress: unpackedTenant(parsed.state.ownerIngress, parsed.format === 4) } : {}),
      tenantStates: parsed.state.tenantStates.map((tenant: unknown) => unpackedTenant(tenant, parsed.format === 4)) } as BudgetOwnerAggregateState;
  }
  if (parsed.format !== 2) {
    if (record(parsed) && 'format' in parsed) return invalid();
    return parsed as BudgetOwnerAggregateState;
  }
  return { ...parsed.state,
    ...(parsed.state.ownerIngress ? { ownerIngress: { ...parsed.state.ownerIngress,
      grants: parsed.state.ownerIngress.grants.map((grant: unknown[]) => unpackedGrant(grant, parsed.state.ownerIngress.allocations)) } } : {}),
    tenantStates: parsed.state.tenantStates.map((tenant: Omit<BudgetOwnerAggregateState['tenantStates'][number], 'grants'> & { grants: unknown[][] }) => ({
      ...tenant, grants: tenant.grants.map(grant => unpackedGrant(grant, tenant.allocations)),
    })) };
}
export const encodedGrantBytes = (grant: CoordinatorGrant): number => new TextEncoder().encode(JSON.stringify(packedGrant(grant))).byteLength;
