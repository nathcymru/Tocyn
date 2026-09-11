import type { ResourceAmounts } from '@luminatick/shared';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { BudgetCommitAuthority, IsolateAdmissionResult } from '../budgets/isolate-admission.service';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { CustomerCurrentCredentialRepository, CustomerBudgetCredential, CustomerBudgetRequirements } from '../repositories/customer-current-credential.repository';
import type { VerifiedTenantScope } from './tenant';

/** Trusted widget facts copied after JWT and tenant authentication, never request JSON. */
export type CustomerBudgetReservationCredential = CustomerBudgetCredential;
/** A reply carries the exact target observed by the customer authorization boundary. */
export type CustomerBudgetReservationRequirements = CustomerBudgetRequirements;
export type CustomerBudgetReservationIntent = Readonly<{
  operationId: string;
  operationFingerprint: string;
  workScopeKey: string;
}>;

export type CustomerBudgetReservationInput = Readonly<{
  repository: BudgetAuthorityRepository;
  customers: CustomerCurrentCredentialRepository;
  namespace: DurableObjectNamespace;
  scope: VerifiedTenantScope;
  credential: CustomerBudgetReservationCredential;
  requirements: CustomerBudgetReservationRequirements;
  intent: CustomerBudgetReservationIntent;
  business: ResourceAmounts;
  now: () => number;
}>;

declare const preparedCustomerReservation: unique symbol;
/** Opaque capability returned only by the reservation service. */
export type PreparedCustomerBudgetReservation = Readonly<{
  readonly [preparedCustomerReservation]: true;
}>;

/** Public admission outcome deliberately excludes the write-fence authority. */
export type CustomerBudgetReservationResult = Omit<IsolateAdmissionResult, 'commitAuthority'>;

/**
 * Internal canonical-write seam. This is immutable and created only after a
 * current customer/ownership check and a matching successful reservation.
 * A later canonical integration must consume it inside its own D1 fence.
 */
export type CustomerBudgetCommitHandoff = Readonly<{
  credential: CustomerBudgetReservationCredential;
  requirements: CustomerBudgetReservationRequirements;
  authority: BudgetCommitAuthority;
}>;
