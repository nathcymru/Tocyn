import { Hono } from "hono";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { roleGuard } from "../middleware/role.guard";
import { permissionGuard } from "../middleware/permission.guard";
import { AppVariables } from "../types";
import { z } from "zod";

const channels = new Hono<{ Bindings: Env; Variables: AppVariables }>();

channels.use("*", authMiddleware, tenantMiddleware, mfaGuard, roleGuard(["admin", "agent"]), permissionGuard("channels_email"));

const createEmailSchema = z.object({
  email_address: z.string().email("Invalid email address"),
  name: z.string().optional(),
  group_id: z.string().uuid().nullable().optional(),

  is_default: z.boolean().default(false),
});

channels.get("/emails", async (c) => {
  const deps = c.get("tenantDeps") as TenantRequestDeps;
  const results = await deps.repositories.channels.listSupportEmails();
  return c.json(results);
});

channels.post("/emails", async (c) => {
  const deps = c.get("tenantDeps") as TenantRequestDeps;
  const body = await c.req.json();
  const result = createEmailSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { email_address, name, group_id, is_default } = result.data;
  if (group_id && !await deps.repositories.groups.get(group_id)) {
    return c.json({ error: "Group not found in this tenant" }, 400);
  }
  const id = crypto.randomUUID();

  try {
    const email = await deps.repositories.channels.createSupportEmail({
      id,
      email_address,
      name,
      group_id: group_id || undefined,
      is_default
    });
    return c.json(email, 201);
  } catch (error: any) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "Email address already exists" }, 409);
    }
    throw error;
  }
});

channels.delete("/emails/:id", async (c) => {
  const deps = c.get("tenantDeps") as TenantRequestDeps;
  const id = c.req.param("id");
  const idSchema = z.string().uuid();
  const result = idSchema.safeParse(id);

  if (!result.success) {
    return c.json({ error: "Invalid ID format" }, 400);
  }

  await deps.repositories.channels.deleteSupportEmail(id);
  return c.json({ success: true });
});

export default channels;
