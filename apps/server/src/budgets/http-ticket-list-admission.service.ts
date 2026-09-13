import type { TicketQueueCountCommit } from '../repositories/ticket-queue-counts.repository';
import { BudgetGrantRecoveryService } from './budget-grant-recovery.service';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import type { TicketQueueKey } from '../types/ticket-queue';
import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { JWTPayload } from '../types';
import { CustomerCurrentCredentialRepository, type CustomerBudgetCredential } from '../repositories/customer-current-credential.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { TicketListScanError, TicketListScanRepository, type TicketListScanSnapshot } from '../repositories/ticket-list-scan.repository';
import { apiTicketBudgetCache, customerTicketAdmissionMode, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export type HttpTicketListOperation = 'dashboard.ticket.list' | 'dashboard.ticket.queue-counts' | 'portal.ticket.list';
export type HttpTicketListAdmission = Readonly<{
  status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'unavailable';
  snapshot?: TicketListScanSnapshot;
  commit?:TicketQueueCountCommit;
  budgetAuthority?: BudgetCommitAuthority;
}>;

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  payload: JWTPayload;
  operation: HttpTicketListOperation;
  filterId?: string;
  search?: string;
  queue?: TicketQueueKey;
  draftNotExpiredAt?:string;
  now: () => number;
}>;

const COUNTER_BYTE_READ_UNIT = 256;
const FIXED_LIST_ADMISSION_READS = 4_096 + 512;

function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}
function safeAdd(...values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
    total += value;
  }
  return total;
}
function scaled(value: number, factor: number): number | null {
  return Number.isSafeInteger(value) && Number.isSafeInteger(factor) && value >= 0 && factor >= 0 && value <= Math.floor(Number.MAX_SAFE_INTEGER / factor)
    ? value * factor : null;
}
function byteReadUnits(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? Math.ceil(value / COUNTER_BYTE_READ_UNIT) : null;
}

/**
 * Count and page retain their historical full candidate semantics.  The
 * maintained counters turn that variable work into an explicit reservation:
 * two ticket passes, two article passes for substring search, optional
 * group-membership lookups in both passes, and a conservative byte-equivalent D1-read margin.
 */
export function ticketListEnvelope(snapshot: TicketListScanSnapshot, input: { search?: string; groupRestricted: boolean; queue?: TicketQueueKey; aggregateCounts?: boolean }): ResourceAmounts | null {
  const articlePasses = input.search ? scaled(snapshot.articleRows, 2) : 0;
  const articleBytes = input.search ? scaled(snapshot.articleSearchBytes, 2) : 0;
  // Each statement may also probe the covering (tenant,user,group) membership PK.
  const ticketPasses = scaled(snapshot.ticketRows, input.groupRestricted ? 4 : 2);
  const ticketBytes = scaled(snapshot.ticketSearchBytes, 2);
  const byteUnits = safeAdd(byteReadUnits(ticketBytes ?? -1) ?? -1, byteReadUnits(articleBytes ?? -1) ?? -1,
    byteReadUnits(snapshot.filter?.conditionBytes ?? 0) ?? -1);
  // Lists probe each membership in count and page; aggregates probe it once.
  // Reserve index plus row per exact ticket lookup, independent of history population.
  const draftReads = input.aggregateCounts ? scaled(snapshot.ticketRows, 2) : input.queue === 'drafts' ? scaled(snapshot.ticketRows, 4) : 0;
  const mentionReads = input.aggregateCounts ? scaled(snapshot.ticketRows, 2) : input.queue === 'mentions' ? scaled(snapshot.ticketRows, 4) : 0;
  // Two materialized passes consume visible rows and then stored classification flags.
  const materializedReads = input.aggregateCounts ? scaled(snapshot.ticketRows, 2) : 0;
  // Lists probe state/definition in count and page. Aggregate flags probe them
  // once for actionable and once for snoozed; both require eight units per ticket.
  const supportStateReads = input.aggregateCounts || input.queue && ['actionable', 'snoozed', 'mine', 'unassigned', 'mentions'].includes(input.queue)
    ? scaled(snapshot.ticketRows, 8) : 0;
  const reads = safeAdd(FIXED_LIST_ADMISSION_READS, ticketPasses ?? -1, articlePasses ?? -1, byteUnits ?? -1, draftReads ?? -1, supportStateReads ?? -1, mentionReads ?? -1, materializedReads ?? -1);
  if (reads === null) return null;
  return Object.freeze({ workerRequests: 1, d1RowsRead: reads, d1RowsWritten:16,
    ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }) });
}

