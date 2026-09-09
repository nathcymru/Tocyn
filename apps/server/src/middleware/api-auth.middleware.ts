import { BetaAdmissionError } from '../types/local-beta';
import { Context, Next } from "hono";
import { Env } from "../bindings";
import { ApiAuthResolver } from "../auth/api-key-resolver";
import { resolveApiKeyRequestDeps } from "../auth/api-key-composition";
import { AppVariables } from "../types";

/**
 * Middleware to authenticate requests using an API Key in the X-API-Key header.
 * Resolves the key to a tenant-scoped integration principal with TenantRequestDeps.
 */
export const apiAuthMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  const apiKey = c.req.header("X-API-Key");

  if (!apiKey) {
    return c.json({ error: "Missing API Key" }, 401);
  }

  if (!c.env.DB) return c.json({ error: 'Authentication unavailable' }, 503);
  const resolver = new ApiAuthResolver(c.env.DB);
  let result;
  try { result = await resolveApiKeyRequestDeps(resolver, apiKey, c.env); }
  catch (error) { if (error instanceof BetaAdmissionError) return c.json({code:error.code,error:error.message},error.status); throw error; }

  if (!result) {
    return c.json({ error: "Invalid or inactive API Key" }, 401);
  }

  c.set('tenantDeps', result.deps);
  c.set('tenantScope', result.deps.scope);
  c.set('apiKeyResolution', result.resolution);

  await next();
};
