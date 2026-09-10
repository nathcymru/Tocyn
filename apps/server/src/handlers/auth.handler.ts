import { Hono } from "hono";
import { Env } from "../bindings";
import { authService } from "../services/auth/auth.service";
import { mfaService } from "../services/auth/mfa.service";
import { JWTPayload, AppVariables } from "../types";
import { authMiddleware, mfaChallengeMiddleware, mfaEnrollmentMiddleware, loginAuthResolverMiddleware } from "../middleware/auth.middleware";
import { rateLimiter } from "../middleware/rate-limiter";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { UserAuthResolution } from "../auth/user-auth-resolver";
import type { RequestCredentialAuthDecision } from '../observability/request-auth-sli';

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function recordCredentialDecision(c: { get: (key: 'requestAuthSli') => AppVariables['requestAuthSli'] }, decision: RequestCredentialAuthDecision): void {
  try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
}


/**
 * Stage 1: Login with credentials
 */
auth.post("/login", rateLimiter(5, 60000), loginAuthResolverMiddleware, async (c) => {
  const { email, password } = (c.get("loginBody" as any) || {}) as { email?: string; password?: string };
  const authUser = c.get("resolvedUser" as any) as UserAuthResolution | null;

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return c.json({ error: "Email and password are required" }, 400);
  }

  if (c.get('loginAdmissionSuppressed')) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (!authUser || !authUser.passwordHash) {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: "Invalid credentials" }, 401);
  }

  let isValid: boolean;
  try {
    isValid = await authService.verifyPassword(password, authUser.passwordHash);
  } catch (error) {
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  if (!isValid) {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const isAgentOrAdmin = authUser.role === "admin" || authUser.role === "agent";
  const requiresMfa = authUser.mfaEnabled || isAgentOrAdmin;

  const userPayload = {
    id: authUser.userId,
    email: email.toLowerCase().trim(),
    role: authUser.role as any,
    tenant_id: authUser.tenantId,
    session_version: authUser.sessionVersion,
  };

  // If MFA is required, return a short-lived mfa-challenge token
  if (requiresMfa) {
    let preMfaToken: string;
    try {
      preMfaToken = await authService.generateMfaChallengeToken(userPayload, c.env.JWT_SECRET, "15m");
    } catch (error) {
      recordCredentialDecision(c, 'unavailable');
      throw error;
    }
    recordCredentialDecision(c, 'challenge');

    return c.json({
      mfa_required: true,
      token: preMfaToken,
      user: {
        id: authUser.userId,
        email: email.toLowerCase().trim(),
        role: authUser.role,
        mfa_enabled: !!authUser.mfaEnabled,
      },
    });
  }

  // If MFA is not required, return a full app token
  let fullToken: string;
  try {
    fullToken = await authService.generateToken(userPayload, c.env.JWT_SECRET, true);
  } catch (error) {
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  recordCredentialDecision(c, 'accepted');

  return c.json({
    mfa_required: false,
    token: fullToken,
    user: {
      id: authUser.userId,
      email: email.toLowerCase().trim(),
      role: authUser.role,
      mfa_enabled: !!authUser.mfaEnabled,
    },
  });
});

/**
 * Stage 2: Verify MFA code
 */
auth.post("/mfa/verify", mfaChallengeMiddleware, rateLimiter(10, 60000), async (c) => {
  const payload = c.get("jwtPayload") as JWTPayload;
  let requestBody: { code?: unknown };
  try {
    requestBody = await c.req.json();
  } catch {
    // Keep malformed request handling outside the credential denominator.
    // This preserves the middleware's existing indistinguishable 401 response.
    return c.json({ error: "Unauthorized: Invalid or expired MFA challenge token" }, 401);
  }
  const { code } = requestBody;

  if (!code || typeof code !== 'string') {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: "MFA code is required" }, 400);
  }

  const d = c.get("tenantDeps") as TenantRequestDeps;
  let user;
  try {
    user = await d.repositories.users.get(payload.sub);
  } catch {
    recordCredentialDecision(c, 'unavailable');
    return c.json({ error: "Unauthorized: Invalid or expired MFA challenge token" }, 401);
  }

  if (!user || !user.mfa_secret || !user.mfa_enabled) {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: "MFA is not set up for this user" }, 400);
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (err) {
    recordCredentialDecision(c, 'unavailable');
    return c.json({ error: "Failed to decrypt MFA secret" }, 500);
  }

  let isValid: boolean;
  try {
    isValid = mfaService.verifyCode(code, decryptedSecret);
  } catch (error) {
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  if (!isValid) {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: "Invalid MFA code" }, 400);
  }

  const userPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id || (payload as any).tenant_id,
    session_version: user.session_version ?? 0,
  };

  let fullToken: string;
  try {
    fullToken = await authService.generateToken(userPayload, c.env.JWT_SECRET, true);
  } catch (error) {
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  recordCredentialDecision(c, 'accepted');

  return c.json({
    token: fullToken,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      mfa_enabled: !!user.mfa_enabled,
    },
  });
});

