import { IsolateBudgetAdmissionCache } from './isolate-admission.service';
import type {
  CustomerBudgetCommitHandoff,
  CustomerBudgetReservationInput,
  CustomerBudgetReservationResult,
  PreparedCustomerBudgetReservation,
} from '../types/customer-budget-admission';

type Attempt = Readonly<CustomerBudgetReservationInput> & {
  authority?: CustomerBudgetCommitHandoff['authority']; spent: boolean; handoffTaken: boolean;
};

function owned<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
}

function validIntent(intent: CustomerBudgetReservationInput['intent']): boolean {
  return [intent.operationId, intent.operationFingerprint, intent.workScopeKey].every(value =>
    typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value));
}

/**
 * Customer reservation prerequisite only. It does not authenticate HTTP,
 * install a route permission, write a ticket, or expose a commit authority in
 * admission responses. A later canonical mutation adapter can obtain the
 * immutable handoff after it has selected its D1 fence.
 */
export class CustomerBudgetReservationService {
  private readonly attempts = new WeakMap<PreparedCustomerBudgetReservation, Attempt>();
  constructor(private readonly cache: IsolateBudgetAdmissionCache) {}

  prepareCustomerReservation(input: CustomerBudgetReservationInput): PreparedCustomerBudgetReservation | null {
    if (!validIntent(input.intent)) return null;
    const prepared = Object.freeze({}) as PreparedCustomerBudgetReservation;
    // Database/binding objects are capability references and cannot be cloned;
    // only caller-provided facts and the admission intent need an owned copy.
    const { credential, requirements, intent, business, ...trustedDependencies } = input;
    this.attempts.set(prepared, { ...trustedDependencies, ...owned({ credential, requirements, intent, business }), spent: false, handoffTaken: false });
    return prepared;
  }

  async reserve(prepared: PreparedCustomerBudgetReservation): Promise<CustomerBudgetReservationResult> {
    const attempt = this.attempts.get(prepared);
    if (!attempt || attempt.spent) return Object.freeze({ status: 'rejected' as const, reason: 'replay-exhausted' as const });
    const serialized = JSON.stringify([attempt.credential, attempt.requirements]);
    if (new TextEncoder().encode(serialized).byteLength > 16_384) return Object.freeze({ status: 'rejected' as const, reason: 'stale-policy' as const });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const credentialKey = `customer:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const result = await this.cache.admit({
      repository: attempt.repository,
      namespace: attempt.namespace,
      scope: attempt.scope,
      credentialKey,
      intent: attempt.intent,
      business: attempt.business,
      now: attempt.now,
      // The cache calls this before every warm spend, and then its repository
      // resolution repeats current scope/session evidence before any grant.
      authorization: { authorize: scope => scope.tenantId === attempt.scope.tenantId && scope.actorId === attempt.scope.actorId
        ? attempt.customers.authorize(attempt.credential, attempt.requirements, attempt.now()) : Promise.resolve(null) },
    });
    const { commitAuthority, ...publicResult } = result;
    if (result.status !== 'rejected' && commitAuthority && commitAuthority.operationId === attempt.intent.operationId
      && commitAuthority.operationFingerprint === attempt.intent.operationFingerprint) {
      attempt.authority = owned(commitAuthority);
      attempt.spent = true;
    }
    return owned(publicResult);
  }

  /** Canonical integration-only handoff; a reservation grants at most one write attempt. */
  commitHandoff(prepared: PreparedCustomerBudgetReservation): CustomerBudgetCommitHandoff | null {
    const attempt = this.attempts.get(prepared);
    if (!attempt?.authority || attempt.handoffTaken) return null;
    attempt.handoffTaken = true;
    return owned({ credential: attempt.credential, requirements: attempt.requirements, authority: attempt.authority });
  }
}
