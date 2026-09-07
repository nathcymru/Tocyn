import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import * as jose from 'jose';
import { createVerifiedTenantScope } from '../auth/scope';
import { createTenantRequestDeps } from './tenant.middleware';
import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';
import { UserAuthResolver } from '../auth/user-auth-resolver';

export const widgetAuthMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  let token = getCookie(c, "lumina_customer_token");
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      audience: 'widget'
    });

    if (typeof payload.tenant_id !== 'string' || !payload.tenant_id.trim() ||
        typeof payload.sub !== 'string' || !payload.sub.trim() ||
        typeof payload.email !== 'string' || !payload.email.trim()) {
      return c.json({ error: "Unauthorized: Missing tenant context" }, 401);
    }
    
    if (payload.role !== 'customer') {
      return c.json({ error: "Unauthorized: Invalid widget role" }, 403);
    }

    if (!c.env.DB) {
      return c.json({ error: "Unauthorized: Database unavailable" }, 401);
    }

    const resolver = new UserAuthResolver(c.env.DB);
    const userRes = await resolver.resolveUserById(payload.tenant_id as string, payload.sub as string);
    if (!userRes) {
      return c.json({ error: "Unauthorized: User account no longer exists" }, 401);
    }
    if (typeof userRes.email !== 'string' || !userRes.email || userRes.email !== payload.email) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (userRes.role !== 'customer') {
      return c.json({ error: "Unauthorized: Invalid widget role" }, 403);
    }

    const scope = createVerifiedTenantScope(
      payload.tenant_id as string,
      payload.sub as string,
      ['customer'],
      1
    );

    const deps = createTenantRequestDeps(scope, c.env);
    c.set('tenantScope', scope);
    c.set('tenantDeps', deps);
    c.set('jwtPayload', payload);
    
    c.set('user', {
      id: payload.sub,
      email: userRes.email,
      role: 'customer',
      tenant_id: payload.tenant_id
    });

    await next();
  } catch (err: any) {
    return c.json({ error: "Unauthorized" }, 401);
  }
};

export const widgetTenantMiddleware = async (c: Context, next: Next) => {
  const widgetKey = c.req.query('key') || c.req.header('X-Widget-Key');

  if (!widgetKey || typeof widgetKey !== 'string' || !widgetKey.trim()) {
    return c.json({ error: 'Widget key required' }, 400);
  }

  if (!c.env.DB) {
    return c.json({ error: 'Database unavailable' }, 500);
  }

  const resolver = new WidgetTenantResolver(c.env.DB);
  const resolution = await resolver.resolveTenantByKey(widgetKey.trim());

  if (!resolution || !resolution.tenantId) {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(resolution.tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env);
  c.set('tenantDeps', deps);
  await next();
};
