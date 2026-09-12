import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import {
  apiTicketBudgetCache,
  sessionTicketBudgetAdmission,
  staffTicketAdmissionMode,
} from '../middleware/budget-admission.middleware';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import {
  StaffAuthAdmissionRepository,
  type StaffAuthCommit as RepositoryCommit,
  type StaffAuthSnapshot,
} from '../repositories/staff-auth-admission.repository';
import {
  SessionBudgetAuthorityRepository,
  type SessionBudgetCredential,
  type SessionBudgetRequirements,
} from '../repositories/session-budget-authority.repository';
import type { JWTPayload, User } from '../types';
import type { BudgetCommitAuthority } from './isolate-admission.service';

export type StaffAuthOperation =
  | 'staff.auth.mfa.verify'
  | 'staff.auth.mfa.setup'
  | 'staff.auth.mfa.confirm'
  | 'staff.auth.logout'
  | 'staff.auth.me';
export type StaffAuthAdmission =
  | { status: 'disabled' }
  | { status: 'rejected'; reason: 'exhausted' | 'unavailable' }
  | { status: 'admitted'; commit: StaffAuthCommit };

const READ: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  workerCpuMs: 100,
  d1RowsRead: 4_096,
  d1RowsWritten: 16,
  ...estimateDiagnosticEnvelope({ httpRequests: 1 }),
});
const MUTATION: Readonly<ResourceAmounts> = Object.freeze({
  workerRequests: 1,
  workerCpuMs: 100,
  d1RowsRead: 4_096,
  d1RowsWritten: 32,
  ...estimateDiagnosticEnvelope({ httpRequests: 1 }),
});
export const STAFF_AUTH_ENVELOPES: Readonly<Record<StaffAuthOperation, Readonly<ResourceAmounts>>> = Object.freeze({
  'staff.auth.mfa.verify': READ,
  'staff.auth.mfa.setup': Object.freeze({ ...MUTATION, d1StorageBytes: 512 }),
  'staff.auth.mfa.confirm': MUTATION,
  'staff.auth.logout': MUTATION,
  'staff.auth.me': READ,
});

export function staffAuthEnvelope(operation: StaffAuthOperation, snapshot: StaffAuthSnapshot): Readonly<ResourceAmounts> {
  const base = STAFF_AUTH_ENVELOPES[operation];
  if (operation !== 'staff.auth.mfa.setup' || !snapshot.pendingSecret) return base;
  const { d1StorageBytes: _stock, ...recovery } = base;
  return Object.freeze(recovery);
}

export class StaffAuthAdmissionError extends Error {
  constructor() { super('Staff authentication admission is unavailable'); }
}

function authenticationStage(operation: StaffAuthOperation): SessionBudgetRequirements['authentication'] {
  if (operation === 'staff.auth.mfa.verify') return 'challenge';
  if (operation === 'staff.auth.mfa.setup' || operation === 'staff.auth.mfa.confirm') return 'enrollment';
  return undefined;
}

