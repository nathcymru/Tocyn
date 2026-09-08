import { cors } from 'hono/cors';
import { MiddlewareHandler } from 'hono';
import { Env } from '../bindings';

export const apiCors: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const widget = c.req.path.startsWith('/api/v1/widget/');
  const allowed = new Set<string>();
  for (const value of [c.env.PORTAL_URL, ...(c.env.CORS_ORIGINS || '').split(',')]) {
    if (!value) continue;
    try {
      const url = new URL(value.trim());
      const localDevelopment = !['preview', 'beta', 'production'].includes(c.env.ENVIRONMENT || 'development');
      if (url.protocol === 'https:' || (localDevelopment && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) allowed.add(url.origin);
    } catch { /* Invalid configuration never becomes an allowed origin. */ }
  }
  // CORS alone does not prevent cookie-authenticated form submissions.
  const cookieMutation = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
    && /(?:^|;\s*)lumina_customer_token=/.test(c.req.header('Cookie') || '')
    && !c.req.header('Authorization')?.startsWith('Bearer ');
  if (cookieMutation) {
    const origin = c.req.header('Origin');
    if (!origin || (!allowed.has(origin) && origin !== new URL(c.req.url).origin)) {
      return c.json({ error: 'Untrusted request origin' }, 403);
    }
  }
  return cors({
    origin: (origin) => widget ? '*' : (allowed.has(origin) ? origin : undefined),
    credentials: !widget,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Lumina-Source', 'X-Widget-Key', 'Idempotency-Key', ...(!widget ? ['X-API-Key'] : [])],
    exposeHeaders: ['Content-Length', 'Idempotency-Replayed'],
    maxAge: 600,
  })(c, next);
};
