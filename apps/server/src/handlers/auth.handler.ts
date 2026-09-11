import { Hono, type Context } from "hono";
import { Env } from "../bindings";
import { authService } from "../services/auth/auth.service";
import { mfaService } from "../services/auth/mfa.service";
import { JWTPayload, AppVariables } from "../types";
import { authMiddleware, mfaChallengeMiddleware, mfaEnrollmentMiddleware, loginAuthResolverMiddleware } from "../middleware/auth.middleware";
import { rateLimiter } from "../middleware/rate-limiter";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { UserAuthResolution } from "../auth/user-auth-resolver";
import type { RequestCredentialAuthDecision } from '../observability/request-auth-sli';
import { admitStaffAuthEffect, type StaffAuthCommit, type StaffAuthOperation } from '../budgets/staff-auth-admission.service';
import { admitCustomerAuthEffect } from '../budgets/customer-auth-admission.service';
import { CustomerAuthBudgetFenceError } from '../repositories/customer-auth-budget-fence';

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function recordCredentialDecision(c: { get: (key: 'requestAuthSli') => AppVariables['requestAuthSli'] }, decision: RequestCredentialAuthDecision): void {
  try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
}

type AuthContext = Context<{ Bindings: Env; Variables: AppVariables }>;

async function staffAuthAdmission(c: AuthContext, operation: StaffAuthOperation): Promise<StaffAuthCommit | Response | null> {
  const payload = c.get('jwtPayload') as JWTPayload | undefined;
  if (!payload || !['admin', 'agent'].includes(payload.role)) return null;
  const outcome = await admitStaffAuthEffect({
    env: c.env,
    deps: c.get('tenantDeps')!,
    payload,
    operation,
    now: () => c.env.localNow?.() ?? Date.now(),
  });
  if (outcome.status === 'disabled') return null;
  if (outcome.status === 'admitted') return outcome.commit;
  return outcome.reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

function staffAuthUnavailable(c: AuthContext, commit: StaffAuthCommit): Response {
  commit.settle('unknown');
  return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

function customerAuthUnavailable(c: AuthContext, reason: 'exhausted' | 'unavailable'): Response {
  return reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
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
        tenant_id: authUser.tenantId,
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
      tenant_id: authUser.tenantId,
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
  const admission = await staffAuthAdmission(c, 'staff.auth.mfa.verify');
  if (admission instanceof Response) return admission;
  let user;
  try {
    user = admission ? await admission.user() : await d.repositories.users.get(payload.sub);
  } catch {
    if (admission) return staffAuthUnavailable(c, admission);
    recordCredentialDecision(c, 'unavailable');
    return c.json({ error: "Unauthorized: Invalid or expired MFA challenge token" }, 401);
  }

  if (!user || !user.mfa_secret || !user.mfa_enabled) {
    admission?.settle('committed');
    recordCredentialDecision(c, 'denied');
    return c.json({ error: "MFA is not set up for this user" }, 400);
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (err) {
    admission?.settle('committed');
    recordCredentialDecision(c, 'unavailable');
    return c.json({ error: "Failed to decrypt MFA secret" }, 500);
  }

  let isValid: boolean;
  try {
    isValid = mfaService.verifyCode(code, decryptedSecret);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  if (!isValid) {
    admission?.settle('committed');
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
    if (admission) await admission.authorizeCurrent();
    fullToken = await authService.generateToken(userPayload, c.env.JWT_SECRET, true);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  admission?.settle('committed');
  recordCredentialDecision(c, 'accepted');

  return c.json({
    token: fullToken,
    user: {
      id: user.id,
      tenant_id: d.scope.tenantId,
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

  const admission = await staffAuthAdmission(c, 'staff.auth.mfa.setup');
  if (admission instanceof Response) return admission;
  let user;
  try {
    user = admission ? await admission.user() : await d.repositories.users.get(payload.sub);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    throw error;
  }

  if (!user) {
    admission?.settle('committed');
    return c.json({ error: "User not found" }, 404);
  }

  if (user.mfa_enabled) {
    admission?.settle('committed');
    return c.json({ error: "MFA is already enabled" }, 400);
  }

  if (admission && user.mfa_secret) {
    try {
      const retainedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
      admission.settle('committed');
      return c.json({ provisioning_uri: mfaService.getProvisioningUri(user.email, retainedSecret) });
    } catch {
      return staffAuthUnavailable(c, admission);
    }
  }
  let secret: string;
  let uri: string;
  let encryptedSecret: string;
  try {
    secret = mfaService.generateSecret();
    uri = mfaService.getProvisioningUri(user.email, secret);
    encryptedSecret = await mfaService.encryptSecret(secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    throw error;
  }

  let started: boolean;
  if (admission) {
    try {
      const enrolled = await admission.beginMfaEnrollment(encryptedSecret);
      started = !!enrolled;
      if (started) {
        if (!enrolled?.mfa_secret) return staffAuthUnavailable(c, admission);
        const actual = await mfaService.decryptSecret(enrolled.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
        admission.settle('committed');
        return c.json({ provisioning_uri: mfaService.getProvisioningUri(enrolled.email, actual) });
      }
    } catch {
      return staffAuthUnavailable(c, admission);
    }
  } else {
    started = await d.repositories.users.beginMfaEnrollment(user.id, encryptedSecret, payload.session_version ?? 0);
  }
  if (!started) {
    admission?.settle('committed');
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
  const admission = await staffAuthAdmission(c, 'staff.auth.mfa.confirm');
  if (admission instanceof Response) return admission;
  let user;
  try {
    user = admission ? await admission.user() : await d.repositories.users.get(payload.sub);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    throw error;
  }

  if (!user || !user.mfa_secret) {
    admission?.settle('committed');
    return c.json({ error: "MFA setup has not been initiated" }, 400);
  }

  if (user.mfa_enabled) {
    admission?.settle('committed');
    return c.json({ error: "MFA is already enabled" }, 400);
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (err) {
    admission?.settle('committed');
    return c.json({ error: "Failed to decrypt MFA secret" }, 500);
  }

  let isValid: boolean;
  try {
    isValid = mfaService.verifyCode(code, decryptedSecret);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    throw error;
  }
  if (!isValid) {
    admission?.settle('committed');
    return c.json({ error: "Invalid MFA code" }, 400);
  }

  const previousVersion = payload.session_version ?? 0;
  const userPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id || (payload as any).tenant_id,
    session_version: previousVersion + 1,
  };
  let fullToken: string | undefined;
  if (admission) {
    try {
      // Sign before the one-way session-version mutation. A signing failure
      // therefore cannot enable MFA without returning its usable credential.
      fullToken = await authService.generateToken(userPayload, c.env.JWT_SECRET, true);
    } catch {
      return staffAuthUnavailable(c, admission);
    }
  }
  let confirmed: boolean;
  if (admission) {
    try {
      confirmed = await admission.completeMfaEnrollment(user.mfa_secret);
    } catch {
      return staffAuthUnavailable(c, admission);
    }
  } else {
    confirmed = await d.repositories.users.completeMfaEnrollment(user.id, user.mfa_secret, previousVersion);
  }
  if (!confirmed) {
    admission?.settle('committed');
    return c.json({ error: "MFA enrollment changed. Sign in again to continue." }, 409);
  }
  // Migration 0022 advances this version once when MFA becomes enabled. Do not
  // adopt a later version from a concurrent logout or authority change.
  user.session_version = previousVersion + 1;
  if (!fullToken) {
    fullToken = await authService.generateToken({ ...userPayload, session_version: user.session_version ?? 0 }, c.env.JWT_SECRET, true);
  }
  admission?.settle('committed');

  return c.json({
    token: fullToken,
    user: {
      id: user.id,
      tenant_id: d.scope.tenantId,
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
  const admission = await admitCustomerAuthEffect({
    env: c.env,
    deps: d,
    operation: 'mfa.disable',
    principal: { kind: 'session', sessionVersion: payload.session_version ?? -1 },
    credentialKey: `customer:${payload.sub}:${payload.session_version ?? -1}`,
    now: c.env.localNow,
  });
  if (admission.status === 'rejected') return customerAuthUnavailable(c, admission.reason!);

  let user;
  try {
    user = await d.repositories.users.get(payload.sub, admission.admission?.fence);
  } catch (error) {
    admission.admission?.settle('unknown');
    if (error instanceof CustomerAuthBudgetFenceError) return customerAuthUnavailable(c, 'unavailable');
    throw error;
  }

  if (!user) {
    admission.admission?.settle('committed');
    return c.json({ error: "User not found" }, 404);
  }

  try {
    await d.repositories.users.update(user.id, { mfa_enabled: false, mfa_secret: null }, admission.admission?.fence);
    admission.admission?.settle('committed');
  } catch (error) {
    admission.admission?.settle('unknown');
    if (error instanceof CustomerAuthBudgetFenceError) return customerAuthUnavailable(c, 'unavailable');
    throw error;
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      mfa_enabled: false,
      tenant_id: d.scope.tenantId,
    },
  });
});

// Revoke all sessions for the authenticated account.
auth.post("/logout", authMiddleware, tenantMiddleware, async (c) => {
  const d = c.get("tenantDeps") as TenantRequestDeps;
  const admission = await staffAuthAdmission(c, 'staff.auth.logout');
  if (admission instanceof Response) return admission;
  if (admission) {
    try {
      if (!await admission.revokeSessions()) return staffAuthUnavailable(c, admission);
      admission.settle('committed');
    } catch {
      return staffAuthUnavailable(c, admission);
    }
  } else {
    await d.repositories.users.revokeSessions((c.get("jwtPayload") as JWTPayload).sub);
  }
  return c.json({ success: true });
});

/** Get current user (me). */
auth.get("/me", authMiddleware, tenantMiddleware, async (c) => {
  const payload = c.get("jwtPayload") as JWTPayload;
  const d = c.get("tenantDeps") as TenantRequestDeps;

  const admission = await staffAuthAdmission(c, 'staff.auth.me');
  if (admission instanceof Response) return admission;
  let user;
  try {
    user = admission ? await admission.user() : await d.repositories.users.get(payload.sub);
  } catch (error) {
    if (admission) return staffAuthUnavailable(c, admission);
    throw error;
  }

  if (!user) {
    admission?.settle('committed');
    return c.json({ error: "User not found" }, 404);
  }

  admission?.settle('committed');
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      mfa_enabled: !!user.mfa_enabled,
      tenant_id: d.scope.tenantId,
    },
  });
});

export default auth;
