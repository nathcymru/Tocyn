import { AuthService } from '../services/auth/auth.service';
import { authorizeLocalBeta } from './local-beta';
import { BetaAdmissionError } from '../types/local-beta';
import { Context, Next } from "hono";
import { Env } from "../bindings";
import * as jose from "jose";
import { AppVariables } from "../types";
import { getCookie } from "hono/cookie";
import { createVerifiedTenantScope } from "../auth/scope";
import { createTenantRequestDeps } from "./tenant.middleware";
import { UserAuthResolver, UserAuthResolution } from "../auth/user-auth-resolver";
import { observeD1 } from '../repositories/observed-d1';
import type { ResourceOperationEmitter } from '../observability/resource-operation';
import type { RequestCredentialAuthDecision } from '../observability/request-auth-sli';

function recordCredentialDecision(c: Context<{ Bindings: Env; Variables: AppVariables }>, decision: RequestCredentialAuthDecision): void {
  try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
}

function isKnownJwtCredentialFailure(error: unknown): boolean {
  return error instanceof jose.errors.JOSEAlgNotAllowed
    || error instanceof jose.errors.JWSInvalid
    || error instanceof jose.errors.JWSSignatureVerificationFailed
    || error instanceof jose.errors.JWTClaimValidationFailed
    || error instanceof jose.errors.JWTExpired
    || error instanceof jose.errors.JWTInvalid;
}

export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  let recorded = false;
  const record = (decision: RequestCredentialAuthDecision) => {
    if (recorded) return;
    recorded = true;
    try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
  };
  const authHeader = c.req.header("Authorization");
  const cookieToken = getCookie(c, "lumina_customer_token");

  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);
  else if (cookieToken) token = cookieToken;

  if (!token) {
    record('denied');
    return c.json({ error: "Unauthorized: Missing or invalid token format" }, 401);
  }

  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, new TextEncoder().encode(c.env.JWT_SECRET), {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      audience: "app",
    }));
  } catch (error) {
    // Only jose's explicit credential-validation failures are trustworthy
    // denials. Other verifier/runtime failures retain the existing 401
    // response but are unavailable SLI evidence, never inferred rejection.
    const denied = error instanceof jose.errors.JOSEAlgNotAllowed
      || error instanceof jose.errors.JWSInvalid
      || error instanceof jose.errors.JWSSignatureVerificationFailed
      || error instanceof jose.errors.JWTClaimValidationFailed
      || error instanceof jose.errors.JWTExpired
      || error instanceof jose.errors.JWTInvalid;
    record(denied ? 'denied' : 'unavailable');
    return c.json({ error: "Unauthorized: Invalid or expired token" }, 401);
  }

  try {
    const tenantId = (payload as any).tenant_id;
    const sub = payload.sub as string;

    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      record('denied');
      return c.json({ error: "Unauthorized: Missing or invalid tenant context" }, 401);
    }

    if (!sub || typeof sub !== "string" || !sub.trim()) {
      record('denied');
      return c.json({ error: "Unauthorized: Missing or invalid subject claim" }, 401);
    }

    let activeRole = payload.role as string;
    if (!c.env.DB) {
      record('unavailable');
      return c.json({ error: "Unauthorized: Database unavailable" }, 401);
    }

    const resolver = new UserAuthResolver(observeD1(c.env.DB, c.get('resourceOperationEmitter')));
    const userRes = await resolver.resolveUserById(tenantId, sub);
    if (userRes && (!Number.isSafeInteger(payload.session_version ?? 0) || (payload.session_version ?? 0) !== userRes.sessionVersion)) {
      record('denied');
      return c.json({ error: "Unauthorized: Session revoked" }, 401);
    }
    if (!userRes) {
      record('denied');
      return c.json({ error: "Unauthorized: User account no longer exists" }, 401);
    }
    if (userRes.role !== payload.role) {
      record('denied');
      return c.json({ error: "Unauthorized: User role changed" }, 401);
    }
    activeRole = userRes.role;

    c.set("jwtPayload", { ...payload, sub, tenant_id: tenantId, role: activeRole } as any);
    const scope = createVerifiedTenantScope(tenantId, sub, [activeRole], userRes.sessionVersion);
    // Live identity, role, session, and tenant scope are authoritative here.
    // Admission and MFA remain separate gates; HTTP status is not consulted.
    record(payload.mfa_verified === true ? 'accepted' : 'challenge');
    await authorizeLocalBeta(c.env, scope, undefined, c.get('resourceOperationEmitter'));
    c.set("tenantScope", scope as any);

    const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'));
    c.set("tenantDeps", deps as any);

    await next();
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    record('unavailable');
    return c.json({ error: "Unauthorized: Invalid or expired token" }, 401);
  }
};

