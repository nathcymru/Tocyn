import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import { CAPABILITY_CATALOG, resolveCapability, capabilityWriteConstraint, type CapabilityPrincipal, type CapabilityDecision, type CapabilityWriteFence } from '../auth/capability-policy';
type PolicyRow = { enabled: number | boolean; revision?: number | null };

function enabled(row: PolicyRow | null | undefined): boolean {
  return row?.enabled === 1 || row?.enabled === true;
}

function fingerprint(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map(part => String(part ?? "missing")).join(":");
}

/**
 * The tables consulted here are intentionally not exposed through tenant APIs.
 * A tenant may narrow its delegated agent policy, but the deployment-owned
 * capability ceiling and role grant always remain the upper bound.
 */
export class CapabilityPolicyService {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async authorize(principal: CapabilityPrincipal, capabilityOrLegacyKey: string): Promise<CapabilityDecision> {
    if (principal.tenantId !== this.scope.tenantId || principal.actorId !== this.scope.actorId || !this.scope.roles.includes(principal.role)) return { allowed: false, reason: 'tenant_policy', capability: capabilityOrLegacyKey, policyFingerprint: 'scope_mismatch' };
    const capability = resolveCapability(capabilityOrLegacyKey);
    if (!capability) return { allowed: false, reason: "unknown_capability", capability: capabilityOrLegacyKey, policyFingerprint: "unknown" };

    try {
      const owner = await this.db.prepare(
        "SELECT enabled, revision FROM deployment_capability_ceiling WHERE capability = ?",
      ).bind(capability.id).first<PolicyRow>();
      if (!enabled(owner)) return this.denied("owner_ceiling", capability.id, owner);

      const roleGrant = await this.db.prepare(
        "SELECT enabled, revision FROM deployment_role_capability_grants WHERE role = ? AND capability = ?",
      ).bind(principal.role, capability.id).first<PolicyRow>();
      if (!enabled(roleGrant)) return this.denied("role_grant", capability.id, owner, roleGrant);

      const currentUser = await this.db.prepare(
        "SELECT role, session_version FROM users WHERE tenant_id = ? AND id = ?",
      ).bind(principal.tenantId, principal.actorId).first<{ role: string; session_version: number }>();
      const currentSessionVersion = currentUser?.session_version ?? 0;
      if (!currentUser || currentUser.role !== principal.role || currentSessionVersion !== principal.sessionVersion) {
        return this.denied("session_revoked", capability.id, owner, roleGrant, currentSessionVersion);
      }

      // Tenant policy is a restriction on delegated agents. Administrators have
      // a deployment-owned role grant and cannot be widened by a tenant row.
      let tenant: PolicyRow | null = null;
      if (principal.role === "agent") {
        tenant = await this.db.prepare(
          "SELECT enabled, revision FROM tenant_role_capability_policies WHERE tenant_id = ? AND role = ? AND capability = ?",
        ).bind(principal.tenantId, principal.role, capability.id).first<PolicyRow>();
        if (!enabled(tenant)) return this.denied("tenant_policy", capability.id, owner, roleGrant, tenant);
      }

      // Group rows can only add denials to the already-authorised role policy;
      // they never grant a capability that the owner or role did not grant.
      const groupConstraints = await this.db.prepare(`SELECT c.enabled, c.revision
        FROM tenant_group_capability_constraints c
        JOIN user_groups ug ON ug.tenant_id = c.tenant_id AND ug.group_id = c.group_id
        WHERE c.tenant_id = ? AND ug.user_id = ? AND c.capability = ?`,
      ).bind(principal.tenantId, principal.actorId, capability.id).all<PolicyRow>();
      const groups = groupConstraints.results ?? [];
      if (groups.some(row => row.enabled === false || row.enabled === 0)) {
        return this.denied("group_policy", capability.id, owner, roleGrant, tenant, ...groups.map(row => row.revision));
      }

      return {
        allowed: true,
        reason: "allowed",
        capability: capability.id,
        policyFingerprint: fingerprint([owner?.revision, roleGrant?.revision, tenant?.revision, ...groups.map(row => row.revision), principal.sessionVersion]),
      };
    } catch {
      return { allowed: false, reason: "policy_unavailable", capability: capability.id, policyFingerprint: "unavailable" };
    }
  }

