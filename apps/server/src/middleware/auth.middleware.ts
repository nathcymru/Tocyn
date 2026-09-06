import { Context, Next } from "hono";
import { Env } from "../bindings";
import * as jose from "jose";
import { AppVariables } from "../types";
import { getCookie } from "hono/cookie";
import { createVerifiedTenantScope } from "../auth/scope";

export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const cookieToken = getCookie(c, "lumina_customer_token");

  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);
  else if (cookieToken) token = cookieToken;

  if (!token) return c.json({ error: "Unauthorized: Missing or invalid token format" }, 401);

  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(c.env.JWT_SECRET));
    c.set("jwtPayload", payload as any);

    // Auth boundary creates the scope. Hardcoded 'default-tenant' during migration until JWTs are re-issued.
    const tenantId = (payload as any).tenant_id;
    if (tenantId) {
      const scope = createVerifiedTenantScope(tenantId, payload.sub as string, [payload.role as string], 1);
      c.set("tenantScope", scope);
    }

    await next();
  } catch (error) {
    console.error("JWT Verification Error:", error);
    return c.json({ error: "Unauthorized: Invalid or expired token" }, 401);
  }
};
