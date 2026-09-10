import { Context, Next } from "hono";
import { Env } from "../bindings";
import { AppVariables } from "../types";
import { CapabilityPolicyService, type CapabilityDecision } from "../auth/capability-policy";

function principalFromContext(c: Context<{ Bindings: Env; Variables: AppVariables }>) {
  const payload = c.get("jwtPayload");
  if (!payload || !payload.tenant_id || !Number.isSafeInteger(payload.session_version ?? 0)) return null;
  return { tenantId: payload.tenant_id, actorId: payload.sub, role: payload.role, sessionVersion: payload.session_version ?? 0 };
}

function forbidden(c: Context<{ Bindings: Env; Variables: AppVariables }>, decision: CapabilityDecision) {
  const message = decision.reason === "session_revoked"
    ? "Session revoked after permission policy changed"
    : `Capability denied: ${decision.capability}`;
  return c.json({ error: "Forbidden", message }, 403);
}

export const permissionGuard = (settingKey: string) => {
  return async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
    const principal = principalFromContext(c);
    if (!principal) {
      return c.json({ error: "Unauthorized", message: "No session found" }, 401);
    }
    const decision = await new CapabilityPolicyService(c.env.DB).authorize(principal, settingKey);
    if (!decision.allowed) return forbidden(c, decision);
    c.set("permissionFences", { ...(c.get("permissionFences") ?? {}), [decision.capability]: decision });
    await next();
  };
};

/** Re-check at the mutation boundary, not merely when the request began. */
export async function revalidatePermission(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  settingKey: string,
): Promise<Response | null> {
  const principal = principalFromContext(c);
  if (!principal) return c.json({ error: "Unauthorized", message: "No session found" }, 401);
  const current = await new CapabilityPolicyService(c.env.DB).authorize(principal, settingKey);
  const prior = c.get("permissionFences")?.[current.capability];
  if (!current.allowed || !prior || prior.policyFingerprint !== current.policyFingerprint) return forbidden(c, current);
  return null;
}
