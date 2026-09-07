import { MiddlewareHandler } from 'hono';
import { AppVariables } from '../types';
import { Env } from '../bindings';

/** Cross-isolate limit keyed by a verified tenant and subject, after authentication. */
export function tenantRateLimit(action: string, limit: number, windowMs: number): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
  return async (c, next) => {
    const deps = c.get('tenantDeps');
    if (!deps) return c.json({ error: 'Unauthorized' }, 401);
    if (!await deps.repositories.requestLimits.consume(`${action}:${deps.scope.actorId}`, limit, windowMs)) return c.json({ error: 'Too many requests' }, 429);
    if (!await deps.repositories.requestLimits.consume(`${action}:tenant-total`, limit * 10, windowMs)) return c.json({ error: 'Too many requests' }, 429);
    await next();
  };
}
