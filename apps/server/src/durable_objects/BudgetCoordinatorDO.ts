import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../bindings';
import { certifiedGrantFingerprint, type ReconcileBudgetGrantInput } from '../budgets/coordinator-state';
import { decodeCoordinatorState, encodeCoordinatorState, encodedGrantBytes } from '../budgets/coordinator-storage';
import {
  createBudgetOwnerAggregateState,
  handoffOwnerIngressBatch,
  handoffOwnerIngress,
  OWNER_INGRESS_RESTRICTION_REVISION,
  reconcileOwnerAggregate,
  reconcileOwnerIngress,
  refreshBudgetOwnerAggregateAuthority,
  revokeBudgetOwnerAggregateAuthority,
  reserveOwnerAggregate,
  reserveOwnerIngress,
  type BudgetOwnerAggregateState,
  type HandoffOwnerIngressInput,
  type HandoffOwnerIngressBatchInput,
  type ReconcileOwnerAggregateInput,
  type ReconcileOwnerIngressInput,
  type ReserveOwnerAggregateInput,
  type ReserveOwnerIngressInput,
  type TrustedBudgetCoordinatorAuthority,
  type TrustedBudgetCoordinatorRevocation,
} from '../budgets/owner-aggregate';

const STATE_KEY = 'budget-owner-aggregate-v1';
// A Durable Object KV value is limited to 128 KiB. Persisting bounded UTF-8
// bytes makes the native value size explicit, with 8 KiB left for storage serialization.
const MAX_STATE_BYTES = 120 * 1_024;
const encodedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
async function certifiedDigest(input: ReconcileBudgetGrantInput): Promise<string | undefined> {
  return input.certifiedClosure ? `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(certifiedGrantFingerprint(input))))).map(byte => byte.toString(16).padStart(2, '0')).join('')}` : undefined;
}

/** Retain room for terminal identity, full accounting, both purpose rollups and
 * the paired recovery reservation for every accepted, unfinished work grant.
 * Repeated copies deliberately overestimate the bounded closure representation;
 * fixed space covers maximum-length certificate identities and recovery overhead.
 */
function recoveryHeadroom(state: BudgetOwnerAggregateState): number {
  const allocationGrowth = new Map<string, number>();
  let bytes = 8_192; // Authority lease changes and fixed certificate/recovery fields.
  for (const tenant of [state.ownerIngress, ...state.tenantStates]) for (const grant of tenant.grants) {
    if (grant.compacted || grant.status === 'reconciled' || grant.purpose !== 'new-work') continue;
    for (const allocation of tenant.allocations.filter(allocation => grant.allocations.some(reference => reference.dimension === allocation.dimension
      && reference.allocationId === allocation.allocationId && reference.windowId === allocation.window.id))) {
      allocationGrowth.set(JSON.stringify([tenant.tenantId, allocation.dimension, allocation.allocationId, allocation.window.id]), 2 * encodedBytes(allocation));
    }
    const prepaid = tenant.grants.filter(candidate => candidate.recoversReservationId === grant.reservationId)
      .reduce((total, candidate) => total + encodedGrantBytes(candidate), 0);
    // The compact certificate is a fixed SHA-256 identity. One extra packed
    // grant-sized record plus 256 bytes covers its paired recovery completion;
    // the accepted original already occupies its own packed record.
    bytes += Math.max(0, encodedGrantBytes(grant) + 256 - prepaid);
  }
  return bytes + [...allocationGrowth.values()].reduce((sum, size) => sum + size, 0);
}
function assertGrowthCapacity(state: BudgetOwnerAggregateState): void {
  if (new TextEncoder().encode(encodeCoordinatorState(state)).byteLength + recoveryHeadroom(state) > MAX_STATE_BYTES) {
    throw new Error('owner budget accounting metadata recovery headroom capacity exhausted');
  }
}

/**
 * One coordinator is named by server-derived deployment and owner-allocation
 * authority. It contains every tenant allocation sharing that ceiling. There
 * is no fetch handler and no application route: this internal RPC surface is
 * not a client protocol and does not authenticate claims. Request composition
 * loads fresh server-owned deployment authority before every ingress call and
 * current credential/tenant authority before every business admission.
 */
