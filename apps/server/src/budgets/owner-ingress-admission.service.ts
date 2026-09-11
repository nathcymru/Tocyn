import type { BudgetPurpose, ResourceAmounts } from '@luminatick/shared';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { BudgetCoordinatorDO } from '../durable_objects/BudgetCoordinatorDO';
import { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { ReconcileOwnerIngressInput } from './owner-aggregate';

/**
 * One HTTP execution, two possible coordinator deliveries, and one terminal
 * closure. Provider bytes, CPU and duration are not represented by #50's
 * current catalogue and remain explicit release-gate gaps.
 */
export const OWNER_INGRESS_EXECUTION_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  d1RowsRead: 1_536,
  doRequests: 8,
  doRowsRead: 8,
  doRowsWritten: 8,
  logEvents: 67,
});
export const MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS = 2;
export const MAX_OWNER_INGRESS_FAILED_ADMISSIONS = 3;
export const MAX_OWNER_INGRESS_BINDINGS = 64;

export type OwnerIngressAdmissionResult =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'rejected'; reason: 'exhausted' | 'unavailable'; retryAt?: number }>
  | Readonly<{ status: 'admitted'; admission: OwnerIngressRequestAdmission }>;

/** Private request capability. It contains no secret or client-selected authority. */
export interface OwnerIngressRequestAdmission {
  /** Added exactly once to the first successful tenant admission on this request. */
  tenantHandoff(tenantId: string, now: number): Readonly<{ envelope: Readonly<ResourceAmounts>; closure: ReconcileOwnerIngressInput }> | undefined;
  /** Called synchronously only after the tenant grant has spent that envelope. */
  handoffToTenant(tenantId: string): void;
  /** Best-effort terminal closure; failure retains the full owner charge. */
  finish(now?: number): Promise<'closed' | 'retained'>;
}

type Failure = 'exhausted' | 'unavailable';
type Entry = {
  bindingIdentity: object;
  namespace: DurableObjectNamespace;
  purpose: BudgetPurpose;
  failures: number;
  terminalFailure?: Failure;
  retryAt?: number;
};

function scaledEnvelope(multiplier: number): ResourceAmounts {
  const envelope: ResourceAmounts = {};
  for (const [dimension, units] of Object.entries(OWNER_INGRESS_EXECUTION_ENVELOPE)) {
    const scaled = units * multiplier;
    if (!Number.isSafeInteger(scaled)) throw new Error('owner ingress envelope overflow');
    if (scaled > 0) envelope[dimension as keyof ResourceAmounts] = scaled;
  }
  return envelope;
}

class RequestAdmission implements OwnerIngressRequestAdmission {
  private offeredTenant?: string;
  private handedTenant?: string;
  private finishResult?: 'closed' | 'retained';

  constructor(
    private readonly coordinator: BudgetCoordinatorDO,
    private readonly reservation: NonNullable<Awaited<ReturnType<BudgetCoordinatorDO['reserveIngressFromTrustedAuthority']>>['reservation']>,
    private readonly policyId: string,
    private readonly policyRevision: number,
    private readonly envelope: Readonly<ResourceAmounts>,
    private readonly requestId: string,
    private readonly clock: () => number,
  ) {}

  private closure(now: number, handedOff: boolean): ReconcileOwnerIngressInput {
    return {
      reservationId: this.reservation.reservationId,
      holderId: this.reservation.holderId,
      expectedPolicyId: this.policyId,
      expectedPolicyRevision: this.policyRevision,
      terminalEvidenceId: `ingress:${this.requestId}`,
      measured: handedOff ? {} : this.envelope,
      uncertain: {},
      now,
      certifiedClosure: { operationSetFingerprint: handedOff
        ? `tenant-handoff:${this.requestId}` : `owner-only:${this.requestId}`, expiresAt: this.reservation.expiresAt },
    };
  }

  tenantHandoff(tenantId: string, now: number): Readonly<{ envelope: Readonly<ResourceAmounts>; closure: ReconcileOwnerIngressInput }> | undefined {
    if (this.finishResult || this.handedTenant || this.offeredTenant !== undefined || !tenantId || tenantId.length > 160
      || !Number.isSafeInteger(now) || now < 0 || now >= this.reservation.expiresAt) return undefined;
    this.offeredTenant = tenantId;
    return Object.freeze({ envelope: this.envelope, closure: Object.freeze(this.closure(now, true)) });
  }

  handoffToTenant(tenantId: string): void {
    if (this.finishResult || this.handedTenant || this.offeredTenant !== tenantId) return;
    this.handedTenant = tenantId;
  }

  async finish(at = this.clock()): Promise<'closed' | 'retained'> {
    if (this.finishResult) return this.finishResult;
    // The acknowledged transfer atomically closed the owner grant and retained
    // the full charge in the tenant ledger; no second coordinator write exists.
    if (this.handedTenant) return this.finishResult = 'closed';
    if (!Number.isSafeInteger(at) || at < 0 || at >= this.reservation.expiresAt) return this.finishResult = 'retained';
    const input = this.closure(at, false);
    for (let attempt = 0; attempt < MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS; attempt++) {
      try {
        const outcome = await this.coordinator.reconcileIngressFromTrustedAuthority(input);
        return this.finishResult = outcome === 'reconciled' || outcome === 'already-reconciled' ? 'closed' : 'retained';
      } catch {
        // Same immutable certificate only. Loss can never create a refund.
      }
    }
    return this.finishResult = 'retained';
  }
}