async function digest(parts: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}
function rejected(outcome: { status: string; reason?: string; commitAuthority?: BudgetCommitAuthority }, snapshot: TicketListScanSnapshot, operationId:string, fingerprint:string): HttpTicketListAdmission {
  if ((outcome.status === 'spent' || outcome.status === 'idempotent') && outcome.commitAuthority?.operationId===operationId && outcome.commitAuthority.operationFingerprint===fingerprint) return { status: 'admitted', snapshot, budgetAuthority:outcome.commitAuthority };
  return { status: 'rejected', snapshot, reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
}

/** Current credential first; the counter read is admission metadata, never a ticket/article list. */
export async function admitHttpTicketList(input: AdmissionInput): Promise<HttpTicketListAdmission> {
  if (input.env.BUDGET_ADMISSION_POLICY === undefined) return { status: 'disabled' };
  const staff = input.operation === 'dashboard.ticket.list' || input.operation === 'dashboard.ticket.queue-counts';
  const mode = staff ? staffTicketAdmissionMode(input.env) : customerTicketAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'enabled' || !input.env.BUDGET_COORDINATOR_DO || !safeIdentity(input.deps.scope.tenantId)
    || input.payload.sub !== input.deps.scope.actorId || (input.filterId !== undefined && !safeIdentity(input.filterId))) {
    return { status: 'rejected', reason: 'unavailable' };
  }
  try {
    let snapshot: TicketListScanSnapshot;
    if (staff) {
      const sessionVersion = input.payload.session_version;
      if ((input.payload.role !== 'admin' && input.payload.role !== 'agent') || typeof sessionVersion !== 'number'
        || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(input.payload.exp) || input.payload.mfa_verified !== true) {
        return { status: 'rejected', reason: 'unavailable' };
      }
      const credential: SessionBudgetCredential = { tenantId: input.deps.scope.tenantId, actorId: input.payload.sub,
        role: input.payload.role, sessionVersion, expiresAt: input.payload.exp, mfaVerified: true };
      // Do not read accounting metadata for a revoked principal.
      if (!await new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope).authorize(credential, {}, input.now())) {
        return { status: 'rejected', reason: 'unavailable' };
      }
      snapshot = await new TicketListScanRepository(input.deps.database, input.deps.scope).snapshot(input.filterId);
      const business = ticketListEnvelope(snapshot, { search: input.search, groupRestricted: credential.role === 'agent', queue: input.queue, aggregateCounts: input.operation === 'dashboard.ticket.queue-counts' });
      if (!business) return { status: 'rejected', reason: 'unavailable' };
      const fingerprint = await digest(['http-ticket-list-v1', input.operation, input.deps.scope.tenantId, input.deps.scope.actorId,
        input.filterId ?? null, input.search ?? null, input.queue ?? null, ...(input.operation==='dashboard.ticket.queue-counts'?[input.draftNotExpiredAt ?? null]:[]), snapshot]);
      const operationId=crypto.randomUUID();
      const outcome=await sessionTicketBudgetAdmission.admit({ database:input.deps.database, repository: input.deps.repositories.budgetAuthority,
        sessions: new SessionBudgetAuthorityRepository(input.deps.database, input.deps.scope), namespace: input.env.BUDGET_COORDINATOR_DO,
        scope: input.deps.scope, credential, requirements: {},
        intent: { operationId, operationFingerprint: fingerprint, workScopeKey: input.operation }, business, now: input.now });
      const admission=rejected(outcome,snapshot,operationId,fingerprint);
      if(input.operation==='dashboard.ticket.queue-counts'&&admission.status==='admitted'&&admission.budgetAuthority){
        return {status:'admitted',snapshot,commit:Object.freeze({operation:input.operation,requestKey:fingerprint,credential,snapshot,
          draftNotExpiredAt:input.draftNotExpiredAt,authority:admission.budgetAuthority})};
      }
      return admission;
    }
    const sessionVersion = input.payload.session_version, email = input.payload.email;
    if (input.payload.role !== 'customer' || typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion)
      || !Number.isSafeInteger(input.payload.exp) || !safeIdentity(email)) return { status: 'rejected', reason: 'unavailable' };
    const credential: CustomerBudgetCredential = { tenantId: input.deps.scope.tenantId, actorId: input.payload.sub,
      role: 'customer', sessionVersion, expiresAt: input.payload.exp, email };
    if (!await new CustomerCurrentCredentialRepository(input.deps.database, input.deps.scope).authorize(credential, {}, input.now())) {
      return { status: 'rejected', reason: 'unavailable' };
    }
    snapshot = await new TicketListScanRepository(input.deps.database, input.deps.scope).snapshot();
    const business = ticketListEnvelope(snapshot, { groupRestricted: false });
    if (!business) return { status: 'rejected', reason: 'unavailable' };
    const fingerprint = await digest(['http-ticket-list-v1', input.operation, input.deps.scope.tenantId, input.deps.scope.actorId, snapshot]);
    const operationId=crypto.randomUUID();
    const authorization={authorize:(scope:TenantRequestDeps['scope'])=>scope.tenantId===input.deps.scope.tenantId&&scope.actorId===input.deps.scope.actorId
      ?new CustomerCurrentCredentialRepository(input.deps.database,input.deps.scope).authorize(credential,{},input.now()):Promise.resolve(null)};
    const credentialKey=`customer-list:${input.deps.scope.tenantId}:${input.payload.sub}`;
    const recovery=new BudgetGrantRecoveryService(input.deps.database,input.deps.repositories.budgetAuthority,input.env.BUDGET_COORDINATOR_DO,input.deps.scope,{credentialKey,authorization});
    return rejected(await apiTicketBudgetCache.admit({ repository: input.deps.repositories.budgetAuthority,
      namespace: input.env.BUDGET_COORDINATOR_DO, scope: input.deps.scope,
      credentialKey,
      intent: { operationId, operationFingerprint: fingerprint, workScopeKey: input.operation }, business, now: input.now,
      authorization,recoverGrant:(sealed,now)=>recovery.recover(sealed,now),
    }), snapshot,operationId,fingerprint);
  } catch (error) {
    if (error instanceof TicketListScanError) return { status: 'rejected', reason: 'unavailable' };
    return { status: 'rejected', reason: 'unavailable' };
  }
}

export function settleTicketQueueCounts(commit:TicketQueueCountCommit,outcome:'committed'|'unknown',now:number):void {
  apiTicketBudgetCache.settleOperation(commit.authority,outcome,now);
}

export function settleHttpTicketList(admission:HttpTicketListAdmission,outcome:'committed'|'unknown',now:number):void {
  if(admission.status==='admitted'&&admission.budgetAuthority)apiTicketBudgetCache.settleOperation(admission.budgetAuthority,outcome,now);
}
