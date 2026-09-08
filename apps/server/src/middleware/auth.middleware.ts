import { Context, Next } from "hono";
import { Env } from "../bindings";
import * as jose from "jose";
import { AppVariables } from "../types";
import { getCookie } from "hono/cookie";
import { createVerifiedTenantScope } from "../auth/scope";
import { createTenantRequestDeps } from "./tenant.middleware";
import { UserAuthResolver, UserAuthResolution } from "../auth/user-auth-resolver";

export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const cookieToken = getCookie(c, "lumina_customer_token");

  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);
  else if (cookieToken) token = cookieToken;

  if (!token) return c.json({ error: "Unauthorized: Missing or invalid token format" }, 401);

  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(c.env.JWT_SECRET), {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      audience: "app",
    });

    const tenantId = (payload as any).tenant_id;
    const sub = payload.sub as string;

    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      return c.json({ error: "Unauthorized: Missing or invalid tenant context" }, 401);
    }

    if (!sub || typeof sub !== "string" || !sub.trim()) {
      return c.json({ error: "Unauthorized: Missing or invalid subject claim" }, 401);
    }

    let activeRole = payload.role as string;
    if (!c.env.DB) {
      return c.json({ error: "Unauthorized: Database unavailable" }, 401);
    }

    const resolver = new UserAuthResolver(c.env.DB);
    const userRes = await resolver.resolveUserById(tenantId, sub);
    if (userRes && (!Number.isSafeInteger(payload.session_version ?? 0) || (payload.session_version ?? 0) !== userRes.sessionVersion)) {
      return c.json({ error: "Unauthorized: Session revoked" }, 401);
    }
    if (!userRes) {
      return c.json({ error: "Unauthorized: User account no longer exists" }, 401);
    }
    if (userRes.role !== payload.role) {
      return c.json({ error: "Unauthorized: User role changed" }, 401);
    }
    activeRole = userRes.role;

    c.set("jwtPayload", { ...payload, sub, tenant_id: tenantId, role: activeRole } as any);

    const scope = createVerifiedTenantScope(tenantId, sub, [activeRole], 1);
    c.set("tenantScope", scope as any);

    const deps = createTenantRequestDeps(scope, c.env);
    c.set("tenantDeps", deps as any);

    await next();
  } catch (error) {
    return c.json({ error: "Unauthorized: Invalid or expired token" }, 401);
  }
};

export const mfaChallengeMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);

  if (!token) return c.json({ error: "Unauthorized: Missing or invalid token format" }, 401);

  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(c.env.JWT_SECRET), {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      audience: "mfa-challenge",
    });

    const tenantId = (payload as any).tenant_id;
    const sub = payload.sub as string;

    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      return c.json({ error: "Unauthorized: Missing or invalid tenant context" }, 401);
    }

    if (!sub || typeof sub !== "string" || !sub.trim()) {
      return c.json({ error: "Unauthorized: Missing or invalid subject claim" }, 401);
    }

    let activeRole = payload.role as string;
    if (!c.env.DB) {
      return c.json({ error: "Unauthorized: Database unavailable" }, 401);
    }

    const resolver = new UserAuthResolver(c.env.DB);
    const userRes = await resolver.resolveUserById(tenantId, sub);
    if (userRes && (!Number.isSafeInteger(payload.session_version ?? 0) || (payload.session_version ?? 0) !== userRes.sessionVersion)) {
      return c.json({ error: "Unauthorized: Session revoked" }, 401);
    }
    if (!userRes) {
      return c.json({ error: "Unauthorized: User account no longer exists" }, 401);
    }
    if (userRes.role !== payload.role) {
      return c.json({ error: "Unauthorized: User role changed" }, 401);
    }
    activeRole = userRes.role;

    c.set("jwtPayload", { ...payload, sub, tenant_id: tenantId, role: activeRole } as any);

    const scope = createVerifiedTenantScope(tenantId, sub, [activeRole], 1);
    c.set("tenantScope", scope as any);

    const deps = createTenantRequestDeps(scope, c.env);
    c.set("tenantDeps", deps as any);

    await next();
  } catch (error) {
    return c.json({ error: "Unauthorized: Invalid or expired MFA challenge token" }, 401);
  }
};

export const loginAuthResolverMiddleware = async (c: Context, next: Next) => {
  if (!c.env.DB) return c.json({ error: "Authentication unavailable" }, 503);
  const body = await c.req.json().catch(() => ({}));
  let authUser: UserAuthResolution | null = null;

  if (body.email && typeof body.email === "string") {
    const resolver = new UserAuthResolver(c.env.DB);
    authUser = await resolver.resolveCredentialsByEmail(body.email);
  }

  c.set("loginBody" as any, body);
  c.set("resolvedUser" as any, authUser);
  await next();
};
