import type { D1Database } from "@cloudflare/workers-types";

export type CapabilityRisk = "READ_ONLY" | "LOW_RISK_WRITE" | "PRIVILEGED_WRITE" | "DESTRUCTIVE";

export type CapabilityDefinition = {
  id: string;
  legacyKey?: string;
  resource: string;
  action: string;
  risk: CapabilityRisk;
  label: string;
};

/**
 * This is deliberately finite. Unknown capability identifiers deny instead of
 * becoming an implicit deployment-owner or tenant grant.
 */
export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  { id: "settings.general.manage", legacyKey: "general", resource: "settings", action: "manage", risk: "PRIVILEGED_WRITE", label: "General settings" },
  { id: "users.manage", legacyKey: "users", resource: "users", action: "manage", risk: "PRIVILEGED_WRITE", label: "Users" },
  { id: "groups.manage", legacyKey: "groups", resource: "groups", action: "manage", risk: "PRIVILEGED_WRITE", label: "Groups" },
  { id: "ticket-fields.manage", legacyKey: "ticket_fields", resource: "ticket-fields", action: "manage", risk: "LOW_RISK_WRITE", label: "Ticket fields" },
  { id: "filters.manage", legacyKey: "filters", resource: "filters", action: "manage", risk: "LOW_RISK_WRITE", label: "Filters" },
  { id: "automations.manage", legacyKey: "automations", resource: "automations", action: "manage", risk: "PRIVILEGED_WRITE", label: "Automations" },
  { id: "api-keys.manage", legacyKey: "api_keys", resource: "api-keys", action: "manage", risk: "PRIVILEGED_WRITE", label: "API keys" },
  { id: "usage.read", legacyKey: "usage", resource: "usage", action: "read", risk: "READ_ONLY", label: "Usage" },
  { id: "channels.email.manage", legacyKey: "channels_email", resource: "channels.email", action: "manage", risk: "PRIVILEGED_WRITE", label: "Email channels" },
  { id: "channels.widget.manage", legacyKey: "channels_widget", resource: "channels.widget", action: "manage", risk: "PRIVILEGED_WRITE", label: "Widget channels" },
  { id: "permissions.manage", resource: "permissions", action: "manage", risk: "PRIVILEGED_WRITE", label: "Delegated permissions" },
  { id: "tools.reference.read", resource: "tools.reference", action: "read", risk: "READ_ONLY", label: "Reference tool reads" },
  { id: "tools.reference.low-risk-write", resource: "tools.reference", action: "low-risk-write", risk: "LOW_RISK_WRITE", label: "Reference tool low-risk writes" },
  { id: "tools.reference.privileged-write", resource: "tools.reference", action: "privileged-write", risk: "PRIVILEGED_WRITE", label: "Reference tool privileged writes" },
  { id: "tools.reference.destructive", resource: "tools.reference", action: "destructive", risk: "DESTRUCTIVE", label: "Reference tool destructive writes" },
];

const catalogById = new Map(CAPABILITY_CATALOG.map(capability => [capability.id, capability]));
const catalogByLegacyKey = new Map(CAPABILITY_CATALOG.flatMap(capability => capability.legacyKey ? [[capability.legacyKey, capability] as const] : []));

export function resolveCapability(capabilityOrLegacyKey: string): CapabilityDefinition | null {
  return catalogById.get(capabilityOrLegacyKey) ?? catalogByLegacyKey.get(capabilityOrLegacyKey) ?? null;
}

export type CapabilityPrincipal = {
  tenantId: string;
  actorId: string;
  role: string;
  sessionVersion: number;
};

export type CapabilityDecision = {
  allowed: boolean;
  reason: "unknown_capability" | "owner_ceiling" | "role_grant" | "tenant_policy" | "group_policy" | "session_revoked" | "policy_unavailable" | "allowed";
  capability: string;
  policyFingerprint: string;
};

/**
 * Values captured from an authenticated request and bound into the protected
 * write itself.  This is deliberately data, rather than a prior successful
 * read: the SQL predicate is evaluated in the same statement/transaction as
 * the mutation, so revocation cannot land between a check and the write.
 */
export type CapabilityWriteFence = CapabilityPrincipal & { capability: string };

export class CapabilityFenceError extends Error {
  constructor() {
    super("Permission changed before the protected mutation could commit");
    this.name = "CapabilityFenceError";
  }
}

export function capabilityWriteConstraint(fence?: CapabilityWriteFence): { sql: string; values: unknown[] } {
  if (!fence) return { sql: "1 = 1", values: [] };
  return {
    sql: `EXISTS (
      SELECT 1
      FROM users actor
      JOIN deployment_capability_ceiling owner
        ON owner.capability = ? AND owner.enabled = 1
      JOIN deployment_role_capability_grants role_grant
        ON role_grant.role = ? AND role_grant.capability = owner.capability AND role_grant.enabled = 1
      LEFT JOIN tenant_role_capability_policies tenant_policy
        ON tenant_policy.tenant_id = actor.tenant_id AND tenant_policy.role = actor.role
        AND tenant_policy.capability = owner.capability
      WHERE actor.tenant_id = ? AND actor.id = ? AND actor.role = ? AND actor.session_version = ?
        AND (? <> 'agent' OR tenant_policy.enabled = 1)
        AND NOT EXISTS (
          SELECT 1
          FROM tenant_group_capability_constraints group_constraint
          JOIN user_groups membership
            ON membership.tenant_id = group_constraint.tenant_id AND membership.group_id = group_constraint.group_id
          WHERE group_constraint.tenant_id = actor.tenant_id AND membership.user_id = actor.id
            AND group_constraint.capability = owner.capability AND group_constraint.enabled = 0
        )
    )`,
    values: [
      fence.capability, fence.role,
      fence.tenantId, fence.actorId, fence.role, fence.sessionVersion, fence.role,
    ],
  };
}

export function requireCapabilityWrite(result: { meta?: { changes?: number } } | null | undefined, fence?: CapabilityWriteFence): void {
  // D1 returns `meta.changes` for every mutation. Some narrow unit doubles
  // intentionally omit metadata; only a concrete zero is a denial signal.
  if (fence && result?.meta && !result.meta.changes) throw new CapabilityFenceError();
}

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
  constructor(private readonly db: D1Database) {}

  async authorize(principal: CapabilityPrincipal, capabilityOrLegacyKey: string): Promise<CapabilityDecision> {
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

  private denied(reason: CapabilityDecision["reason"], capability: string, ...rows: Array<PolicyRow | number | undefined | null>): CapabilityDecision {
    const revisions = rows.flatMap(row => typeof row === "object" && row !== null ? [row.revision] : [row]);
    return { allowed: false, reason, capability, policyFingerprint: fingerprint(revisions) };
  }
}