export const mfaChallengeMiddleware = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next, observeCredential = true,
) => {
  const record = (decision: RequestCredentialAuthDecision) => {
    if (observeCredential) recordCredentialDecision(c, decision);
  };
  let challengeVerified = false;
  const authHeader = c.req.header("Authorization");
  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);

  if (!token) {
    record('denied');
    return c.json({ error: "Unauthorized: Missing or invalid token format" }, 401);
  }

  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(c.env.JWT_SECRET), {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      audience: "mfa-challenge",
    });

    const tenantId = (payload as any).tenant_id;
    const sub = payload.sub as string;

    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      record('denied');
      return c.json({ error: "Unauthorized: Missing or invalid tenant context" }, 401);
    }

    if (!sub || typeof sub !== "string" || !sub.trim()) {
      record('denied');
      return c.json({ error: "Unauthorized: Missing or invalid subject claim" }, 401);
    }

    let activeRole = payload.role as string;
    if (!c.env.DB) {
      record('unavailable');
      return c.json({ error: "Unauthorized: Database unavailable" }, 401);
    }

    const resolver = new UserAuthResolver(observeD1(c.env.DB, c.get('resourceOperationEmitter')));
    const userRes = await resolver.resolveUserById(tenantId, sub);
    if (userRes && (!Number.isSafeInteger(payload.session_version ?? 0) || (payload.session_version ?? 0) !== userRes.sessionVersion)) {
      record('denied');
      return c.json({ error: "Unauthorized: Session revoked" }, 401);
    }
    if (!userRes) {
      record('denied');
      return c.json({ error: "Unauthorized: User account no longer exists" }, 401);
    }
    if (userRes.role !== payload.role) {
      record('denied');
      return c.json({ error: "Unauthorized: User role changed" }, 401);
    }
    activeRole = userRes.role;

    c.set("jwtPayload", { ...payload, sub, tenant_id: tenantId, role: activeRole } as any);
    const scope = createVerifiedTenantScope(tenantId, sub, [activeRole], userRes.sessionVersion);
    challengeVerified = true;
    await authorizeLocalBeta(c.env, scope, undefined, c.get('resourceOperationEmitter'));
    c.set("tenantScope", scope as any);

    const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'));
    c.set("tenantDeps", deps as any);

    await next();
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    // A handler after a verified challenge owns its own credential result.
    // Do not reinterpret its failure as a JWT verifier outcome.
    if (!challengeVerified) record(isKnownJwtCredentialFailure(error) ? 'denied' : 'unavailable');
    return c.json({ error: "Unauthorized: Invalid or expired MFA challenge token" }, 401);
  }
};

/**
 * Enrollment alone accepts either a password-authenticated challenge or an
 * existing completed app session. Decode only selects the existing verifier;
 * it never grants identity, scope or admission before signature verification.
 */
export const mfaEnrollmentMiddleware = async (
  c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next,
) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ")
    ? header.substring(7) : getCookie(c, "lumina_customer_token");
  if (!token) return c.json({ error: "Unauthorized: Missing enrollment session" }, 401);

  let audience: unknown;
  try { audience = jose.decodeJwt(token).aud; }
  catch { return c.json({ error: "Unauthorized: Invalid enrollment session" }, 401); }

  if (audience === "mfa-challenge") return mfaChallengeMiddleware(c, next, false);
  if (audience === "app") {
    return authMiddleware(c, async () => {
      if (c.get("jwtPayload").mfa_verified !== true) {
        c.res = c.json({ error: "Unauthorized: Incomplete app session" }, 401);
        return;
      }
      await next();
    });
  }
  return c.json({ error: "Unauthorized: Invalid enrollment audience" }, 401);
};

export const loginAuthResolverMiddleware = async (c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) => {
  if (!c.env.DB) {
    recordCredentialDecision(c, 'unavailable');
    return c.json({ error: "Authentication unavailable" }, 503);
  }
  const body = await c.req.json().catch(() => ({}));
  let authUser: UserAuthResolution | null = null;

  if (body.email && typeof body.email === "string") {
    try {
      authUser = await new UserAuthResolver(observeD1(c.env.DB, c.get('resourceOperationEmitter'))).resolveCredentialsByEmail(body.email);
    } catch (error) {
      recordCredentialDecision(c, 'unavailable');
      throw error;
    }
  }

  if (authUser) {
    try { await authorizeLocalBeta(c.env, createVerifiedTenantScope(authUser.tenantId, authUser.userId, [authUser.role], 1), undefined, c.get('resourceOperationEmitter')); }
    catch (error) {
      if (error instanceof BetaAdmissionError && error.code === 'beta_not_invited') {
        // Preserve the enumeration-safe response without turning an admission
        // result into a password credential denial.
        c.set('loginAdmissionSuppressed', true);
        authUser = null;
      }
      else if (error instanceof BetaAdmissionError) return c.json({code:error.code,error:error.message},error.status);
      else throw error;
    }
  }
  c.set("loginBody" as any, body);
  c.set("resolvedUser" as any, authUser);
  await next();
};

export type RealtimeVerifiedUser = Readonly<{
  id: string; tenant_id: string; email: string; full_name: string; role: 'agent' | 'admin';
  session_version: number; session_expires_at: number; realtimeScope: ReturnType<typeof createVerifiedTenantScope>;
}>;

/** WebSocket query tokens use the same current session verifier before constructing scope. */
export async function authenticateRealtimeToken(env: Env, token: string, record?: (decision: RequestCredentialAuthDecision) => void, emit?: ResourceOperationEmitter): Promise<RealtimeVerifiedUser | null> {
  const verification = await new AuthService(emit ? { ...env, DB: observeD1(env.DB, emit) } : env).verifyCurrentAppCredential(token);
  if (verification.decision !== 'accepted') {
    try { record?.(verification.decision); } catch { /* Evidence cannot affect authentication. */ }
    return null;
  }
  const user = verification.user as unknown as RealtimeVerifiedUser;
  if (!['agent', 'admin'].includes(user.role)) {
    try { record?.('denied'); } catch { /* Evidence cannot affect authentication. */ }
    return null;
  }
  try { record?.('accepted'); } catch { /* Evidence cannot affect authentication. */ }
  const scope = createVerifiedTenantScope(user.tenant_id!, user.id, [user.role], user.session_version ?? 0);
  await authorizeLocalBeta(env, scope, undefined, emit);
  // Keep the verified scope private to trusted route composition.  Realtime
  // admission must not reconstruct a scope from request-derived headers.
  return Object.freeze({ ...user, realtimeScope: scope });
}
