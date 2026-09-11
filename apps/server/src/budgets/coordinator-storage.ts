import type { BudgetOwnerAggregateState } from './owner-aggregate';
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
export function encodeCoordinatorState(state: BudgetOwnerAggregateState): string {
  return JSON.stringify({ format: 2, state: { ...state, tenantStates: state.tenantStates.map(tenant => ({ ...tenant,
    grants: tenant.grants.map(grant => packedGrant(grant, tenant.allocations)) })) } });
}
export function decodeCoordinatorState(value: BudgetOwnerAggregateState | string | Uint8Array): BudgetOwnerAggregateState {
  if (value instanceof Uint8Array) value = new TextDecoder().decode(value);
  if (typeof value !== 'string') return value;
  const parsed = JSON.parse(value);
  if (parsed.format !== 2) return parsed as BudgetOwnerAggregateState;
  return { ...parsed.state, tenantStates: parsed.state.tenantStates.map((tenant: Omit<BudgetOwnerAggregateState['tenantStates'][number], 'grants'> & { grants: unknown[][] }) => ({
    ...tenant, grants: tenant.grants.map(grant => unpackedGrant(grant, tenant.allocations)),
  })) };
}
export const encodedGrantBytes = (grant: CoordinatorGrant): number => new TextEncoder().encode(JSON.stringify(packedGrant(grant))).byteLength;
