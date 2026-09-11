import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import { canonicalMutationJson } from './ticket-mutation-replay.service';
import { AdminSettingsMutationRepository, type AdminSettingsMutationNamespace, type AdminSettingsMutationOperation, type AdminSettingsMutationCommit } from '../repositories/admin-settings-mutation.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential, type SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { SessionBudgetAdmissionService } from '../budgets/session-admission.service';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';

export const ADMIN_SETTINGS_READ_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({ workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 8, logEvents: 128 });
export const ADMIN_SETTINGS_MUTATION_ENVELOPE: Readonly<ResourceAmounts> = Object.freeze({ workerRequests: 1, d1RowsRead: 2_560, d1RowsWritten: 128, logEvents: 128 });
export type AdminSettingsBudgetOperation = 'dashboard.settings.read' | 'dashboard.settings.theme.read' | 'dashboard.permissions.read' | AdminSettingsMutationOperation;
export class AdminSettingsMutationError extends Error { constructor(readonly status: 400 | 409 | 429 | 503, readonly code: string, message: string) { super(message); } }
const unavailable = () => new AdminSettingsMutationError(503, 'budget_admission_unavailable', 'Budget admission authority is unavailable');
const exhausted = () => new AdminSettingsMutationError(429, 'budget_exhausted', 'Configured budget capacity is exhausted');
const conflict = () => new AdminSettingsMutationError(409, 'idempotency_conflict', 'Idempotency key was already used with a different payload');
const invalid = () => new AdminSettingsMutationError(400, 'invalid_mutation', 'Invalid configuration mutation');
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join(''); }

type Attempt = { ns: AdminSettingsMutationNamespace; requirements: SessionBudgetRequirements; intent: { operationId: string; operationFingerprint: string; workScopeKey: string }; authority?: BudgetCommitAuthority; started: boolean; keyed: boolean; replay?: { status: 200; body: Record<string, unknown> } };

