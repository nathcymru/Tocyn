import { Hono } from "hono";
import { Env } from "../bindings";
import { authService } from "../services/auth/auth.service";
import { mfaService } from "../services/auth/mfa.service";
import { JWTPayload, AppVariables } from "../types";
import { authMiddleware, mfaChallengeMiddleware, loginAuthResolverMiddleware } from "../middleware/auth.middleware";
import { rateLimiter } from "../middleware/rate-limiter";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { UserAuthResolution } from "../auth/user-auth-resolver";

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();


/**
 * Stage 1: Login with credentials
 */
auth.post("/login", rateLimiter(5, 60000), loginAuthResolverMiddleware, async (c) => {
  const { email, password } = (c.get("loginBody" as any) || {}) as { email?: string; password?: string };
  const authUser = c.get("resolvedUser" as any) as UserAuthResolution | null;

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return c.json({ error: "Email and password are required" }, 400);
  }

  if (!authUser || !authUser.passwordHash) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const isValid = await authService.verifyPassword(password, authUser.passwordHash);
  if (!isValid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const isAgentOrAdmin = authUser.role === "admin" || authUser.role === "agent";
  const requiresMfa = authUser.mfaEnabled || isAgentOrAdmin;

  const userPayload = {
    id: authUser.userId,
    email: email.toLowerCase().trim(),
    role: authUser.role as any,
    tenant_id: authUser.tenantId,
  };

  // If MFA is required, return a short-lived mfa-challenge token
  if (requiresMfa) {
    const preMfaToken = await authService.generateMfaChallengeToken(
      userPayload,
      c.env.JWT_SECRET,
      "15m"
    );

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
  const fullToken = await authService.generateToken(
    userPayload,
    c.env.JWT_SECRET,
    true
  );

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
  const { code } = await c.req.json();

  if (!code) {
    return c.json({ error: "MFA code is required" }, 400);
  }

  const d = c.get("tenantDeps") as TenantRequestDeps;
  const user = await d.repositories.users.get(payload.sub);

  if (!user || !user.mfa_secret || !user.mfa_enabled) {
    return c.json({ error: "MFA is not set up for this user" }, 400);
  }

  let decryptedSecret: string;
  try {
    decryptedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (err) {
    return c.json({ error: "Failed to decrypt MFA secret" }, 500);
  }

  const isValid = mfaService.verifyCode(code, decryptedSecret);
  if (!isValid) {
    return c.json({ error: "Invalid MFA code" }, 401);
  }

  const userPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id || (payload as any).tenant_id,
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
      mfa_enabled: !!user.mfa_enabled,
    },
  });
});

/**
 * Stage 3: Setup MFA
 */
auth.post("/mfa/setup", authMiddleware, tenantMiddleware, async (c) => {
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

  await d.repositories.users.update(user.id, { mfa_secret: encryptedSecret });

  return c.json({
    provisioning_uri: uri,
  });
});

/**
 * Stage 3: Confirm MFA
 */
auth.post("/mfa/confirm", authMiddleware, tenantMiddleware, async (c) => {
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

  let decryptedSecret: string;
  try {
    decryptedSecret = await mfaService.decryptSecret(user.mfa_secret, c.env.MFA_ENCRYPTION_KEY);
  } catch (err) {
    return c.json({ error: "Failed to decrypt MFA secret" }, 500);
  }

  const isValid = mfaService.verifyCode(code, decryptedSecret);
  if (!isValid) {
    return c.json({ error: "Invalid MFA code" }, 401);
  }

  await d.repositories.users.update(user.id, { mfa_enabled: true });

  const userPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenant_id || (payload as any).tenant_id,
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

/**
 * Get current user (me)
 */
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
