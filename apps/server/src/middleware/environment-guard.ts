import { MiddlewareHandler } from 'hono';
import { Env } from '../bindings';

const isolatedEnvironments = new Set(['preview', 'beta']);

function exactHttpsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && url.origin === value;
  } catch { return false; }
}

export function isIsolatedEnvironment(env: Env): boolean {
  return isolatedEnvironments.has(env.ENVIRONMENT || '');
}

export function validIsolatedRuntime(env: Env): boolean {
  if (!isIsolatedEnvironment(env)) return false;
  if (env.INBOUND_EMAIL_AUTH_VERIFIED !== 'false' || env.DISABLE_RATE_LIMIT !== 'false') return false;
  if (!exactHttpsOrigin(env.PORTAL_URL) || !exactHttpsOrigin(env.DASHBOARD_URL)) return false;
  const origins = (env.CORS_ORIGINS || '').split(',');
  return origins.length === 2
    && new Set(origins).size === 2
    && origins.includes(env.PORTAL_URL!)
    && origins.includes(env.DASHBOARD_URL!)
    && origins.every(exactHttpsOrigin);
}

export const environmentGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (isIsolatedEnvironment(c.env) && !validIsolatedRuntime(c.env)) return c.json({ error: 'Isolated environment configuration is invalid' }, 503);
  await next();
};