/**
 * The bounded registry keeps failed pre-admission I/O from becoming an
 * unbounded D1/DO loop. A later successful request prepays those failures in
 * the same existing owner partition; after three unresolved failures the
 * isolate fails closed until replacement.
 */
export class OwnerIngressAdmissionCache {
  private entries: Entry[] = [];

  inspectForTrustedRuntime(): Readonly<{ bindings: number; failedAdmissions: number; terminalFailures: number }> {
    return { bindings: this.entries.length, failedAdmissions: this.entries.reduce((sum, entry) => sum + entry.failures, 0),
      terminalFailures: this.entries.filter(entry => entry.terminalFailure).length };
  }

  discardForTrustedRuntime(): void { this.entries = []; }

  async admit(input: {
    repository: BudgetAuthorityRepository;
    namespace: DurableObjectNamespace;
    purpose: BudgetPurpose;
    now?: () => number;
  }): Promise<OwnerIngressAdmissionResult> {
    const clock = input.now ?? Date.now;
    let entry = this.entries.find(candidate => candidate.bindingIdentity === input.repository.bindingIdentity && candidate.namespace === input.namespace && candidate.purpose === input.purpose);
    if (!entry) {
      if (this.entries.length >= MAX_OWNER_INGRESS_BINDINGS) return { status: 'rejected', reason: 'unavailable' };
      entry = { bindingIdentity: input.repository.bindingIdentity, namespace: input.namespace, purpose: input.purpose, failures: 0 };
      this.entries.push(entry);
    }
    const initialNow = clock();
    if (entry.terminalFailure === 'exhausted' && entry.retryAt !== undefined && initialNow >= entry.retryAt) {
      entry.failures = 0; entry.terminalFailure = undefined; entry.retryAt = undefined;
    }
    if (entry.terminalFailure) return { status: 'rejected', reason: entry.terminalFailure, ...(entry.retryAt ? { retryAt: entry.retryAt } : {}) };
    const observedFailures = entry.failures;
    const checkedAt = initialNow;
    const authority = await input.repository.resolveForDeploymentIngress(checkedAt);
    if (!authority) return this.failed(entry, 'unavailable');
    const envelope = scaledEnvelope(observedFailures + 1);
    const requestId = crypto.randomUUID();
    const holderId = `owner-ingress:${requestId}`;
    const coordinator = input.namespace.get(input.namespace.idFromName(authority.aggregateId)) as unknown as BudgetCoordinatorDO;
    for (let attempt = 0; attempt < MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS; attempt++) {
      try {
        await coordinator.refreshFromTrustedAuthority(authority);
        const outcome = await coordinator.reserveIngressFromTrustedAuthority({ holderId, idempotencyKey: requestId,
          expectedPolicyId: authority.ownerPolicy.policyId, expectedPolicyRevision: authority.ownerPolicy.revision,
          purpose: input.purpose, envelope, now: checkedAt });
        if ((outcome.status === 'granted' || outcome.status === 'idempotent') && outcome.reservation) {
          // Preserve failures that raced after this request's snapshot.
          entry.failures = Math.max(0, entry.failures - observedFailures);
          return { status: 'admitted', admission: new RequestAdmission(coordinator, outcome.reservation,
            authority.ownerPolicy.policyId, authority.ownerPolicy.revision, Object.freeze(envelope), requestId, clock) };
        }
        const retryAt = outcome.reason === 'exhausted' ? Math.max(...authority.ownerPolicy.budgets
          .filter(budget => OWNER_INGRESS_EXECUTION_ENVELOPE[budget.dimension] !== undefined && budget.window.kind === 'interval')
          .map(budget => budget.window.kind === 'interval' ? budget.window.endsAt : checkedAt)) : undefined;
        return this.failed(entry, outcome.reason === 'exhausted' ? 'exhausted' : 'unavailable', retryAt);
      } catch {
        if (attempt + 1 === MAX_OWNER_INGRESS_DELIVERY_ATTEMPTS) return this.failed(entry, 'unavailable');
      }
    }
    return this.failed(entry, 'unavailable');
  }

  private failed(entry: Entry, reason: Failure, retryAt?: number): OwnerIngressAdmissionResult {
    entry.failures++;
    if (reason === 'exhausted' && Number.isSafeInteger(retryAt) && retryAt! > 0) entry.retryAt = retryAt;
    if (entry.failures >= MAX_OWNER_INGRESS_FAILED_ADMISSIONS) entry.terminalFailure = reason;
    return { status: 'rejected', reason, ...(entry.retryAt ? { retryAt: entry.retryAt } : {}) };
  }
}

export const ownerIngressAdmissionCache = new OwnerIngressAdmissionCache();
