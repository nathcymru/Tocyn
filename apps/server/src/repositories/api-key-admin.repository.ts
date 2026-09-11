import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { resolveCapability, type CapabilityWriteFence } from '../auth/capability-policy';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { VerifiedTenantScope } from '../types/tenant';
import { budgetCommitConstraint } from './budget-commit-fence';
import { MAX_SESSION_BUDGET_GROUPS, type SessionBudgetCredential } from './session-budget-authority.repository';

export type ApiKeyAdminOperation = 'api-key.list' | 'api-key.create' | 'api-key.delete';
export type ApiKeyMetadata = Readonly<{
  id: string; name: string; prefix: string; is_active?: number | boolean; created_at: string; last_used_at?: string | null;
}>;
export type ApiKeyCreationReceipt = Readonly<{
  payload_hash: string; api_key_id: string; name: string; prefix: string; created_at: string;
}>;
export type ApiKeyCandidate = Readonly<{
  id: string; name: string; prefix: string; keyHash: string; apiKey: string; permissions: readonly string[]; createdAt: string;
}>;
export type ApiKeyAdminCommit = Readonly<{
  operation: ApiKeyAdminOperation; requestKey: string; credential: SessionBudgetCredential; capability: CapabilityWriteFence;
  target: Readonly<{ id?: string; name?: string; idempotencyHash?: string; payloadHash?: string }>;
  population?: number; authority: BudgetCommitAuthority;
}>;

type Constraint = Readonly<{ sql: string; values: unknown[] }>;
export class ApiKeyAdminFenceError extends Error {}

