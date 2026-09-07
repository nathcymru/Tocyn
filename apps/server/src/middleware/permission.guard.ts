import { Context, Next } from "hono";
import { Env } from "../bindings";
import { AppVariables } from "../types";
import { TenantRequestDeps } from "./tenant.middleware";

export const permissionGuard = (settingKey: string) => {
  return async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
    const payload = c.get("jwtPayload");

    if (!payload) {
      return c.json({ error: "Unauthorized", message: "No session found" }, 401);
    }

    if (payload.role === "admin") {
      return await next();
    }

    if (payload.role !== "agent") {
      return c.json({ error: "Forbidden", message: "Insufficient permissions" }, 403);
    }

    const d = c.get("tenantDeps") as TenantRequestDeps;

    if (!d) {
      return c.json({ error: "Forbidden", message: `Agent missing permission: ${settingKey}` }, 403);
    }

    try {
      const configValue = await d.repositories.config.get('agent_settings_permissions');
      if (configValue) {
        const permissions = JSON.parse(configValue);
        if (permissions && permissions[settingKey] === true) {
          return await next();
        }
      }
    } catch (e) {
      console.error("Error parsing agent_settings_permissions", e);
    }

    return c.json({ error: "Forbidden", message: `Agent missing permission: ${settingKey}` }, 403);
  };
};
