import { Context, Next } from "hono";
import { Env } from "../bindings";
import { AppVariables } from "../types";
import { CapabilityFenceError, resolveCapability, type CapabilityDecision, type CapabilityWriteFence } from "../auth/capability-policy";

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
    const policy = c.get("tenantDeps")?.capabilityPolicy;
    if (!policy) return c.json({ error: "Unauthorized: Missing tenant policy scope" }, 401);
    const decision = await policy.authorize(principal, settingKey);
    if (!decision.allowed) return forbidden(c, decision);
    c.set("permissionFences", { ...(c.get("permissionFences") ?? {}), [decision.capability]: decision });
    try {
      await next();
    } catch (error) {
      if (error instanceof CapabilityFenceError) {
        return c.json({ error: "Forbidden", message: "Permission changed before the protected mutation could commit" }, 403);
      }
      throw error;
    }
  };
};

/** Re-check at the mutation boundary, not merely when the request began. */
export async function revalidatePermission(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  settingKey: string,
): Promise<Response | null> {
  const principal = principalFromContext(c);
  if (!principal) return c.json({ error: "Unauthorized", message: "No session found" }, 401);
  const policy = c.get("tenantDeps")?.capabilityPolicy;
  if (!policy) return c.json({ error: "Unauthorized: Missing tenant policy scope" }, 401);
  const current = await policy.authorize(principal, settingKey);
  const prior = c.get("permissionFences")?.[current.capability];
  if (!current.allowed || !prior || prior.policyFingerprint !== current.policyFingerprint) return forbidden(c, current);
  return null;
}

/** Build the SQL write fence after revalidation succeeds. */
export function permissionWriteFence(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  settingKey: string,
): CapabilityWriteFence {
  const principal = principalFromContext(c);
  const capability = resolveCapability(settingKey);
  if (!principal || !capability || !c.get("permissionFences")?.[capability.id]) {
    throw new CapabilityFenceError();
  }
  return { ...principal, capability: capability.id };
}
