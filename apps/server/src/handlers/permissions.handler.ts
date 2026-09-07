import { Hono } from "hono";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { roleGuard } from "../middleware/role.guard";
import { AppVariables } from "../types";
import { z } from "zod";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";

const permissions = new Hono<{ Bindings: Env; Variables: AppVariables }>();

permissions.use("*", authMiddleware, tenantMiddleware, mfaGuard);

const updatePermissionsSchema = z.record(z.boolean());

/**
 * GET /api/permissions
 * Fetch current agent permissions mapping for the active tenant.
 */
permissions.get("/", roleGuard(["admin", "agent"]), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const configValue = await d.repositories.config.get('agent_settings_permissions');
  try {
    const parsed = updatePermissionsSchema.safeParse(configValue ? JSON.parse(configValue) : {});
    return c.json(parsed.success ? parsed.data : {});
  } catch {
    return c.json({}); // Corrupt configuration never grants permissions.
  }
});

/**
 * PUT /api/permissions
 * Update agent permissions mapping for the active tenant (Admin only).
 */
permissions.put("/", roleGuard(["admin"]), async (c) => {
  const body = await c.req.json();
  const result = updatePermissionsSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: "Invalid permissions format" }, 400);
  }

  const d = c.get('tenantDeps') as TenantRequestDeps;
  await d.repositories.config.set('agent_settings_permissions', JSON.stringify(result.data));

  return c.json({ success: true });
});

export default permissions;
