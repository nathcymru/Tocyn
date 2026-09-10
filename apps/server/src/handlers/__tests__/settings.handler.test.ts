import { describe, it, expect, vi, beforeEach } from "vitest";
import settings from "../settings.handler";
import * as jose from "jose";

// Mock DB
const mockDB = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
};

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";
const APP_MASTER_KEY = "test-master-key-that-is-long-enough-for-aes";

async function generateAdminToken() {
  const secretKey = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({
    sub: "admin-1",
    id: "admin-1",
    email: "admin@example.com",
    role: "admin",
    tenant_id: "default-tenant",
    mfa_enabled: false,
    mfa_verified: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("app")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretKey);
}

describe("Settings Handler Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.prepare.mockReturnThis();
    mockDB.bind.mockReturnThis();
    mockDB.all.mockResolvedValue({ results: [] });
    mockDB.first.mockImplementation(async () => {
      const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
      const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
      if (typeof lastQuery === "string" && lastQuery.includes("deployment_capability_ceiling")) return { enabled: 1, revision: 1 };
      if (typeof lastQuery === "string" && lastQuery.includes("deployment_role_capability_grants")) return { enabled: 1, revision: 1 };
      if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
        return { tenant_id: "default-tenant", id: "admin-1", role: "admin", password_hash: null, mfa_enabled: 0 };
      }
      return null;
    });
  });

  describe("GET /api/settings", () => {
    it("should return settings and mask sensitive values", async () => {
      const configMap: Record<string, string> = {
        APP_NAME: "Luminatick",
        RESEND_API_KEY: "super-secret-key",
        OPENAI_SECRET: "another-secret",
        PUBLIC_URL: "https://example.com",
      };

      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("deployment_capability_ceiling")) return { enabled: 1, revision: 1 };
        if (typeof lastQuery === "string" && lastQuery.includes("deployment_role_capability_grants")) return { enabled: 1, revision: 1 };
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { tenant_id: "default-tenant", id: "admin-1", role: "admin", password_hash: null, mfa_enabled: 0 };
        }
        const calls = vi.mocked(mockDB.bind).mock.calls;
        const lastKey = calls.length > 0 ? calls[calls.length - 1][1] : undefined;
        if (lastKey && configMap[lastKey]) {
          return { value: configMap[lastKey] };
        }
        return null;
      });

      const token = await generateAdminToken();

      const res = await settings.request(
        "/",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.APP_NAME).toBe("Luminatick");
      expect(body.PUBLIC_URL).toBe("https://example.com");
      expect(body.RESEND_API_KEY).toBe("••••••••");
      expect(body.OPENAI_SECRET).toBe("••••••••");
    });

    it("should return 500 if APP_MASTER_KEY is missing but sensitive values exist", async () => {
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("deployment_capability_ceiling")) return { enabled: 1, revision: 1 };
        if (typeof lastQuery === "string" && lastQuery.includes("deployment_role_capability_grants")) return { enabled: 1, revision: 1 };
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { tenant_id: "default-tenant", id: "admin-1", role: "admin", password_hash: null, mfa_enabled: 0 };
        }
        const calls = vi.mocked(mockDB.bind).mock.calls;
        const lastKey = calls.length > 0 ? calls[calls.length - 1][1] : undefined;
        if (lastKey === "RESEND_API_KEY") {
          return { value: "super-secret-key" };
        }
        return null;
      });

      const token = await generateAdminToken();

      const res = await settings.request(
        "/",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET } // Missing APP_MASTER_KEY
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("APP_MASTER_KEY is missing. Cannot verify settings.");
    });
  });

  describe("PUT /api/settings", () => {
    it("rejects unknown suffixed keys before writing any setting", async () => {
      const token = await generateAdminToken();
      for (const key of ['UNEXPECTED_KEY', 'UNEXPECTED_URL']) {
        const res = await settings.request('/', {
          method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type':'application/json'},
          body: JSON.stringify({APP_NAME:'Must not persist', [key]:'value'})
        }, {DB:mockDB as any, JWT_SECRET, APP_MASTER_KEY});
        expect(res.status).toBe(400);
        expect(mockDB.run).not.toHaveBeenCalled();
      }
    });

    it("should update settings and encrypt sensitive values", async () => {
      mockDB.run.mockResolvedValue({ success: true });
      const token = await generateAdminToken();

      const payload = {
        APP_NAME: "New Luminatick",
        RESEND_API_KEY: "new-super-secret-key",
      };

      const res = await settings.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY }
      );

      expect(res.status).toBe(200);

      // Check that tenant_config prepare was called twice (once for each key)
      const configPrepCalls = vi.mocked(mockDB.prepare).mock.calls.filter(c => typeof c[0] === "string" && c[0].includes("tenant_config"));
      expect(configPrepCalls.length).toBe(2);

      // Check that DB.bind was called with default-tenant, key, and encrypted value
      const configBindCalls = vi.mocked(mockDB.bind).mock.calls.filter(c => c[1] === "APP_NAME" || c[1] === "RESEND_API_KEY");
      expect(configBindCalls[0]).toEqual(["default-tenant", "APP_NAME", "New Luminatick"]);

      const resendBindCall = configBindCalls[1];
      expect(resendBindCall[0]).toBe("default-tenant");
      expect(resendBindCall[1]).toBe("RESEND_API_KEY");
      expect(resendBindCall[2]).not.toBe("new-super-secret-key"); // Should be encrypted
      expect(typeof resendBindCall[2]).toBe("string");
      expect(resendBindCall[2].length).toBeGreaterThan("new-super-secret-key".length);

      expect(mockDB.run).toHaveBeenCalledTimes(2);
    });

    it("should skip updating sensitive settings if value is ••••••••", async () => {
      mockDB.run.mockResolvedValue({ success: true });
      const token = await generateAdminToken();

      const payload = {
        APP_NAME: "Updated Name",
        RESEND_API_KEY: "••••••••", // Masked placeholder
      };

      const res = await settings.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET, APP_MASTER_KEY }
      );

      expect(res.status).toBe(200);

      // Check that tenant_config prepare was called only once (for APP_NAME)
      const configPrepCalls = vi.mocked(mockDB.prepare).mock.calls.filter(c => typeof c[0] === "string" && c[0].includes("tenant_config"));
      expect(configPrepCalls.length).toBe(1);
      expect(mockDB.bind).toHaveBeenCalledWith("default-tenant", "APP_NAME", "Updated Name");
      expect(mockDB.run).toHaveBeenCalledTimes(1);
    });

    it("should return 500 if trying to update sensitive settings without APP_MASTER_KEY", async () => {
      const token = await generateAdminToken();

      const payload = {
        RESEND_API_KEY: "new-super-secret-key",
      };

      const res = await settings.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET } // Missing APP_MASTER_KEY
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("APP_MASTER_KEY is missing. Cannot encrypt sensitive settings.");
    });
  });
});
