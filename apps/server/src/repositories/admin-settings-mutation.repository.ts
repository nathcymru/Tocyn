import { formatAgentPolicy } from './capability-policy.repository';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { SessionBudgetCredential, SessionBudgetRequirements } from './session-budget-authority.repository';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { staffMutationStatements } from './staff-ticket-mutation.repository';
import { CAPABILITY_CATALOG, resolveCapability } from '../auth/capability-policy';

export type AdminSettingsMutationOperation = 'dashboard.settings.update' | 'dashboard.settings.theme.update' | 'dashboard.permissions.update';
export type AdminSettingsMutationNamespace = Readonly<{ principalId: string; operation: AdminSettingsMutationOperation; keyHash: string; payloadHash: string }>;
export type AdminSettingsMutationCommit = Readonly<{ credential: SessionBudgetCredential; requirements: SessionBudgetRequirements; authority: BudgetCommitAuthority; namespace: AdminSettingsMutationNamespace; agentRows?: number }>;
type Receipt = Readonly<{ payload_hash: string; response_status: 200; response_snapshot: string }>;

const where = 'tenant_id=? AND principal_id=? AND operation=? AND key_hash=?';
const values = (scope: VerifiedTenantScope, ns: AdminSettingsMutationNamespace) => [scope.tenantId, ns.principalId, ns.operation, ns.keyHash];
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

/**
 * Adds the durable operation link after the existing bounded current-session,
 * MFA, capability and exact budget-policy assertion.  A configuration write
 * may only observe `accepted=1` after this link exists in the same batch.
 */
