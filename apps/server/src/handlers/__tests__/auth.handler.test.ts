import { describe, it, expect, vi, beforeEach } from "vitest";
import auth from "../auth.handler";
import { authService } from "../../services/auth/auth.service";
import { mfaService } from "../../services/auth/mfa.service";
import * as jose from "jose";
import * as OTPAuth from "otpauth";

// Mock DB
const mockDB = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  run: vi.fn(),
};

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";
const MFA_ENCRYPTION_KEY = "test-mfa-encryption-key";

describe("Auth Handler Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /login", () => {
    it("should login successfully when MFA is disabled", async () => {
      const password = "password123";
      const passwordHash = await authService.hashPassword(password);
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "test@example.com",
        password_hash: passwordHash,
        mfa_enabled: 0,
        role: "customer",
        full_name: "Test User",
      };

      mockDB.first.mockResolvedValue(mockUser);

      const res = await auth.request(
        "/login",
        {
          method: "POST",
          body: JSON.stringify({ email: "test@example.com", password }),
          headers: { "Content-Type": "application/json" },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mfa_required).toBe(false);
      expect(body.user.tenant_id).toBe(mockUser.tenant_id);
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe(mockUser.email);
      expect(body.user.mfa_enabled).toBe(false);
    });

    it("should return mfa_required when MFA is enabled", async () => {
      const password = "password123";
      const passwordHash = await authService.hashPassword(password);
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "mfa@example.com",
        password_hash: passwordHash,
        mfa_enabled: 1,
        role: "admin",
        full_name: "MFA User",
      };

      mockDB.first.mockResolvedValue(mockUser);

      const res = await auth.request(
        "/login",
        {
          method: "POST",
          body: JSON.stringify({ email: "mfa@example.com", password }),
          headers: { "Content-Type": "application/json" },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mfa_required).toBe(true);
      expect(body.user.tenant_id).toBe(mockUser.tenant_id);
      expect(body.token).toBeDefined();
      expect(body.user.mfa_enabled).toBe(true);

      // Verify token has mfa_verified = false
      const secretKey = new TextEncoder().encode(JWT_SECRET);
      const { payload } = await jose.jwtVerify(body.token, secretKey);
      expect(payload.mfa_verified).toBe(false);
    });

    it("should return 401 for invalid password", async () => {
      const passwordHash = await authService.hashPassword("correctPassword");
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "test@example.com",
        password_hash: passwordHash,
        mfa_enabled: 0,
        role: "customer",
      };

      mockDB.first.mockResolvedValue(mockUser);

      const res = await auth.request(
        "/login",
        {
          method: "POST",
          body: JSON.stringify({ email: "test@example.com", password: "wrongPassword" }),
          headers: { "Content-Type": "application/json" },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });

    it("should return 401 for non-existent user", async () => {
      mockDB.first.mockResolvedValue(null);

      const res = await auth.request(
        "/login",
        {
          method: "POST",
          body: JSON.stringify({ email: "nonexistent@example.com", password: "password" }),
          headers: { "Content-Type": "application/json" },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });
  });

  describe("POST /mfa/verify", () => {
    it("should verify a valid MFA code", async () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const encryptedSecret = await mfaService.encryptSecret(secret, MFA_ENCRYPTION_KEY);
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "mfa@example.com",
        mfa_secret: encryptedSecret,
        mfa_enabled: 1,
        role: "admin",
      };

      // Generate a valid code for this secret
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
      });
      const code = totp.generate();

      mockDB.first.mockResolvedValue(mockUser);

      // We need a pre-mfa token to access this route
      const preMfaToken = await authService.generateMfaChallengeToken(mockUser as any, JWT_SECRET);

      const res = await auth.request(
        "/mfa/verify",
        {
          method: "POST",
          body: JSON.stringify({ code }),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${preMfaToken}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeDefined();

      // Verify token has mfa_verified = true
      expect(body.user.tenant_id).toBe(mockUser.tenant_id);
      const secretKey = new TextEncoder().encode(JWT_SECRET);
      const { payload } = await jose.jwtVerify(body.token, secretKey);
      expect(payload.mfa_verified).toBe(true);
    });

    it("should return 401 for invalid MFA code", async () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const encryptedSecret = await mfaService.encryptSecret(secret, MFA_ENCRYPTION_KEY);
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "mfa@example.com",
        mfa_secret: encryptedSecret,
        mfa_enabled: 1,
        role: "admin",
      };

      mockDB.first.mockResolvedValue(mockUser);
      const preMfaToken = await authService.generateMfaChallengeToken(mockUser as any, JWT_SECRET);

      const res = await auth.request(
        "/mfa/verify",
        {
          method: "POST",
          body: JSON.stringify({ code: "000000" }),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${preMfaToken}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid MFA code");
    });
  });

  describe("POST /mfa/setup", () => {
    it("should generate MFA secret and URI", async () => {
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "setup@example.com",
        role: "admin",
        mfa_enabled: 0,
      };

      mockDB.first.mockResolvedValue(mockUser);
      mockDB.run.mockResolvedValue({ success: true });

      const token = await authService.generateToken(mockUser as any, JWT_SECRET, true);

      const res = await auth.request(
        "/mfa/setup",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.provisioning_uri).toContain("otpauth://totp/Luminatick:setup%40example.com");

      // Check if DB was updated with the secret
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET mfa_secret = ?"));
    });
  });

  describe("POST /mfa/confirm", () => {
    it("should finalize MFA setup with valid code", async () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const encryptedSecret = await mfaService.encryptSecret(secret, MFA_ENCRYPTION_KEY);
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "confirm@example.com",
        mfa_secret: encryptedSecret,
        mfa_enabled: 0,
        role: "agent",
      };

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
      });
      const code = totp.generate();

      mockDB.first.mockResolvedValue(mockUser);
      mockDB.run.mockResolvedValue({ success: true });

      const token = await authService.generateToken(mockUser as any, JWT_SECRET, true);

      const res = await auth.request(
        "/mfa/confirm",
        {
          method: "POST",
          body: JSON.stringify({ code }),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeDefined();

      // Check if DB was updated to enable MFA
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET mfa_enabled ="));
    });
  });

  describe("enrollment token boundaries", () => {
    const user = { id: "enrollment-user", tenant_id: "default-tenant", email: "enrollment@example.invalid", role: "admin", mfa_enabled: 0, session_version: 3 };

    it.each(["/mfa/setup", "/mfa/confirm"])("rejects invalid authority before %s changes any account", async path => {
      mockDB.first.mockResolvedValue(user);
      for (const changes of [
        { aud: "widget" }, { aud: "unknown" }, { aud: ["app", "mfa-challenge"] },
        { aud: "app", mfa_verified: false }, { session_version: 2 },
        { role: "agent" }, { exp: 1 }, { tenant_id: "" },
      ]) {
        const token = await new jose.SignJWT({ sub: user.id, tenant_id: user.tenant_id, role: user.role,
          session_version: 3, mfa_verified: false, aud: "mfa-challenge", iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 60, ...changes })
          .setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(JWT_SECRET));
        const response = await auth.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456" }) },
          { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY });
        expect(response.status).toBe(401);
      }
      expect(mockDB.run).not.toHaveBeenCalled();
      expect(mockDB.prepare.mock.calls.some(([sql]) => /^UPDATE users SET mfa_/.test(sql))).toBe(false);
    });

    it("does not allow challenge sessions to access app routes or app sessions to verify challenges", async () => {
      mockDB.first.mockResolvedValue(user);
      const challenge = await authService.generateMfaChallengeToken(user, JWT_SECRET);
      const app = await authService.generateToken(user, JWT_SECRET, true);
      for (const path of ["/me", "/logout", "/mfa/disable"]) {
        const response = await auth.request(path, { method: path === "/me" ? "GET" : "POST", headers: { Authorization: `Bearer ${challenge}` } }, { DB: mockDB as any, JWT_SECRET });
        expect(response.status).toBe(401);
      }
      const response = await auth.request("/mfa/verify", { method: "POST", headers: { Authorization: `Bearer ${app}` } }, { DB: mockDB as any, JWT_SECRET });
      expect(response.status).toBe(401);
      expect(mockDB.run).not.toHaveBeenCalled();
      expect(mockDB.prepare.mock.calls.some(([sql]) => /^UPDATE users SET mfa_/.test(sql))).toBe(false);
    });

    it.each(["/mfa/setup", "/mfa/confirm"])("returns a recoverable conflict when an enrollment write loses at %s", async path => {
      const secret = mfaService.generateSecret();
      const encrypted = await mfaService.encryptSecret(secret, MFA_ENCRYPTION_KEY);
      const pending = { ...user, mfa_secret: encrypted };
      mockDB.first.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
      const token = await authService.generateMfaChallengeToken(user, JWT_SECRET);
      const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
      const response = await auth.request(path, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }, { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY });
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.token).toBeUndefined();
      expect(body.provisioning_uri).toBeUndefined();
    });

    it.each(["/mfa/setup", "/mfa/confirm"])("rejects enrolled account mutation at %s", async path => {
      mockDB.first.mockResolvedValue({ ...user, mfa_enabled: 1, mfa_secret: "not-read-for-reenrollment" });
      const token = await authService.generateMfaChallengeToken(user, JWT_SECRET);
      const response = await auth.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ code: "123456" }) },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY });
      expect(response.status).toBe(400);
      expect(mockDB.run).not.toHaveBeenCalled();
      expect(mockDB.prepare.mock.calls.some(([sql]) => /^UPDATE users SET mfa_/.test(sql))).toBe(false);
    });
  });

  describe("POST /mfa/disable", () => {
    it("should disable MFA for a user and clear the secret", async () => {
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "disable@example.com",
        mfa_enabled: 1,
        mfa_secret: "some-encrypted-secret",
        role: "customer",
      };

      mockDB.first.mockResolvedValue(mockUser);
      mockDB.run.mockResolvedValue({ success: true });

      const token = await authService.generateToken(mockUser as any, JWT_SECRET, true);

      const res = await auth.request(
        "/mfa/disable",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.mfa_enabled).toBe(false);

      // Check if DB was updated to disable MFA and clear secret
      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET"));
    });

    it("should return 404 if user not found", async () => {
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("tenant_id, id, role")) {
          return { tenant_id: "default-tenant", id: "user-1", role: "customer" }; // authMiddleware user revalidation succeeds
        }
        return null; // handler repo user lookup returns null
      });
      const token = await authService.generateToken({ id: "user-1", tenant_id: "default-tenant", email: "test@example.com", role: "customer" } as any, JWT_SECRET, true);

      const res = await auth.request(
        "/mfa/disable",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");
    });
  });

  describe("GET /me", () => {
    it("should return the current user profile with mfa_enabled status true", async () => {
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "me@example.com",
        mfa_enabled: 1,
        role: "agent",
      };

      mockDB.first.mockResolvedValue(mockUser);
      const token = await authService.generateToken(mockUser as any, JWT_SECRET, true);

      const res = await auth.request(
        "/me",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe(mockUser.email);
      expect(body.user.mfa_enabled).toBe(true);
      expect(body.user.tenant_id).toBe(mockUser.tenant_id);
    });

    it("should return the current user profile with mfa_enabled status false", async () => {
      const mockUser = {
        id: "user-1",
        tenant_id: "default-tenant",
        email: "me2@example.com",
        mfa_enabled: 0,
        role: "agent",
      };

      mockDB.first.mockResolvedValue(mockUser);
      const token = await authService.generateToken(mockUser as any, JWT_SECRET, true);

      const res = await auth.request(
        "/me",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, MFA_ENCRYPTION_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe(mockUser.email);
      expect(body.user.mfa_enabled).toBe(false);
      expect(body.user.tenant_id).toBe(mockUser.tenant_id);
    });
  });
});
