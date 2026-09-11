import type { ResourceAmounts } from '@luminatick/shared';
import type { CapabilityWriteFence } from '../auth/capability-policy';
import type { Env } from '../bindings';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';
import { ApiKeyAdminRepository, type ApiKeyAdminCommit, type ApiKeyAdminOperation,
  type ApiKeyCandidate } from '../repositories/api-key-admin.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { JWTPayload } from '../types';

const BASE_READS = 3_072;
// One execution may insert and remove a losing candidate in its atomic batch.
// The holder permits at most two attempts; native 14-write attempts keep the
// resulting 28-write worst case inside this reservation.
const BASE_WRITES = 32;
const READS_PER_LIST_ROW = 8;

export function apiKeyAdminEnvelope(operation: ApiKeyAdminOperation, population?: number): ResourceAmounts | null {
  const d1RowsRead = operation === 'api-key.list' && Number.isSafeInteger(population) && population! >= 0
    ? BASE_READS + population! * READS_PER_LIST_ROW : BASE_READS;
  if (!Number.isSafeInteger(d1RowsRead)) return null;
  return Object.freeze({ workerRequests: 1, d1RowsRead, d1RowsWritten: BASE_WRITES,
    ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
}

async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export type ApiKeyAdminTarget = Readonly<{ id?: string; name?: string; idempotencyHash?: string; payloadHash?: string }>;
export type ApiKeyAdminAdmission = Readonly<{
  status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'unavailable';
  commit?: ApiKeyAdminCommit;
  idempotencyHash?: string;
  payloadHash?: string;
}>;

type Input = Readonly<{
  env: Env; deps: TenantRequestDeps; payload: JWTPayload; operation: ApiKeyAdminOperation; target: ApiKeyAdminTarget;
  capability: CapabilityWriteFence; idempotencyKey?: string; now: () => number;
}>;

function targetValid(operation: ApiKeyAdminOperation, target: ApiKeyAdminTarget): boolean {
  if (operation === 'api-key.list') return Object.keys(target).length === 0;
  if (operation === 'api-key.delete') return typeof target.id === 'string' && target.id.length > 0 && target.id.length <= 160;
  return typeof target.name === 'string' && target.name.length > 0 && new TextEncoder().encode(target.name).length <= 512;
}

/**
 * A bounded receipt lookup runs only after current credential, MFA and
 * capability authorization. The receipt contains metadata, never a secret.
 */
export async function admitApiKeyAdmin(input: Input): Promise<ApiKeyAdminAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const mode = staffTicketAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  const sessionVersion = input.payload.session_version;
  if (mode !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || input.payload.sub !== input.deps.scope.actorId
    || (input.payload.role !== 'admin' && input.payload.role !== 'agent') || typeof sessionVersion !== 'number'
    || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(input.payload.exp) || input.payload.mfa_verified !== true
    || !targetValid(input.operation, input.target) || input.capability.capability !== 'api-keys.manage'
    || (input.operation === 'api-key.create' && !/^[A-Za-z0-9._~-]{1,128}$/.test(input.idempotencyKey ?? ''))) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const credential: SessionBudgetCredential = Object.freeze({ tenantId: input.deps.scope.tenantId, actorId: input.payload.sub,
    role: input.payload.role, sessionVersion, expiresAt: input.payload.exp, mfaVerified: true });
  const repository = new ApiKeyAdminRepository(input.deps.scope, input.deps.database);
  const sessions = new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope);
  try {
    if (!await sessions.authorize(credential, { capability: input.capability }, input.now())) {
      return { status: 'rejected', reason: 'unavailable' };
    }
    let target = input.target;
    let idempotencyHash: string | undefined;
    let payloadHash: string | undefined;
    if (input.operation === 'api-key.create') {
      idempotencyHash = await digest(['api-key-create-idempotency-v1', input.idempotencyKey]);
      payloadHash = await digest(['api-key-create-payload-v1', input.target.name]);
      target = { name: input.target.name, idempotencyHash, payloadHash };
    }
    const population = input.operation === 'api-key.list' ? await repository.population() : undefined;
    const business = apiKeyAdminEnvelope(input.operation, population);
    if (!business) return { status: 'rejected', reason: 'unavailable' };
    const requestKey = await digest(['api-key-admin-v1', input.operation, input.deps.scope.tenantId,
      input.deps.scope.actorId, target, population ?? null, input.capability]);
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: input.deps.repositories.budgetAuthority,
      sessions, namespace: input.env.BUDGET_COORDINATOR_DO, scope: input.deps.scope, credential,
      requirements: { capability: input.capability }, intent: {
        // The client idempotency key identifies one credential receipt. Each
        // HTTP execution is a separate bounded resource operation, including a
        // metadata-only receipt replay after an uncertain response.
        operationId: crypto.randomUUID(), operationFingerprint: requestKey, workScopeKey: input.operation,
      }, business, now: input.now });
    if ((outcome.status !== 'spent' && outcome.status !== 'idempotent') || !outcome.commitAuthority) {
      return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
    }
    return { status: 'admitted', idempotencyHash, payloadHash, commit: Object.freeze({ operation: input.operation,
      requestKey, credential, capability: Object.freeze(structuredClone(input.capability)), target: Object.freeze(structuredClone(target)),
      ...(population !== undefined ? { population } : {}), authority: outcome.commitAuthority }) };
  } catch {
    return { status: 'rejected', reason: 'unavailable' };
  }
}

export async function apiKeyCandidate(name: string): Promise<ApiKeyCandidate> {
  const random = (length: number) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, byte => chars[byte % chars.length]).join('');
  };
  const prefix = random(8);
  const apiKey = `lt_${prefix}.${random(32)}`;
  const keyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({ id: crypto.randomUUID(), name, prefix, keyHash, apiKey,
    permissions: Object.freeze(['tickets:read']), createdAt: new Date().toISOString() });
}

export function settleApiKeyAdmin(commit: ApiKeyAdminCommit, outcome: 'committed' | 'unknown', now: number): void {
  apiTicketBudgetCache.settleOperation(commit.authority, outcome, now);
}