export class BudgetCoordinatorDO extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  private async read(): Promise<BudgetOwnerAggregateState> {
    const value = await this.ctx.storage.get<BudgetOwnerAggregateState | string | Uint8Array>(STATE_KEY);
    if (!value) throw new Error('budget coordinator has not received trusted authority');
    return decodeCoordinatorState(value);
  }

  private async write(value: BudgetOwnerAggregateState): Promise<void> {
    const serialized = new TextEncoder().encode(encodeCoordinatorState(value));
    if (serialized.byteLength > MAX_STATE_BYTES) {
      throw new Error('owner budget accounting metadata byte capacity exhausted');
    }
    await this.ctx.storage.put(STATE_KEY, serialized);
  }

  /** Internal bootstrap only; exactly one trusted authority snapshot is accepted. */
  async initializeFromTrustedAuthority(authority: TrustedBudgetCoordinatorAuthority): Promise<void> {
    const existing = await this.ctx.storage.get<BudgetOwnerAggregateState | string | Uint8Array>(STATE_KEY);
    if (existing) throw new Error('budget coordinator authority is already initialized');
    await this.write(createBudgetOwnerAggregateState(authority));
  }

  /** Refreshes only a server-loaded authority lease; revision changes freeze new reservations. */
  async refreshFromTrustedAuthority(authority: TrustedBudgetCoordinatorAuthority): Promise<void> {
    const existing = await this.ctx.storage.get<BudgetOwnerAggregateState | string | Uint8Array>(STATE_KEY);
    if (!existing) {
      await this.write(createBudgetOwnerAggregateState(authority));
      return;
    }
    const current = decodeCoordinatorState(existing);
    const next = refreshBudgetOwnerAggregateAuthority(current, authority);
    if (next.authorityRevision !== current.authorityRevision) assertGrowthCapacity(next);
    await this.write(next);
  }

  /** Delivery path for a verified D1 revocation; reconciliation stays available. */
  async revokeFromTrustedAuthority(revocation: TrustedBudgetCoordinatorRevocation): Promise<void> {
    const current = await this.read();
    await this.write(revokeBudgetOwnerAggregateAuthority(current, revocation));
  }

  /** Caller supplies only already verified, server-derived inputs. */
  async reserveFromTrustedAuthority(input: ReserveOwnerAggregateInput): Promise<ReturnType<typeof reserveOwnerAggregate>['outcome']> {
    const current = await this.read();
    const result = reserveOwnerAggregate(current, input);
    if (result.outcome.status === 'granted') {
      try { assertGrowthCapacity(result.state); }
      catch { return { status: 'rejected', reason: 'capacity-exhausted' }; }
    }
    await this.write(result.state);
    return result.outcome;
  }

  /** Server-only request ingress shares the existing owner allocation exactly. */
  async reserveIngressFromTrustedAuthority(input: ReserveOwnerIngressInput): Promise<ReturnType<typeof reserveOwnerIngress>['outcome']> {
    const current = await this.read();
    const result = reserveOwnerIngress(current, input);
    if (result.outcome.status === 'granted') {
      try { assertGrowthCapacity(result.state); }
      catch { return { status: 'rejected', reason: 'capacity-exhausted' }; }
    }
    await this.write(result.state);
    return result.outcome;
  }

  /** Caller binds tenant and holder to authenticated terminal evidence before this RPC. */
  async reconcileFromTrustedAuthority(input: ReconcileOwnerAggregateInput): Promise<ReturnType<typeof reconcileOwnerAggregate>['outcome']> {
    // Hash before reading mutable state, so the async digest cannot interleave
    // between the atomic read and write of the owner's accounting.
    const digest = await certifiedDigest(input);
    const current = await this.read();
    const result = reconcileOwnerAggregate(current, { ...input, certifiedCompletionDigest: digest });
    await this.write(result.state);
    return result.outcome;
  }

  /** Closes one server-observed ingress execution after response/handoff settles. */
  async reconcileIngressFromTrustedAuthority(input: ReconcileOwnerIngressInput): Promise<ReturnType<typeof reconcileOwnerIngress>['outcome']> {
    const fingerprintInput = { ...input, expectedRestrictionRevision: OWNER_INGRESS_RESTRICTION_REVISION };
    const digest = await certifiedDigest(fingerprintInput);
    const current = await this.read();
    const result = reconcileOwnerIngress(current, { ...input, certifiedCompletionDigest: digest });
    await this.write(result.state);
    return result.outcome;
  }

  /** Atomically reattributes one ingress execution after current tenant authority is known. */
  async handoffIngressFromTrustedAuthority(input: Readonly<{
    authority: TrustedBudgetCoordinatorAuthority;
    handoff: HandoffOwnerIngressInput;
  }>): Promise<ReturnType<typeof handoffOwnerIngress>['outcome']> {
    const ownerDigest = await certifiedDigest({ ...input.handoff.ownerClosure,
      expectedRestrictionRevision: OWNER_INGRESS_RESTRICTION_REVISION });
    const current = await this.read();
    const refreshed = refreshBudgetOwnerAggregateAuthority(current, input.authority);
    const result = handoffOwnerIngress(refreshed, { ...input.handoff, ownerClosure: {
      ...input.handoff.ownerClosure,
      certifiedCompletionDigest: ownerDigest,
    } });
    if (result.outcome.status === 'handed-off') {
      try { assertGrowthCapacity(result.state); }
      catch { return { status: 'rejected', reason: 'capacity-exhausted' }; }
    }
    await this.write(result.state);
    return result.outcome;
  }

  /** One warm-block settlement; all tenant transfers and owner closure commit together. */
  async handoffIngressBatchFromTrustedAuthority(input: HandoffOwnerIngressBatchInput): Promise<ReturnType<typeof handoffOwnerIngressBatch>['outcome']> {
    const digest = await certifiedDigest({ ...input.ownerClosure,
      expectedRestrictionRevision: OWNER_INGRESS_RESTRICTION_REVISION });
    const current = await this.read();
    const result = handoffOwnerIngressBatch(current,{...input,ownerClosure:{
      ...input.ownerClosure,certifiedCompletionDigest:digest,
    }});
    if (result.outcome.status === 'handed-off') {
      try { assertGrowthCapacity(result.state); }
      catch { return { status:'rejected',reason:'capacity-exhausted' }; }
    }
    await this.write(result.state);
    return result.outcome;
  }

  /** Internal diagnostics/testing only; it reveals no tenant data to an HTTP client. */
  async inspectForTrustedRuntime(): Promise<BudgetOwnerAggregateState> {
    return this.read();
  }
}