async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class StaffAuthCommit {
  private readonly repository: StaffAuthAdmissionRepository;
  private readonly fence: RepositoryCommit;
  private settled = false;
  private started = false;

  constructor(
    private readonly deps: TenantRequestDeps,
    credential: SessionBudgetCredential,
    requirements: SessionBudgetRequirements,
    authority: BudgetCommitAuthority,
    snapshot: StaffAuthSnapshot,
    private readonly now: () => number,
  ) {
    this.repository = new StaffAuthAdmissionRepository(deps.database, deps.scope);
    this.fence = Object.freeze({ credential, requirements, authority, snapshot });
  }

  private begin(): void {
    if (this.started || this.settled || this.now() >= this.fence.authority.expiresAt) throw new StaffAuthAdmissionError();
    this.started = true;
  }

  async user(): Promise<User | null> {
    this.begin();
    return this.repository.user(this.fence);
  }

  async beginMfaEnrollment(secret: string): Promise<User | null> {
    if (!this.started || this.settled) return null;
    return this.repository.beginMfaEnrollment(this.fence, secret);
  }

  async completeMfaEnrollment(secret: string): Promise<boolean> {
    if (!this.started || this.settled) return false;
    return this.repository.completeMfaEnrollment(this.fence, secret);
  }

  async revokeSessions(): Promise<boolean> {
    this.begin();
    return this.repository.revokeSessions(this.fence);
  }

  async authorizeCurrent(): Promise<void> {
    if (this.settled || this.now() >= this.fence.authority.expiresAt) throw new StaffAuthAdmissionError();
    const sessions = new SessionBudgetAuthorityRepository(this.deps.database, this.deps.scope);
    const principal = await sessions.authorize(this.fence.credential, this.fence.requirements, this.now());
    if (!principal) throw new StaffAuthAdmissionError();
    const current = await this.deps.repositories.budgetAuthority.resolveForVerifiedPrincipal(this.deps.scope, principal, this.now());
    if (current.kind !== 'active' || Object.entries(current.commitSnapshot).some(([key, value]) =>
      this.fence.authority.snapshot[key as keyof typeof current.commitSnapshot] !== value)) {
      throw new StaffAuthAdmissionError();
    }
    const grant = this.fence.authority.grant;
    if (!grant || await this.repository.grantClosed(grant.reservationId, grant.holderId)) throw new StaffAuthAdmissionError();
  }

  settle(outcome: 'committed' | 'unknown'): void {
    if (this.settled) return;
    this.settled = true;
    apiTicketBudgetCache.settleOperation(this.fence.authority, outcome, this.now());
  }
}

export async function admitStaffAuthEffect(input: {
  env: Env;
  deps: TenantRequestDeps;
  payload: JWTPayload;
  operation: StaffAuthOperation;
  now: () => number;
}): Promise<StaffAuthAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined || staffTicketAdmissionMode(input.env) === 'disabled') {
    return { status: 'disabled' };
  }
  const mode = staffTicketAdmissionMode(input.env);
  const { payload } = input;
  const { scope } = input.deps;
  if (mode !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || payload.sub !== scope.actorId
    || payload.tenant_id !== scope.tenantId || (payload.role !== 'admin' && payload.role !== 'agent')
    || !Number.isSafeInteger(payload.session_version) || !Number.isSafeInteger(payload.exp)) {
    return { status: 'rejected', reason: 'unavailable' };
  }

  const authentication = authenticationStage(input.operation);
  const requirements: SessionBudgetRequirements = Object.freeze(authentication ? { authentication } : {});
  const credential: SessionBudgetCredential = {
    tenantId: scope.tenantId,
    actorId: payload.sub,
    role: payload.role,
    sessionVersion: payload.session_version!,
    expiresAt: payload.exp,
    mfaVerified: payload.mfa_verified === true,
  };
  try {
    const checkedAt = input.now();
    const sessions = new SessionBudgetAuthorityRepository(input.deps.database, scope);
    if (!await sessions.authorize(credential, requirements, checkedAt)) return { status: 'rejected', reason: 'unavailable' };
    const snapshot = await new StaffAuthAdmissionRepository(input.deps.database, scope).snapshot();
    if (!snapshot) return { status: 'rejected', reason: 'unavailable' };
    const operationFingerprint = await digest([
      'staff-auth-v1', scope.tenantId, scope.actorId, input.operation, credential.sessionVersion, checkedAt,
    ]);
    const intent = Object.freeze({
      operationId: crypto.randomUUID(),
      operationFingerprint,
      workScopeKey: input.operation,
    });
    const result = await sessionTicketBudgetAdmission.admit({
      repository: input.deps.repositories.budgetAuthority,
      sessions,
      namespace: input.env.BUDGET_COORDINATOR_DO,
      scope,
      credential,
      requirements,
      intent,
      business: staffAuthEnvelope(input.operation, snapshot),
      now: input.now,
    });
    if (result.status === 'rejected') {
      return {
        status: 'rejected',
        reason: result.reason === 'exhausted' || result.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable',
      };
    }
    if (!result.commitAuthority || result.commitAuthority.operationId !== intent.operationId
      || result.commitAuthority.operationFingerprint !== intent.operationFingerprint) {
      return { status: 'rejected', reason: 'unavailable' };
    }
    return {
      status: 'admitted',
      commit: new StaffAuthCommit(input.deps, credential, requirements, result.commitAuthority, snapshot, input.now),
    };
  } catch {
    return { status: 'rejected', reason: 'unavailable' };
  }
}
