import { BetaAdmissionError } from '../types/local-beta';
import { Context, Next } from "hono";
import { Env } from "../bindings";
import { ApiAuthResolver } from "../auth/api-key-resolver";
import { composeApiKeyRequestDeps } from "../auth/api-key-composition";
import { AppVariables } from "../types";
import { observeD1 } from '../repositories/observed-d1';

/**
 * Middleware to authenticate requests using an API Key in the X-API-Key header.
 * Resolves the key to a tenant-scoped integration principal with TenantRequestDeps.
 */
export const apiAuthMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  let recorded = false;
  const record = (decision: 'accepted' | 'denied' | 'unavailable') => {
    if (recorded) return;
    recorded = true;
    try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
  };
  const apiKey = c.req.header("X-API-Key");

  if (!apiKey) {
    record('denied');
    return c.json({ error: "Missing API Key" }, 401);
  }

  if (!c.env.DB) {
    record('unavailable');
    return c.json({ error: 'Authentication unavailable' }, 503);
  }
  const resolver = new ApiAuthResolver(observeD1(c.env.DB, c.get('resourceOperationEmitter')));
  let resolution;
  try { resolution = await resolver.resolveKey(apiKey); }
  catch (error) { record('unavailable'); throw error; }
  if (!resolution) {
    record('denied');
    return c.json({ error: "Invalid or inactive API Key" }, 401);
  }
  // A resolved active key is a credential acceptance. Admission and endpoint
  // permission checks remain later, separate decisions.
  record('accepted');
  let result;
  try { result = await composeApiKeyRequestDeps(resolution, c.env, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'), c.get('ownerIngressAdmission')); }
  catch (error) { if (error instanceof BetaAdmissionError) return c.json({code:error.code,error:error.message},error.status); throw error; }

  c.set('tenantDeps', result.deps);
  c.set('tenantScope', result.deps.scope);
  c.set('apiKeyResolution', result.resolution);

  await next();
};