/**
 * Stage 3: Setup MFA
 */
auth.post("/mfa/setup", mfaEnrollmentMiddleware, tenantMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as JWTPayload;
  const d = c.get("tenantDeps") as TenantRequestDeps;

  const user = await d.repositories.users.get(payload.sub);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  if (user.mfa_enabled) {
    return c.json({ error: "MFA is already enabled" }, 400);
  }

  const secret = mfaService.generateSecret();
  const uri = mfaService.getProvisioningUri(user.email, secret);
  const encryptedSecret = await mfaService.encryptSecret(secret, c.env.MFA_ENCRYPTION_KEY);

  const started = await d.repositories.users.beginMfaEnrollment(user.id, encryptedSecret, payload.session_version ?? 0);
  if (!started) {
    return c.json({ error: "MFA enrollment changed. Sign in again to continue." }, 409);
  }

  return c.json({
    provisioning_uri: uri,
  });
});

/**
 * Stage 3: Confirm MFA
 */
auth.post("/mfa/confirm", mfaEnrollmentMiddleware, tenantMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as JWTPayload;
  const { code } = await c.req.json();

  if (!code) {
    return c.json({ error: "MFA code is required" }, 400);
  }

  const d = c.get("tenantDeps") as TenantRequestDeps;
  const user = await d.repositories.users.get(payload.sub);

  if (!user || !user.mfa_secret) {
    return c.json({ error: "MFA setup has not been initiated" }, 400);
  }

  if (user.mfa_enabled) {
    return c.json({ error: "MFA is already enabled" }, 400);
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (err) {
    return c.json({ error: "Failed to decrypt MFA secret" }, 500);
  }

  const isValid = mfaService.verifyCode(code, decryptedSecret);
  if (!isValid) {
    return c.json({ error: "Invalid MFA code" }, 400);
  }

  const previousVersion = payload.session_version ?? 0;
  const confirmed = await d.repositories.users.completeMfaEnrollment(user.id, user.mfa_secret, previousVersion);
  if (!confirmed) {
    return c.json({ error: "MFA enrollment changed. Sign in again to continue." }, 409);
  }
  // Migration 0022 advances this version once when MFA becomes enabled. Do not
  // adopt a later version from a concurrent logout or authority change.
  user.session_version = previousVersion + 1;

  const userPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id || (payload as any).tenant_id,
    session_version: user.session_version ?? 0,
  };

  const fullToken = await authService.generateToken(
    userPayload,
    c.env.JWT_SECRET,
    true
  );

  return c.json({
    token: fullToken,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      mfa_enabled: true,
    },
  });
});

/**
 * Disable MFA
 */
auth.post("/mfa/disable", authMiddleware, tenantMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as JWTPayload;

  if (payload.role === "admin" || payload.role === "agent") {
    return c.json({ error: "MFA is mandatory for agents and administrators and cannot be disabled." }, 403);
  }

  const d = c.get("tenantDeps") as TenantRequestDeps;
  const user = await d.repositories.users.get(payload.sub);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  await d.repositories.users.update(user.id, { mfa_enabled: false, mfa_secret: null });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      mfa_enabled: false,
    },
  });
});

// Revoke all sessions for the authenticated account.
auth.post("/logout", authMiddleware, tenantMiddleware, async (c) => {
  const d = c.get("tenantDeps") as TenantRequestDeps;
  await d.repositories.users.revokeSessions((c.get("jwtPayload") as JWTPayload).sub);
  return c.json({ success: true });
});

/** Get current user (me). */
auth.get("/me", authMiddleware, tenantMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as JWTPayload;
  const d = c.get("tenantDeps") as TenantRequestDeps;

  const user = await d.repositories.users.get(payload.sub);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      mfa_enabled: !!user.mfa_enabled,
    },
  });
});

export default auth;