export function adminSettingsFenceStatements(db: D1Database, scope: VerifiedTenantScope, commit: AdminSettingsMutationCommit): D1PreparedStatement[] {
  const base = staffMutationStatements(db, scope, { credential: commit.credential, requirements: commit.requirements, authority: commit.authority })[0];
  const grant = commit.authority.grant;
  const linked = !!grant && identity(grant.tenantId) && identity(grant.aggregateId) && identity(grant.reservationId)
    && identity(grant.holderId) && identity(grant.operationId) && identity(grant.operationFingerprint)
    && grant.tenantId === scope.tenantId && grant.operationId === commit.authority.operationId
    && grant.operationFingerprint === commit.authority.operationFingerprint;
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
  const exact = db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN EXISTS (SELECT 1 FROM budget_grant_operations
    WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=? AND aggregate_id=?
      AND operation_fingerprint=? AND operation_envelope_json=?) THEN 1 ELSE 0 END WHERE tenant_id=?`)
    .bind(scope.tenantId, grant?.reservationId ?? '', grant?.holderId ?? '', grant?.operationId ?? '', grant?.aggregateId ?? '',
      grant?.operationFingerprint ?? '', JSON.stringify(grant?.operationEnvelope ?? {}), scope.tenantId);
  return [base, operation, exact];
}

export class AdminSettingsMutationRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}
  async agentPopulation(): Promise<number> {
    const row=await this.db.prepare('SELECT agent_rows FROM admin_agent_population WHERE tenant_id=?').bind(this.scope.tenantId).first<{agent_rows:number}>();
    const count=row?.agent_rows ?? 0;
    if (!Number.isSafeInteger(count) || count<0) throw new Error('Invalid agent population');
    return count;
  }
  async readSettings(commit: AdminSettingsMutationCommit, keys: readonly string[]): Promise<Record<string,string>> {
    if (!keys.length || keys.length>64) throw new Error('Invalid settings key inventory');
    const result = await this.db.batch<{key:string;value:string}>([...this.fence(this.db,commit),
      this.db.prepare(`SELECT key,value FROM tenant_config WHERE tenant_id=? AND key IN (${keys.map(()=>'?').join(',')})`).bind(this.scope.tenantId,...keys)]);
    return Object.fromEntries((result.at(-1)?.results ?? []).map(row=>[row.key,row.value]));
  }
  async readPolicy(commit: AdminSettingsMutationCommit) {
    const ids=CAPABILITY_CATALOG.map(capability=>capability.id), slots=ids.map(()=>'?').join(',');
    const result=await this.db.batch<any>([...this.fence(this.db,commit),
      this.db.prepare(`SELECT capability,enabled,revision FROM deployment_capability_ceiling WHERE capability IN (${slots})`).bind(...ids),
      this.db.prepare(`SELECT capability,enabled,revision FROM deployment_role_capability_grants WHERE role='agent' AND capability IN (${slots})`).bind(...ids),
      this.db.prepare(`SELECT capability,enabled,revision FROM tenant_role_capability_policies WHERE tenant_id=? AND role='agent' AND capability IN (${slots})`).bind(this.scope.tenantId,...ids),
      this.db.prepare("SELECT revision FROM tenant_capability_policy_versions WHERE tenant_id=? AND role='agent'").bind(this.scope.tenantId)]);
    return formatAgentPolicy(result.at(-4)?.results ?? [],result.at(-3)?.results ?? [],result.at(-2)?.results ?? [],result.at(-1)?.results[0]?.revision ?? 1);
  }
  async findActive(ns: AdminSettingsMutationNamespace): Promise<Receipt | null> {
    if (ns.principalId !== this.scope.actorId) return null;
    return this.db.prepare(`SELECT payload_hash,response_status,response_snapshot FROM admin_settings_mutation_receipts
      WHERE ${where} AND expires_at>unixepoch()`).bind(...values(this.scope, ns)).first<Receipt>();
  }
  fence(db: D1Database, commit: AdminSettingsMutationCommit) { return adminSettingsFenceStatements(db, this.scope, commit); }
  cleanup(db: D1Database, ns: AdminSettingsMutationNamespace): D1PreparedStatement[] {
    return [db.prepare(`DELETE FROM admin_settings_mutation_receipts WHERE ${where} AND expires_at<=unixepoch()`).bind(...values(this.scope, ns)),
      db.prepare(`DELETE FROM admin_settings_mutation_receipts WHERE rowid IN (SELECT rowid FROM admin_settings_mutation_receipts
        WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 99)`).bind(this.scope.tenantId, ns.principalId)];
  }
  receipt(db: D1Database, ns: AdminSettingsMutationNamespace, snapshot: string, condition: {sql:string;values:unknown[]} = {sql:"1",values:[]}): D1PreparedStatement {
    return db.prepare(`INSERT INTO admin_settings_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot)
      SELECT ?,?,?,?,?,200,? WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1) AND (${condition.sql})
      RETURNING response_snapshot`).bind(...values(this.scope, ns), ns.payloadHash, snapshot, this.scope.tenantId,...condition.values);
  }
  settingWrite(db: D1Database, key: string, value: string): D1PreparedStatement {
    return db.prepare(`INSERT INTO tenant_config (tenant_id,key,value,updated_at)
      SELECT ?,?,?,CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)
      ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`)
      .bind(this.scope.tenantId, key, value, this.scope.tenantId);
  }
  async commitSettings(commit: AdminSettingsMutationCommit, updates: Readonly<Record<string, string>>, snapshot: string): Promise<string> {
    const statements = [...this.fence(this.db, commit), ...this.cleanup(this.db, commit.namespace),
      ...Object.entries(updates).map(([key, value]) => this.settingWrite(this.db, key, value)), this.receipt(this.db, commit.namespace, snapshot)];
    const results = await this.db.batch<{ response_snapshot: string }>(statements);
    const value = results.at(-1)?.results[0]?.response_snapshot;
    if (!value) throw new Error('configuration commit was not admitted');
    return value;
  }
  async commitAgentPolicy(commit: AdminSettingsMutationCommit, revision: number, policies: Readonly<Record<string, boolean>>, snapshot: string): Promise<{ updated: boolean; snapshot?: string }> {
    const entries = Object.entries(policies);
    if (entries.length > CAPABILITY_CATALOG.length || entries.some(([key]) => !CAPABILITY_CATALOG.some(capability => capability.legacyKey === key))) return { updated: false };
    const token = crypto.randomUUID();
    const accepted = `EXISTS (SELECT 1 FROM budget_mutation_assertion WHERE tenant_id=? AND accepted=1)`;
    const ensure = this.db.prepare(`INSERT OR IGNORE INTO tenant_capability_policy_versions (tenant_id,role,revision,change_token,updated_at)
      SELECT ?,'agent',1,'',CURRENT_TIMESTAMP WHERE ${accepted}`).bind(this.scope.tenantId, this.scope.tenantId);
    const version = this.db.prepare(`UPDATE tenant_capability_policy_versions SET revision=revision+1,change_token=?,updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND role='agent' AND revision=? AND ${accepted}`).bind(token, this.scope.tenantId, revision, this.scope.tenantId);
    const writes = entries.map(([legacyKey, allowed]) => this.db.prepare(`INSERT INTO tenant_role_capability_policies
      (tenant_id,role,capability,enabled,revision,updated_at) SELECT ?,'agent',?,?,1,CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM tenant_capability_policy_versions WHERE tenant_id=? AND role='agent' AND change_token=?)
      ON CONFLICT(tenant_id,role,capability) DO UPDATE SET enabled=excluded.enabled,revision=tenant_role_capability_policies.revision+1,updated_at=CURRENT_TIMESTAMP`)
      .bind(this.scope.tenantId, resolveCapability(legacyKey)!.id, allowed ? 1 : 0, this.scope.tenantId, token));
    const revoke = this.db.prepare(`UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND role='agent'
      AND EXISTS (SELECT 1 FROM tenant_capability_policy_versions WHERE tenant_id=? AND role='agent' AND change_token=?)`).bind(this.scope.tenantId, this.scope.tenantId, token);
    const countFence=this.db.prepare(`UPDATE budget_mutation_assertion SET accepted=CASE WHEN
      COALESCE((SELECT agent_rows FROM admin_agent_population WHERE tenant_id=?),0)<=? THEN 1 ELSE 0 END WHERE tenant_id=?`)
      .bind(this.scope.tenantId,commit.agentRows ?? -1,this.scope.tenantId);
    const prefix = [...this.fence(this.db, commit),countFence, ...this.cleanup(this.db, commit.namespace), ensure, version, ...writes, revoke];
    const results = await this.db.batch<{ response_snapshot: string }>([...prefix, this.receipt(this.db, commit.namespace, snapshot, {sql:"EXISTS (SELECT 1 FROM tenant_capability_policy_versions WHERE tenant_id=? AND role='agent' AND change_token=? AND revision=?)",values:[this.scope.tenantId,token,revision+1]})]);
    const versionResult = results[prefix.length - entries.length - 2];
    const value = results.at(-1)?.results[0]?.response_snapshot;
    return Number(versionResult?.meta?.changes) > 0 && value ? { updated: true, snapshot: value } : { updated: false };
  }
}
