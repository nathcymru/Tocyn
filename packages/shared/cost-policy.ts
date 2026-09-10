/** Versioned planning/enforcement contracts. IDs and policy fields never grant authority. */
export const COST_POLICY_VERSION = 1 as const;

export const RESOURCE_DIMENSIONS = [
  'workerRequests', 'workerCpuMs', 'queueOperations', 'd1RowsRead', 'd1RowsWritten',
  'd1StorageBytes', 'r2StorageBytes', 'r2ClassAOperations', 'r2ClassBOperations',
  'doRequests', 'doDurationMilliGbSeconds', 'doRowsRead', 'doRowsWritten',
  'doStorageBytes', 'aiMicroNeurons', 'vectorStoredDimensions', 'vectorQueriedDimensions',
  'workflowExecutions', 'workflowSteps', 'workflowStorageBytes',
  'kvReads', 'kvWrites', 'kvDeletes', 'kvLists', 'kvStorageBytes',
  'logEvents', 'traceEvents', 'externalProviderUnits', 'aiGatewayRequests',
] as const;
export type ResourceDimension = typeof RESOURCE_DIMENSIONS[number];
export const STOCK_DIMENSIONS: readonly ResourceDimension[] = [
  'd1StorageBytes', 'r2StorageBytes', 'doStorageBytes', 'vectorStoredDimensions',
  'workflowStorageBytes', 'kvStorageBytes',
];
export type CostMode = 'conservative' | 'aggressive';
export type BudgetPurpose = 'new-work' | 'recovery';
export type ResourceAmounts = Partial<Record<ResourceDimension, number>>;

/** Half-open UTC interval, or a stock ceiling that does not reset with a billing month. */
export type ResourceWindow =
  | { kind: 'interval'; id: string; startsAt: number; endsAt: number }
  | { kind: 'stock'; id: string };

export interface ResourceBudget {
  dimension: ResourceDimension;
  /** Owner-selected account/database/bucket allocation identity, never request-derived. */
  allocationId: string;
  window: ResourceWindow;
  limit: number;
  recoveryPercent: number;
  provenance: 'owner-allocation';
}

export interface CostPolicy {
  schemaVersion: typeof COST_POLICY_VERSION;
  policyId: string;
  revision: number;
  deploymentId: string;
  mode: CostMode;
  catalogueVersion: string;
  budgets: ResourceBudget[];
  /** Grant validity must end before the policy authority must be consulted again. */
  maxGrantLifetimeMs: number;
}

export interface TenantBudgetRestriction {
  schemaVersion: typeof COST_POLICY_VERSION;
  tenantId: string;
  ownerPolicyId: string;
  ownerPolicyRevision: number;
  revision: number;
  mode: CostMode;
  /** A tenant restriction can only lower its separately assigned owner allocation. */
  limits: ResourceAmounts;
  disabledFeatures: string[];
}

/** Derived server-side from a verified tenant allocation; never accepted from a client. */
export interface EffectiveTenantCostPolicy extends CostPolicy {
  tenantId: string;
  restrictionRevision: number;
  disabledFeatures: string[];
}

export interface BudgetReservation {
  schemaVersion: typeof COST_POLICY_VERSION;
  reservationId: string;
  tenantId: string;
  holderId: string;
  policyId: string;
  policyRevision: number;
  restrictionRevision: number;
  purpose: BudgetPurpose;
  createdAt: number;
  expiresAt: number;
  /** Dimension/window/allocation identities are included in each durable grant. */
  grants: Array<{ dimension: ResourceDimension; allocationId: string; windowId: string; units: number }>;
  state: 'reserved' | 'consumed' | 'reconciled' | 'uncertain';
}

export interface UsageSnapshot {
  schemaVersion: typeof COST_POLICY_VERSION;
  tenantId: string;
  policyId: string;
  policyRevision: number;
  restrictionRevision: number;
  asOf: number;
  authorityCheckedAt: number;
  stale: boolean;
  resources: Array<{
    dimension: ResourceDimension;
    allocationId: string;
    window: ResourceWindow;
    measured: number;
    estimated: number;
    reserved: number;
    uncertain: number;
    limit: number;
    measurementSource: string;
  }>;
}

export type AdmissionResult =
  | { admitted: true; reservation: BudgetReservation; path: 'reserved-warm' | 'authoritative-cold' }
  | { admitted: false; reason: 'exhausted' | 'stale-policy' | 'unavailable' | 'invalid-request'; retryAt?: number };

/** An atomic durable authority must implement these semantics in #64/#91, not a cached flag. */
export interface BudgetAuthority {
  reserve(request: {
    tenantId: string; holderId: string; idempotencyKey: string;
    expectedPolicyId: string; expectedPolicyRevision: number;
    expectedRestrictionRevision: number; purpose: BudgetPurpose; envelope: ResourceAmounts;
  }): Promise<AdmissionResult>;
  reconcile(request: {
    reservationId: string; tenantId: string; holderId: string;
    expectedPolicyId: string; expectedPolicyRevision: number;
    expectedRestrictionRevision: number; terminalEvidenceId: string;
    measured: ResourceAmounts; uncertain: ResourceAmounts;
  }): Promise<'reconciled' | 'already-reconciled' | 'rejected'>;
}
