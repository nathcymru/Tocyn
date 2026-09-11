import { authorizeLocalBeta } from './local-beta';
import { BetaAdmissionError } from '../types/local-beta';
import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import * as jose from 'jose';
import { createVerifiedTenantScope } from '../auth/scope';
import { createTenantRequestDeps } from './tenant.middleware';
import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';
import { UserAuthResolver } from '../auth/user-auth-resolver';
import type { RequestCredentialAuthDecision } from '../observability/request-auth-sli';
import { observeD1 } from '../repositories/observed-d1';

function explicitJoseCredentialFailure(error: unknown): boolean {
  return error instanceof jose.errors.JOSEAlgNotAllowed
    || error instanceof jose.errors.JWSInvalid
    || error instanceof jose.errors.JWSSignatureVerificationFailed
    || error instanceof jose.errors.JWTClaimValidationFailed
    || error instanceof jose.errors.JWTExpired
    || error instanceof jose.errors.JWTInvalid;
}

export const widgetAuthMiddleware = async (c: Context, next: Next) => {
  let recorded = false;
  const record = (decision: RequestCredentialAuthDecision) => {
    if (recorded) return;
    recorded = true;
    try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
  };
  const authHeader = c.req.header("Authorization");
  let token = getCookie(c, "lumina_customer_token");
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    record('denied');
    return c.json({ error: "Unauthorized" }, 401);
  }

  let payload: jose.JWTPayload;
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    ({ payload } = await jose.jwtVerify(token, secret, {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      audience: 'widget',
      ...(c.env.ENVIRONMENT === 'local' && c.env.localNow ? { currentDate: new Date(c.env.localNow()) } : {}),
    }));
  } catch (error) {
    record(explicitJoseCredentialFailure(error) ? 'denied' : 'unavailable');
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    if (typeof payload.tenant_id !== 'string' || !payload.tenant_id.trim() ||
        typeof payload.sub !== 'string' || !payload.sub.trim() ||
        typeof payload.email !== 'string' || !payload.email.trim()) {
      record('denied');
      return c.json({ error: "Unauthorized: Missing tenant context" }, 401);
    }
    
    if (payload.role !== 'customer') {
      record('denied');
      return c.json({ error: "Unauthorized: Invalid widget role" }, 403);
    }

    if (!c.env.DB) {
      record('unavailable');
      return c.json({ error: "Unauthorized: Database unavailable" }, 401);
    }

    const resolver = new UserAuthResolver(observeD1(c.env.DB, c.get('resourceOperationEmitter')));
    const userRes = await resolver.resolveUserById(payload.tenant_id as string, payload.sub as string);
    if (userRes && (!Number.isSafeInteger(payload.session_version ?? 0) || (payload.session_version ?? 0) !== userRes.sessionVersion)) {
      record('denied');
      return c.json({ error: "Unauthorized: Session revoked" }, 401);
    }
    if (!userRes) {
      record('denied');
      return c.json({ error: "Unauthorized: User account no longer exists" }, 401);
    }
    if (typeof userRes.email !== 'string' || !userRes.email || userRes.email !== payload.email) {
      record('denied');
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (userRes.role !== 'customer') {
      record('denied');
      return c.json({ error: "Unauthorized: Invalid widget role" }, 403);
    }

    const scope = createVerifiedTenantScope(
      payload.tenant_id as string,
      payload.sub as string,
      ['customer'],
      userRes.sessionVersion
    );

    // Current signed claims, tenant-scoped identity, email, role and session
    // are all verified before this credential is accepted.
    record('accepted');
    await authorizeLocalBeta(c.env, scope, undefined, c.get('resourceOperationEmitter'));
    const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'), c.get('ownerIngressAdmission'));
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
    if (err instanceof BetaAdmissionError) return c.json({ code: err.code, error: err.message }, err.status);
    record('unavailable');
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

  const resolver = new WidgetTenantResolver(observeD1(c.env.DB, c.get('resourceOperationEmitter')));
  const resolution = await resolver.resolveTenantByKey(widgetKey.trim());

  if (!resolution || !resolution.tenantId) {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(resolution.tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'), c.get('ownerIngressAdmission'));
  c.set('tenantDeps', deps);
  await next();
};
