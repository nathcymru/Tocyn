import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import * as jose from 'jose';
import { createVerifiedTenantScope } from '../auth/scope';
import { createTenantRequestDeps } from './tenant.middleware';
import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';

export const widgetAuthMiddleware = async (c: Context, next: Next) => {
  const token = getCookie(c, "lumina_customer_token");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      audience: 'widget'
    });

    if (!payload.tenant_id) {
      return c.json({ error: "Unauthorized: Missing tenant context" }, 401);
    }
    
    if (payload.role !== 'customer') {
      return c.json({ error: "Unauthorized: Invalid widget role" }, 403);
    }

    const scope = createVerifiedTenantScope(
      payload.tenant_id as string,
      payload.sub as string,
      ['customer'],
      1
    );

    const deps = createTenantRequestDeps(scope, c.env);
    c.set('tenantDeps', deps);
    
    c.set('user', {
      id: payload.sub,
      email: payload.email,
      role: 'customer',
      tenant_id: payload.tenant_id
    });

    await next();
  } catch (err: any) {
    return c.json({ error: "Unauthorized" }, 401);
  }
};

export const widgetTenantMiddleware = async (c: Context, next: Next) => {
  const widgetKey = c.req.query('key') || c.req.header('X-Widget-Key') || 'default-widget-key';

  const resolver = new WidgetTenantResolver(c.env.DB);
  const resolution = await resolver.resolveTenantByKey(widgetKey);

  let tenantId = 'default-tenant';
  if (resolution) {
    tenantId = resolution.tenantId;
  } else if (widgetKey !== 'default-widget-key') {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env);
  c.set('tenantDeps', deps);
  await next();
};