  async getAgentPolicy() {
    const tenantId = this.scope.tenantId;
  const [ownerResult, roleResult, tenantResult, version] = await Promise.all([
    this.db.prepare("SELECT capability, enabled, revision FROM deployment_capability_ceiling").all<PolicyListRow>(),
    this.db.prepare("SELECT capability, enabled, revision FROM deployment_role_capability_grants WHERE role = 'agent'").all<PolicyListRow>(),
    this.db.prepare("SELECT capability, enabled, revision FROM tenant_role_capability_policies WHERE tenant_id = ? AND role = 'agent'").bind(tenantId).all<PolicyListRow>(),
    this.db.prepare("SELECT revision FROM tenant_capability_policy_versions WHERE tenant_id = ? AND role = 'agent'").bind(tenantId).first<{ revision: number }>(),
  ]);
  const owner = new Map((ownerResult.results ?? []).map(row => [row.capability, row]));
  const role = new Map((roleResult.results ?? []).map(row => [row.capability, row]));
  const tenant = new Map((tenantResult.results ?? []).map(row => [row.capability, row]));

  return {
    revision: version?.revision ?? 1,
    capabilities: CAPABILITY_CATALOG.map(capability => ({
      key: capability.legacyKey ?? capability.id,
      capability: capability.id,
      resource: capability.resource,
      action: capability.action,
      risk: capability.risk,
      label: capability.label,
      ownerAllowed: enabledValue(owner.get(capability.id)?.enabled),
      roleAllowed: enabledValue(role.get(capability.id)?.enabled),
      tenantAllowed: enabledValue(tenant.get(capability.id)?.enabled),
      effectiveForAgent: enabledValue(owner.get(capability.id)?.enabled)
        && enabledValue(role.get(capability.id)?.enabled)
        && enabledValue(tenant.get(capability.id)?.enabled),
    })),
  };
  }
  async updateAgentPolicy(revision: number, policies: Record<string, boolean>, fence: CapabilityWriteFence): Promise<boolean> {
    if (fence.tenantId !== this.scope.tenantId || fence.actorId !== this.scope.actorId || !this.scope.roles.includes(fence.role) || fence.capability !== "permissions.manage") return false;
    const tenantId = this.scope.tenantId;
    const policyEntries = Object.entries(policies);
    if (policyEntries.some(([key]) => !CAPABILITY_CATALOG.some(c => c.legacyKey === key))) return false;
  const changeToken = crypto.randomUUID();
  const writeGuard = capabilityWriteConstraint(fence);
  const ensureVersion = this.db.prepare(`INSERT OR IGNORE INTO tenant_capability_policy_versions
    (tenant_id, role, revision, change_token, updated_at)
    SELECT ?, 'agent', 1, '', CURRENT_TIMESTAMP WHERE ${writeGuard.sql}`)
    .bind(tenantId, ...writeGuard.values);
  const revisionUpdate = this.db.prepare(`UPDATE tenant_capability_policy_versions
    SET revision = revision + 1, change_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND role = 'agent' AND revision = ? AND ${writeGuard.sql}`)
    .bind(changeToken, tenantId, revision, ...writeGuard.values);
  const statements = policyEntries.map(([legacyKey, allowed]) => this.db.prepare(`INSERT INTO tenant_role_capability_policies
      (tenant_id, role, capability, enabled, revision, updated_at)
    SELECT ?, 'agent', ?, ?, 1, CURRENT_TIMESTAMP
    WHERE EXISTS (SELECT 1 FROM tenant_capability_policy_versions
      WHERE tenant_id = ? AND role = 'agent' AND change_token = ?)
    ON CONFLICT(tenant_id, role, capability) DO UPDATE SET
      enabled = excluded.enabled, revision = tenant_role_capability_policies.revision + 1, updated_at = CURRENT_TIMESTAMP`)
    .bind(tenantId, resolveCapability(legacyKey)!.id, allowed ? 1 : 0, tenantId, changeToken));
  statements.push(this.db.prepare(`UPDATE users SET session_version = session_version + 1
    WHERE tenant_id = ? AND role = 'agent' AND EXISTS (
      SELECT 1 FROM tenant_capability_policy_versions
      WHERE tenant_id = ? AND role = 'agent' AND change_token = ?
    )`).bind(tenantId, tenantId, changeToken));
  const results = await this.db.batch([ensureVersion, revisionUpdate, ...statements]);
  return Number.isInteger(results[1]?.meta.changes) && results[1].meta.changes > 0;

  }

  private denied(reason: CapabilityDecision["reason"], capability: string, ...rows: Array<PolicyRow | number | undefined | null>): CapabilityDecision {
    const revisions = rows.flatMap(row => typeof row === "object" && row !== null ? [row.revision] : [row]);
    return { allowed: false, reason, capability, policyFingerprint: fingerprint(revisions) };
  }
}

type PolicyListRow = { capability: string; enabled: number | boolean; revision: number };
function enabledValue(value: number | boolean | undefined) { return value === true || value === 1; }
