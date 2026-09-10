import { Hono } from "hono";
import { z } from "zod";
import { CAPABILITY_CATALOG, capabilityWriteConstraint } from "../auth/capability-policy";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { permissionGuard, permissionWriteFence, revalidatePermission } from "../middleware/permission.guard";
import { roleGuard } from "../middleware/role.guard";
import { tenantMiddleware } from "../middleware/tenant.middleware";
import { AppVariables } from "../types";

const permissions = new Hono<{ Bindings: Env; Variables: AppVariables }>();
permissions.use("*", authMiddleware, tenantMiddleware, mfaGuard);

const updatePermissionsSchema = z.object({
  revision: z.number().int().min(1),
  policies: z.record(z.boolean()),
}).strict();

type PolicyRow = { capability: string; enabled: number | boolean; revision: number };

function isEnabled(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}

/** Tenant administration narrows deployment-owned agent grants; it cannot write the owner ceiling or role grants. */
permissions.get("/", roleGuard(["admin"]), permissionGuard("permissions.manage"), async (c) => {
  const tenantId = c.get("jwtPayload").tenant_id!;
  const [ownerResult, roleResult, tenantResult, version] = await Promise.all([
    c.env.DB.prepare("SELECT capability, enabled, revision FROM deployment_capability_ceiling").all<PolicyRow>(),
    c.env.DB.prepare("SELECT capability, enabled, revision FROM deployment_role_capability_grants WHERE role = 'agent'").all<PolicyRow>(),
    c.env.DB.prepare("SELECT capability, enabled, revision FROM tenant_role_capability_policies WHERE tenant_id = ? AND role = 'agent'").bind(tenantId).all<PolicyRow>(),
    c.env.DB.prepare("SELECT revision FROM tenant_capability_policy_versions WHERE tenant_id = ? AND role = 'agent'").bind(tenantId).first<{ revision: number }>(),
  ]);
  const owner = new Map((ownerResult.results ?? []).map(row => [row.capability, row]));
  const role = new Map((roleResult.results ?? []).map(row => [row.capability, row]));
  const tenant = new Map((tenantResult.results ?? []).map(row => [row.capability, row]));

  return c.json({
    revision: version?.revision ?? 1,
    capabilities: CAPABILITY_CATALOG.map(capability => ({
      key: capability.legacyKey ?? capability.id,
      capability: capability.id,
      resource: capability.resource,
      action: capability.action,
      risk: capability.risk,
      label: capability.label,
      ownerAllowed: isEnabled(owner.get(capability.id)?.enabled),
      roleAllowed: isEnabled(role.get(capability.id)?.enabled),
      tenantAllowed: isEnabled(tenant.get(capability.id)?.enabled),
      effectiveForAgent: isEnabled(owner.get(capability.id)?.enabled)
        && isEnabled(role.get(capability.id)?.enabled)
        && isEnabled(tenant.get(capability.id)?.enabled),
    })),
  });
});

permissions.put("/", roleGuard(["admin"]), permissionGuard("permissions.manage"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = updatePermissionsSchema.safeParse(body);
  if (!result.success) return c.json({ error: "Invalid permissions format" }, 400);

  const requested = new Map(
    CAPABILITY_CATALOG.filter(capability => capability.legacyKey)
      .map(capability => [capability.legacyKey!, capability.id]),
  );
  const policyEntries = Object.entries(result.data.policies);
  if (policyEntries.some(([key]) => !requested.has(key))) {
    return c.json({ error: "Unknown or deployment-owned capability" }, 400);
  }

  const revalidationFailure = await revalidatePermission(c, "permissions.manage");
  if (revalidationFailure) return revalidationFailure;

  const tenantId = c.get("jwtPayload").tenant_id!;
  const changeToken = crypto.randomUUID();
  const writeGuard = capabilityWriteConstraint(permissionWriteFence(c, "permissions.manage"));
  const ensureVersion = c.env.DB.prepare(`INSERT OR IGNORE INTO tenant_capability_policy_versions
    (tenant_id, role, revision, change_token, updated_at)
    SELECT ?, 'agent', 1, '', CURRENT_TIMESTAMP WHERE ${writeGuard.sql}`)
    .bind(tenantId, ...writeGuard.values);
  const revisionUpdate = c.env.DB.prepare(`UPDATE tenant_capability_policy_versions
    SET revision = revision + 1, change_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND role = 'agent' AND revision = ? AND ${writeGuard.sql}`)
    .bind(changeToken, tenantId, result.data.revision, ...writeGuard.values);
  const statements = policyEntries.map(([legacyKey, allowed]) => c.env.DB.prepare(`INSERT INTO tenant_role_capability_policies
      (tenant_id, role, capability, enabled, revision, updated_at)
    SELECT ?, 'agent', ?, ?, 1, CURRENT_TIMESTAMP
    WHERE EXISTS (SELECT 1 FROM tenant_capability_policy_versions
      WHERE tenant_id = ? AND role = 'agent' AND change_token = ?)
    ON CONFLICT(tenant_id, role, capability) DO UPDATE SET
      enabled = excluded.enabled, revision = tenant_role_capability_policies.revision + 1, updated_at = CURRENT_TIMESTAMP`)
    .bind(tenantId, requested.get(legacyKey), allowed ? 1 : 0, tenantId, changeToken));
  statements.push(c.env.DB.prepare(`UPDATE users SET session_version = session_version + 1
    WHERE tenant_id = ? AND role = 'agent' AND EXISTS (
      SELECT 1 FROM tenant_capability_policy_versions
      WHERE tenant_id = ? AND role = 'agent' AND change_token = ?
    )`).bind(tenantId, tenantId, changeToken));
  const results = await c.env.DB.batch([ensureVersion, revisionUpdate, ...statements]);
  if (!results[1]?.meta.changes) return c.json({ error: "Permission policy changed; reload and try again" }, 409);

  return c.json({ success: true, revision: result.data.revision + 1, sessionsRevoked: true });
});

export default permissions;
