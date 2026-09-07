import { Hono } from "hono";
import { Env } from "../bindings";
import { roleGuard } from "../middleware/role.guard";
import { permissionGuard } from "../middleware/permission.guard";
import { AppVariables } from "../types";
import { z } from "zod";
import { TenantRequestDeps } from "../middleware/tenant.middleware";

const filters = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const filterConditionSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.any()
});

const filterSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  conditions: z.array(filterConditionSchema),
});

/**
 * GET /api/settings/filters
 * List all filters for the active tenant
 */
filters.get("/", roleGuard(["agent", "admin"]), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const list = await d.repositories.ticketFilters.list();
  return c.json(list);
});

/**
 * POST /api/settings/filters
 * Create a new filter (Admins only)
 */
filters.post("/", roleGuard(["admin"]), async (c) => {
  const body = await c.req.json();
  const result = filterSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const d = c.get('tenantDeps') as TenantRequestDeps;
  const filter = await d.repositories.ticketFilters.create(result.data);
  return c.json(filter, 201);
});

/**
 * GET /api/settings/filters/:id
 * Get a specific filter
 */
filters.get("/:id", roleGuard(["agent", "admin"]), async (c) => {
  const { id } = c.req.param();
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const filter = await d.repositories.ticketFilters.get(id);

  if (!filter) {
    return c.json({ error: "Filter not found" }, 404);
  }

  return c.json(filter);
});

/**
 * PUT /api/settings/filters/:id
 * Update a filter (Admins only)
 */
filters.put("/:id", roleGuard(["admin", "agent"]), permissionGuard("filters"), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const result = filterSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const d = c.get('tenantDeps') as TenantRequestDeps;

  try {
    const updated = await d.repositories.ticketFilters.update(id, result.data);
    if (!updated) {
      return c.json({ error: "Filter not found" }, 404);
    }
    return c.json(updated);
  } catch (err: any) {
    if (err.message === "Cannot modify system filters") {
      return c.json({ error: err.message }, 403);
    }
    throw err;
  }
});

/**
 * DELETE /api/settings/filters/:id
 * Delete a filter (Admins only)
 */
filters.delete("/:id", roleGuard(["admin"]), async (c) => {
  const { id } = c.req.param();
  const d = c.get('tenantDeps') as TenantRequestDeps;

  const existing = await d.repositories.ticketFilters.get(id);
  if (!existing) {
    return c.json({ error: "Filter not found" }, 404);
  }

  try {
    await d.repositories.ticketFilters.delete(id);
    return c.json({ success: true });
  } catch (err: any) {
    if (err.message === "Cannot delete system filters") {
      return c.json({ error: err.message }, 403);
    }
    throw err;
  }
});

export default filters;
