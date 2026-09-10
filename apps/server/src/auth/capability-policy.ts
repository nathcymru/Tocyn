
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
export type CapabilityWriteFence = CapabilityPrincipal & { capability: string; policyFingerprint: string };

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
        AND json_array(owner.revision, role_grant.revision,
          CASE WHEN actor.role = 'agent' THEN tenant_policy.revision ELSE NULL END,
          json((SELECT json_group_array(json_array(group_id, revision)) FROM (
            SELECT constraint_row.group_id, constraint_row.revision
            FROM tenant_group_capability_constraints constraint_row
            JOIN user_groups member
              ON member.tenant_id = constraint_row.tenant_id AND member.group_id = constraint_row.group_id
            WHERE constraint_row.tenant_id = actor.tenant_id AND member.user_id = actor.id
              AND constraint_row.capability = owner.capability
            ORDER BY constraint_row.group_id COLLATE BINARY
          ))), actor.session_version) = ?
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
      fence.tenantId, fence.actorId, fence.role, fence.sessionVersion, fence.role, fence.policyFingerprint ?? null,
    ],
  };
}

export function requireCapabilityWrite(result: { meta?: { changes?: number } } | null | undefined, fence?: CapabilityWriteFence): void {
  // D1 returns mutation metadata. A guarded write without positive evidence
  // is indistinguishable from a failed fence and must not be treated as a
  // successful side effect.
  const changes = result?.meta?.changes;
  if (fence && (typeof changes !== "number" || !Number.isInteger(changes) || changes < 1)) {
    throw new CapabilityFenceError();
  }
}
