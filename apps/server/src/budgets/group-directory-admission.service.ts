import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import { staffTicketAdmissionMode, sessionTicketBudgetAdmission, apiTicketBudgetCache } from '../middleware/budget-admission.middleware';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { GroupDirectoryRepository, type GroupDirectoryCommit, type GroupDirectoryOperation,
  type GroupDirectoryPopulation, type GroupDirectoryTarget } from '../repositories/group-directory.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { JWTPayload } from '../types';

const GROUP_DIRECTORY_BASE_READS = 3_072;
const GROUP_DIRECTORY_BASE_WRITES = 8;
const GROUP_DIRECTORY_ROWS_PER_RESULT = 8;
// Deleting one membership also advances the affected user's session version
// and maintains the per-group population row. This factor covers those rows
// and their indexed lookups without limiting the number of legacy members.
const GROUP_DELETE_READS_PER_MEMBER = 16;
const GROUP_DELETE_WRITES_PER_MEMBER = 16;

function checkedUnits(base: number, count: number, factor: number): number | null {
  const value = base + count * factor;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** A maintained population expands the reservation; it never truncates results. */
export function groupDirectoryEnvelope(operation: GroupDirectoryOperation, population?: GroupDirectoryPopulation): ResourceAmounts | null {
  let d1RowsRead = GROUP_DIRECTORY_BASE_READS;
  let d1RowsWritten = GROUP_DIRECTORY_BASE_WRITES;
  if (population) {
    const readFactor = operation === 'directory.group.delete' ? GROUP_DELETE_READS_PER_MEMBER : GROUP_DIRECTORY_ROWS_PER_RESULT;
    const reads = checkedUnits(d1RowsRead, population.count, readFactor);
    if (reads === null) return null;
    d1RowsRead = reads;
    if (operation === 'directory.group.delete') {
      const writes = checkedUnits(d1RowsWritten, population.count, GROUP_DELETE_WRITES_PER_MEMBER);
      if (writes === null) return null;
      d1RowsWritten = writes;
    }
  }
  return Object.freeze({ workerRequests: 1, d1RowsRead, d1RowsWritten,
    ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
}

export type GroupDirectoryAdmission = Readonly<{
  status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'unavailable';
  commit?: GroupDirectoryCommit;
}>;

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  payload: JWTPayload;
  operation: GroupDirectoryOperation;
  target: GroupDirectoryTarget;
  capability?: CapabilityWriteFence;
  now: () => number;
}>;

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validTarget(operation: GroupDirectoryOperation, target: GroupDirectoryTarget): boolean {
  if (operation === 'directory.users.list') return Number.isSafeInteger(target.page) && target.page! >= 1
    && Number.isSafeInteger(target.limit) && target.limit! >= 1 && target.limit! <= 100
    && (target.role === null || (typeof target.role === 'string' && target.role.length <= 128));
  if (operation === 'directory.agents.list' || operation === 'directory.groups.list') return Object.keys(target).length === 0;
  if (operation === 'directory.group.create') return typeof target.name === 'string'
    && (target.description === null || typeof target.description === 'string');
  if (operation === 'directory.group.member.add' || operation === 'directory.group.member.remove') {
    return safeId(target.groupId) && safeId(target.userId);
  }
  return safeId(target.groupId);
}

function capabilityRequired(operation: GroupDirectoryOperation): boolean {
  return operation === 'directory.users.list' || operation === 'directory.group.create' || operation === 'directory.group.delete'
    || operation === 'directory.group.member.add' || operation === 'directory.group.member.remove';
}

async function digest(parts: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolves the complete-list population before spending and carries that exact
 * snapshot into the repository's same-batch credential, policy and growth
 * assertion. A later growth event therefore rejects instead of exceeding the
 * admitted envelope; shrinkage remains within the conservative reservation.
 */
export async function admitGroupDirectory(input: AdmissionInput): Promise<GroupDirectoryAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const mode = staffTicketAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  const sessionVersion = input.payload.session_version;
  if (mode !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || input.payload.sub !== input.deps.scope.actorId
    || (input.payload.role !== 'admin' && input.payload.role !== 'agent') || typeof sessionVersion !== 'number'
    || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(input.payload.exp) || input.payload.mfa_verified !== true
    || !validTarget(input.operation,input.target) || capabilityRequired(input.operation) !== Boolean(input.capability)) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const credential: SessionBudgetCredential = Object.freeze({ tenantId: input.deps.scope.tenantId,
    actorId: input.payload.sub, role: input.payload.role, sessionVersion, expiresAt: input.payload.exp, mfaVerified: true });
  try {
    const repository = new GroupDirectoryRepository(input.deps.scope,input.deps.database);
    const population = await repository.population(input.operation,input.target.groupId);
    const business = groupDirectoryEnvelope(input.operation,population);
    if (!business) return { status: 'rejected', reason: 'unavailable' };
    const requestKey = await digest(['group-directory-v1',input.operation,input.deps.scope.tenantId,
      input.deps.scope.actorId,input.target,population??null,input.capability??null]);
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: input.deps.repositories.budgetAuthority,
      sessions: new SessionBudgetAuthorityRepository(input.deps.database,input.deps.scope), namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: input.deps.scope, credential, requirements: input.capability ? { capability: input.capability } : {},
      intent: { operationId: crypto.randomUUID(), operationFingerprint: requestKey, workScopeKey: input.operation },
      business, now: input.now });
    if ((outcome.status !== 'spent' && outcome.status !== 'idempotent') || !outcome.commitAuthority) {
      return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
    }
    return { status: 'admitted', commit: Object.freeze({ operation: input.operation, requestKey,
      target: Object.freeze(structuredClone(input.target)), credential, ...(input.capability ? { capability: Object.freeze(structuredClone(input.capability)) } : {}),
      ...(population ? { population: Object.freeze(population) } : {}), authority: outcome.commitAuthority }) };
  } catch {
    return { status: 'rejected', reason: 'unavailable' };
  }
}

/** Complete results and expected business statuses settle; uncertain failures poison the local grant. */
export function settleGroupDirectory(commit: GroupDirectoryCommit, outcome: 'committed'|'unknown', now: number): void {
  apiTicketBudgetCache.settleOperation(commit.authority,outcome,now);
}