/** Owns admission, the immutable receipt and local-grant settlement for the bounded configuration family. */
export class AdminSettingsMutationService {
  private readonly repo: AdminSettingsMutationRepository;
  private readonly sessions: SessionBudgetAuthorityRepository;
  private readonly attempts = new WeakMap<object, Attempt>();
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope, private readonly credential: SessionBudgetCredential,
    private readonly budget: { service: SessionBudgetAdmissionService; repository: BudgetAuthorityRepository; namespace: DurableObjectNamespace; now: () => number; settle: (authority: BudgetCommitAuthority, outcome: 'committed' | 'unknown', now: number) => void }) {
    this.repo = new AdminSettingsMutationRepository(db, scope); this.sessions = new SessionBudgetAuthorityRepository(db, scope);
  }
  private async authorize(requirements: SessionBudgetRequirements) { if (!await this.sessions.authorize(this.credential, requirements, this.budget.now())) throw unavailable(); }
  private async admit(operation: AdminSettingsBudgetOperation, requirements: SessionBudgetRequirements, intent: Attempt['intent'], business: ResourceAmounts) {
    await this.authorize(requirements);
    const result = await this.budget.service.admit({ repository: this.budget.repository, sessions: this.sessions, namespace: this.budget.namespace,
      scope: this.scope, credential: this.credential, requirements, intent, business, now: this.budget.now });
    if (result.status === 'rejected') throw (result.reason === 'exhausted' || result.reason === 'capacity-exhausted' ? exhausted() : unavailable());
    if (!result.commitAuthority || result.commitAuthority.operationId !== intent.operationId || result.commitAuthority.operationFingerprint !== intent.operationFingerprint) throw unavailable();
    return result.commitAuthority;
  }
  async read(operation: Extract<AdminSettingsBudgetOperation, `${string}.read`>, capability: SessionBudgetRequirements['capability']): Promise<void> {
    const requirements = Object.freeze({ capability }); await this.authorize(requirements);
    const intent = Object.freeze({ operationId: crypto.randomUUID(), operationFingerprint: await digest(`admin-settings-read-v1\n${operation}\n${this.scope.tenantId}\n${this.credential.actorId}`), workScopeKey: operation });
    const authority = await this.admit(operation, requirements, intent, ADMIN_SETTINGS_READ_ENVELOPE);
    try {
      const statements = this.repo.fence(this.db, { credential: this.credential, requirements, authority,
        namespace: { principalId: this.credential.actorId, operation: 'dashboard.settings.update', keyHash: intent.operationId, payloadHash: intent.operationFingerprint } });
      const results = await this.db.batch<{ accepted: number }>([...statements, this.db.prepare('SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?').bind(this.scope.tenantId)]);
      if (results.at(-1)?.results[0]?.accepted !== 1) throw unavailable();
      this.budget.settle(authority, 'committed', this.budget.now());
    } catch (error) { this.budget.settle(authority, 'unknown', this.budget.now()); throw error; }
  }
  async prepare(operation: AdminSettingsMutationOperation, capability: NonNullable<SessionBudgetRequirements['capability']>, payload: unknown, key?: string): Promise<object> {
    if (key !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(key)) throw invalid();
    const serialized = canonicalMutationJson(payload);
    if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) throw invalid();
    const requirements = Object.freeze({ capability }); await this.authorize(requirements);
    const payloadHash = await digest(`admin-settings-mutation-v1\n${serialized}`);
    const ns = Object.freeze({ principalId: this.credential.actorId, operation, keyHash: await digest(key ?? `server:${crypto.randomUUID()}`), payloadHash });
    const receipt = await this.repo.findActive(ns);
    if (receipt && receipt.payload_hash !== payloadHash) throw conflict();
    const prepared = Object.freeze({});
    this.attempts.set(prepared, { ns, requirements, intent: Object.freeze({ operationId: ns.keyHash, operationFingerprint: payloadHash, workScopeKey: operation }), started: false, keyed: key !== undefined,
      ...(receipt ? { replay: { status: 200, body: JSON.parse(receipt.response_snapshot) as Record<string, unknown> } } : {}) });
    return prepared;
  }
  async commit(prepared: object, execute: (repository: AdminSettingsMutationRepository, commit: AdminSettingsMutationCommit) => Promise<string>): Promise<{ status: 200; body: Record<string, unknown>; replayed: boolean; keyed: boolean }> {
    const attempt = this.attempts.get(prepared); if (!attempt) throw unavailable(); await this.authorize(attempt.requirements);
    if (attempt.replay) return { ...attempt.replay, replayed: true, keyed: attempt.keyed };
    const current = await this.repo.findActive(attempt.ns);
    if (current) { if (current.payload_hash !== attempt.ns.payloadHash) throw conflict(); return { status: 200, body: JSON.parse(current.response_snapshot), replayed: true, keyed: attempt.keyed }; }
    if (attempt.started) throw unavailable(); attempt.authority = await this.admit(attempt.ns.operation, attempt.requirements, attempt.intent, ADMIN_SETTINGS_MUTATION_ENVELOPE); attempt.started = true;
    const commit = { credential: this.credential, requirements: attempt.requirements, authority: attempt.authority, namespace: attempt.ns };
    try {
      const snapshot = await execute(this.repo, commit); await this.authorize(attempt.requirements);
      this.budget.settle(attempt.authority, 'committed', this.budget.now());
      return { status: 200, body: JSON.parse(snapshot), replayed: false, keyed: attempt.keyed };
    } catch (error) {
      this.budget.settle(attempt.authority, 'unknown', this.budget.now());
      const winner = await this.repo.findActive(attempt.ns);
      if (winner) { if (winner.payload_hash !== attempt.ns.payloadHash) throw conflict(); return { status: 200, body: JSON.parse(winner.response_snapshot), replayed: true, keyed: attempt.keyed }; }
      throw error instanceof AdminSettingsMutationError ? error : unavailable();
    }
  }
}
