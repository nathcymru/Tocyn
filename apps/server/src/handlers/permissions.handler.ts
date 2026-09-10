import { Hono } from "hono";
import { z } from "zod";
import { CAPABILITY_CATALOG } from "../auth/capability-policy";
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

permissions.get("/", roleGuard(["admin"]), permissionGuard("permissions.manage"), async (c) => {
  return c.json(await c.get('tenantDeps')!.capabilityPolicy.getAgentPolicy());
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

  const updated = await c.get('tenantDeps')!.capabilityPolicy.updateAgentPolicy(result.data.revision, result.data.policies, permissionWriteFence(c, 'permissions.manage'));
  if (!updated) return c.json({ error: 'Permission policy changed; reload and try again' }, 409);

  return c.json({ success: true, revision: result.data.revision + 1, sessionsRevoked: true });
});

export default permissions;