function boundedCapabilityConstraint(fence: CapabilityWriteFence, scope: VerifiedTenantScope): Constraint {
  const groups = `SELECT m.group_id,r.enabled,r.revision FROM
    (SELECT group_id FROM user_groups WHERE tenant_id=? AND user_id=? ORDER BY group_id COLLATE BINARY LIMIT ${MAX_SESSION_BUDGET_GROUPS + 1}) m
    LEFT JOIN tenant_group_capability_constraints r ON r.tenant_id=? AND r.group_id=m.group_id AND r.capability=?`;
  const groupValues = [scope.tenantId, scope.actorId, scope.tenantId, fence.capability];
  return { sql: `EXISTS (SELECT 1 FROM deployment_capability_ceiling o
    JOIN deployment_role_capability_grants r ON r.capability=o.capability AND r.role=?
    LEFT JOIN tenant_role_capability_policies t ON t.tenant_id=? AND t.role=? AND t.capability=o.capability
    WHERE o.capability=? AND o.enabled=1 AND r.enabled=1 AND (?<>'agent' OR t.enabled=1)
      AND (SELECT count(*) FROM (${groups}))<=${MAX_SESSION_BUDGET_GROUPS}
      AND NOT EXISTS (SELECT 1 FROM (${groups}) WHERE enabled=0)
      AND json_array(o.revision,r.revision,CASE WHEN ?='agent' THEN t.revision ELSE NULL END,
        json((SELECT json_group_array(json_array(group_id,revision)) FROM (${groups} ORDER BY m.group_id COLLATE BINARY) WHERE enabled IS NOT NULL)),CAST(? AS INTEGER))=?)`,
    values: [fence.role, scope.tenantId, fence.role, fence.capability, fence.role,
      ...groupValues, ...groupValues, fence.role, ...groupValues, fence.sessionVersion, fence.policyFingerprint] };
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

function grantStatements(db: D1Database, scope: VerifiedTenantScope, authority: BudgetCommitAuthority): readonly D1PreparedStatement[] {
  const grant = authority.grant;
  const linked = grant && [grant.tenantId, grant.aggregateId, grant.reservationId, grant.holderId,
    grant.operationId, grant.operationFingerprint].every(identity)
    && grant.operationId === authority.operationId && grant.operationFingerprint === authority.operationFingerprint
    && grant.tenantId === authority.snapshot.tenant_id;
  const operation = db.prepare(`INSERT INTO budget_grant_operations
    (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
    SELECT ?,?,?,?,?,?,? WHERE ?=1 AND NOT EXISTS (SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=?)
    ON CONFLICT(tenant_id,reservation_id,holder_id,operation_id) DO UPDATE SET operation_id=excluded.operation_id
      WHERE aggregate_id=excluded.aggregate_id AND operation_fingerprint=excluded.operation_fingerprint
        AND operation_envelope_json=excluded.operation_envelope_json`)
    .bind(scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '', grant?.operationId ?? '', grant?.aggregateId ?? '',
      grant?.operationFingerprint ?? '', JSON.stringify(grant?.operationEnvelope ?? {}), linked ? 1 : 0,
      scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '');
  const exact = db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN ?=1 AND NOT EXISTS (SELECT 1 FROM budget_grant_closures
      WHERE tenant_id=? AND reservation_id=? AND holder_id=?) AND EXISTS (SELECT 1 FROM budget_grant_operations
      WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=? AND aggregate_id=?
        AND operation_fingerprint=? AND operation_envelope_json=?) THEN accepted ELSE 0 END WHERE tenant_id=?`)
    .bind(linked ? 1 : 0, scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '', scope.tenantId, grant?.reservationId ?? '',
      grant?.holderId ?? '', grant?.operationId ?? '', grant?.aggregateId ?? '', grant?.operationFingerprint ?? '',
      JSON.stringify(grant?.operationEnvelope ?? {}), scope.tenantId);
  return [operation, exact];
}

/** Canonical D1 boundary for metadata-only lists and one-key create/revoke operations. */
export class ApiKeyAdminRepository {
  constructor(private readonly scope: VerifiedTenantScope, private readonly db: D1Database) {}

  async capabilityFence(credential: SessionBudgetCredential): Promise<CapabilityWriteFence | null> {
    const capability = resolveCapability('api_keys');
    if (!capability || credential.tenantId !== this.scope.tenantId || credential.actorId !== this.scope.actorId
      || credential.sessionVersion !== this.scope.authVersion || !this.scope.roles.includes(credential.role)) return null;
    const [userResult, policyResult, groupResult] = await this.db.batch([
      this.db.prepare('SELECT role,session_version FROM users WHERE tenant_id=? AND id=? LIMIT 1').bind(this.scope.tenantId, this.scope.actorId),
      this.db.prepare(`SELECT o.enabled AS owner_enabled,o.revision AS owner_revision,r.enabled AS role_enabled,r.revision AS role_revision,
        t.enabled AS tenant_enabled,t.revision AS tenant_revision FROM deployment_capability_ceiling o
        LEFT JOIN deployment_role_capability_grants r ON r.capability=o.capability AND r.role=?
        LEFT JOIN tenant_role_capability_policies t ON t.tenant_id=? AND t.role=? AND t.capability=o.capability
        WHERE o.capability=? LIMIT 1`).bind(credential.role, this.scope.tenantId, credential.role, capability.id),
      this.db.prepare(`SELECT m.group_id,r.enabled,r.revision FROM
        (SELECT group_id FROM user_groups WHERE tenant_id=? AND user_id=? ORDER BY group_id COLLATE BINARY LIMIT ${MAX_SESSION_BUDGET_GROUPS + 1}) m
        LEFT JOIN tenant_group_capability_constraints r ON r.tenant_id=? AND r.group_id=m.group_id AND r.capability=?
        ORDER BY m.group_id COLLATE BINARY`).bind(this.scope.tenantId, this.scope.actorId, this.scope.tenantId, capability.id),
    ]);
    const user = userResult.results[0] as { role: string; session_version: number } | undefined;
    const policy = policyResult.results[0] as { owner_enabled: number; owner_revision: number; role_enabled: number | null; role_revision: number | null;
      tenant_enabled: number | null; tenant_revision: number | null } | undefined;
    const groups = groupResult.results as { group_id: string; enabled: number | null; revision: number | null }[];
    if (!user || user.role !== credential.role || user.session_version !== credential.sessionVersion || !policy
      || policy.owner_enabled !== 1 || policy.role_enabled !== 1 || (credential.role === 'agent' && policy.tenant_enabled !== 1)
      || groups.length > MAX_SESSION_BUDGET_GROUPS || groups.some(group => group.enabled === 0)) return null;
    const constrained = groups.filter(group => group.enabled !== null);
    return Object.freeze({ tenantId: this.scope.tenantId, actorId: this.scope.actorId, role: credential.role,
      sessionVersion: credential.sessionVersion, capability: capability.id,
      policyFingerprint: JSON.stringify([policy.owner_revision, policy.role_revision,
        credential.role === 'agent' ? policy.tenant_revision : null,
        constrained.map(group => [group.group_id, group.revision]), credential.sessionVersion]) });
  }

  async population(): Promise<number> {
    const row = await this.db.prepare('SELECT key_count FROM api_key_admin_population WHERE tenant_id=?')
      .bind(this.scope.tenantId).first<{ key_count: number }>();
    const count = row?.key_count ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid API-key population');
    return count;
  }

  private authority(commit: ApiKeyAdminCommit, operation: ApiKeyAdminOperation,
    target: ApiKeyAdminCommit['target']): Constraint {
    const credential = commit.credential;
    const valid = commit.operation === operation && JSON.stringify(commit.target) === JSON.stringify(target)
      && commit.requestKey === commit.authority.operationFingerprint && credential.tenantId === this.scope.tenantId
      && credential.actorId === this.scope.actorId && this.scope.roles.includes(credential.role)
      && credential.sessionVersion === this.scope.authVersion && credential.mfaVerified === true
      && Number.isSafeInteger(credential.sessionVersion) && Number.isSafeInteger(credential.expiresAt)
      && commit.capability.tenantId === credential.tenantId && commit.capability.actorId === credential.actorId
      && commit.capability.role === credential.role && commit.capability.sessionVersion === credential.sessionVersion;
    const budget = budgetCommitConstraint(commit.authority, this.scope.tenantId);
    const capability = boundedCapabilityConstraint(commit.capability, this.scope);
    const sql = [`?=1`, `EXISTS (SELECT 1 FROM users WHERE tenant_id=? AND id=? AND role=? AND session_version=? AND mfa_enabled=1 AND ?>unixepoch())`,
      budget.sql, capability.sql];
    const values: unknown[] = [valid ? 1 : 0, this.scope.tenantId, credential.actorId, credential.role,
      credential.sessionVersion, credential.expiresAt, ...budget.values, ...capability.values];
    if (operation === 'api-key.list') {
      sql.push('?=1', 'COALESCE((SELECT key_count FROM api_key_admin_population WHERE tenant_id=?),0)<=?');
      values.push(Number.isSafeInteger(commit.population) && commit.population! >= 0 ? 1 : 0, this.scope.tenantId, commit.population ?? -1);
    } else if (commit.population !== undefined) sql.push('0');
    return { sql: sql.join(' AND '), values };
  }

  private guard(commit: ApiKeyAdminCommit, operation: ApiKeyAdminOperation, target: ApiKeyAdminCommit['target']) {
    const authority = this.authority(commit, operation, target);
    return this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ${authority.sql} THEN 1 ELSE 0 END)
      ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`).bind(this.scope.tenantId, ...authority.values);
  }

  private async batch(commit: ApiKeyAdminCommit, operation: ApiKeyAdminOperation,
    target: ApiKeyAdminCommit['target'], statements: D1PreparedStatement[]) {
    try { return await this.db.batch([this.guard(commit, operation, target), ...grantStatements(this.db, this.scope, commit.authority), ...statements]); }
    catch { throw new ApiKeyAdminFenceError('API-key administration authority changed'); }
  }

  async list(commit: ApiKeyAdminCommit): Promise<ApiKeyMetadata[]> {
    const results = await this.batch(commit, 'api-key.list', {}, [this.db.prepare(
      `SELECT id,name,prefix,is_active,created_at,last_used_at FROM api_keys WHERE tenant_id=? ORDER BY created_at DESC,id`
    ).bind(this.scope.tenantId)]);
    return results[3].results as ApiKeyMetadata[];
  }

  async create(candidate: ApiKeyCandidate, idempotencyHash: string, payloadHash: string,
    commit: ApiKeyAdminCommit): Promise<{ kind: 'created'; value: ApiKeyCandidate } |
      { kind: 'unavailable'; receipt: ApiKeyCreationReceipt } | { kind: 'conflict'; receipt: ApiKeyCreationReceipt }> {
    const target = { name: candidate.name, idempotencyHash, payloadHash };
    const permissionString = candidate.permissions.join(',');
    const results = await this.batch(commit, 'api-key.create', target, [
      this.db.prepare(`INSERT OR IGNORE INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active,created_at)
        SELECT ?,?,?,?,?,?,1,? FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1`)
        .bind(this.scope.tenantId, candidate.id, candidate.name, candidate.keyHash, candidate.prefix, permissionString,
          candidate.createdAt, this.scope.tenantId),
      this.db.prepare(`INSERT OR IGNORE INTO api_key_creation_receipts
        (tenant_id,actor_id,idempotency_hash,payload_hash,api_key_id,name,prefix,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
          AND EXISTS (SELECT 1 FROM api_keys WHERE tenant_id=? AND id=? AND key_hash=? AND name=? AND prefix=?)`)
        .bind(this.scope.tenantId, this.scope.actorId, idempotencyHash, payloadHash, candidate.id, candidate.name,
          candidate.prefix, candidate.createdAt, this.scope.tenantId, this.scope.tenantId, candidate.id,
          candidate.keyHash, candidate.name, candidate.prefix),
      this.db.prepare(`DELETE FROM api_keys WHERE tenant_id=? AND id=?
        AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
        AND NOT EXISTS (SELECT 1 FROM api_key_creation_receipts WHERE tenant_id=? AND actor_id=?
          AND idempotency_hash=? AND payload_hash=? AND api_key_id=? AND name=? AND prefix=?)`)
        .bind(this.scope.tenantId, candidate.id, this.scope.tenantId, this.scope.tenantId, this.scope.actorId,
          idempotencyHash, payloadHash, candidate.id, candidate.name, candidate.prefix),
      this.db.prepare(`SELECT r.payload_hash,r.api_key_id,r.name,r.prefix,r.created_at FROM api_key_creation_receipts r
        WHERE r.tenant_id=? AND r.actor_id=? AND r.idempotency_hash=?
          AND EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) LIMIT 1`)
        .bind(this.scope.tenantId, this.scope.actorId, idempotencyHash, this.scope.tenantId),
    ]);
    const receipt = results[6].results?.[0] as ApiKeyCreationReceipt | undefined;
    if (!receipt) throw new ApiKeyAdminFenceError('API-key creation did not commit');
    if (receipt.payload_hash !== payloadHash) return { kind: 'conflict', receipt };
    if (receipt.api_key_id !== candidate.id) return { kind: 'unavailable', receipt };
    return { kind: 'created', value: candidate };
  }

  async delete(id: string, commit: ApiKeyAdminCommit): Promise<void> {
    await this.batch(commit, 'api-key.delete', { id }, [this.db.prepare(
      `DELETE FROM api_keys WHERE tenant_id=? AND id=? AND EXISTS
        (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`
    ).bind(this.scope.tenantId, id, this.scope.tenantId)]);
  }
}
