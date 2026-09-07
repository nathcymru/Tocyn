import { describe, it, expect, vi, beforeEach } from "vitest";
import permissions from "../permissions.handler";
import * as jose from "jose";

// Mock DB
const mockDB = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  run: vi.fn(),
};

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";

async function generateToken(role: "admin" | "agent" | "customer") {
  const secretKey = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({
    sub: `user-${role}`,
    id: `user-${role}`,
    email: `${role}@example.com`,
    role: role,
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

describe("Permissions Handler Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.prepare.mockReturnThis();
    mockDB.bind.mockReturnThis();
    mockDB.first.mockImplementation(async () => {
      const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
      const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
      if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
        const bindCalls = vi.mocked(mockDB.bind).mock.calls;
        const sub = bindCalls.length > 0 ? bindCalls[bindCalls.length - 1][1] : "user-admin";
        const role = typeof sub === "string" && sub.startsWith("user-") ? sub.substring(5) : "admin";
        return { tenant_id: "default-tenant", id: sub, role };
      }
      return null;
    });
  });

  describe("GET /", () => {
    it("rejects customers before reading the permission map", async () => {
      const token = await generateToken("customer");
      const res = await permissions.request("/", { headers: { Authorization: `Bearer ${token}` } }, { DB: mockDB as any, JWT_SECRET });
      expect(res.status).toBe(403);
      expect(mockDB.prepare.mock.calls.some(([sql]) => String(sql).includes("tenant_config"))).toBe(false);
    });

    it.each(['not-json', 'null', '[]', '{"can_edit_settings":"true"}'])("returns an empty map for invalid stored policy %s", async (value) => {
      mockDB.first.mockImplementation(async () => {
        const sql = String(mockDB.prepare.mock.calls.at(-1)?.[0]);
        return sql.includes("FROM users")
          ? { tenant_id: "default-tenant", id: "user-admin", role: "admin" }
          : { value };
      });
      const token = await generateToken("admin");
      const res = await permissions.request("/", { headers: { Authorization: `Bearer ${token}` } }, { DB: mockDB as any, JWT_SECRET });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
    });

    it("should return the current permissions mapping for an admin", async () => {
      const mockPermissions = { can_edit_settings: true, can_delete_tickets: false };
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { tenant_id: "default-tenant", id: "user-admin", role: "admin" };
        }
        return { value: JSON.stringify(mockPermissions) };
      });

      const token = await generateToken("admin");

      const res = await permissions.request(
        "/",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(mockPermissions);
      expect(mockDB.prepare).toHaveBeenCalledWith("SELECT value FROM tenant_config WHERE tenant_id = ? AND key = ?");
    });

    it("should return the current permissions mapping for an agent", async () => {
      const mockPermissions = { can_edit_settings: false };
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { tenant_id: "default-tenant", id: "user-agent", role: "agent" };
        }
        return { value: JSON.stringify(mockPermissions) };
      });

      const token = await generateToken("agent");

      const res = await permissions.request(
        "/",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(mockPermissions);
    });

    it("should return an empty object if no permissions are found", async () => {
      mockDB.first.mockImplementation(async () => {
        const prepCalls = vi.mocked(mockDB.prepare).mock.calls;
        const lastQuery = prepCalls.length > 0 ? prepCalls[prepCalls.length - 1][0] : "";
        if (typeof lastQuery === "string" && lastQuery.includes("FROM users")) {
          return { tenant_id: "default-tenant", id: "user-admin", role: "admin" };
        }
        return null;
      });

      const token = await generateToken("admin");

      const res = await permissions.request(
        "/",
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({});
    });

    it("should return 401 if no valid token is provided", async () => {
      const res = await permissions.request(
        "/",
        {
          method: "GET",
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(401);
    });
  });

  describe("PUT /", () => {
    it("should allow an admin to update permissions", async () => {
      const token = await generateToken("admin");
      const payload = {
        can_edit_settings: true,
        can_manage_users: false
      };

      mockDB.run.mockResolvedValueOnce({ success: true });

      const res = await permissions.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      expect(mockDB.prepare).toHaveBeenCalledWith(
        "INSERT INTO tenant_config (tenant_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
      );
      expect(mockDB.bind).toHaveBeenCalledWith("default-tenant", "agent_settings_permissions", JSON.stringify(payload));
      expect(mockDB.run).toHaveBeenCalled();
    });

    it("should return 403 if an agent attempts to update permissions", async () => {
      const token = await generateToken("agent");
      const payload = {
        can_edit_settings: true,
      };

      const res = await permissions.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("should return 403 if a customer attempts to update permissions", async () => {
      const token = await generateToken("customer");
      const payload = { can_edit_settings: true };

      const res = await permissions.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(403);
    });

    it("should return 400 if the payload is invalid", async () => {
      const token = await generateToken("admin");
      const invalidPayload = {
        can_edit_settings: "yes", // should be boolean
      };

      const res = await permissions.request(
        "/",
        {
          method: "PUT",
          body: JSON.stringify(invalidPayload),
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
        },
        { DB: mockDB as any, JWT_SECRET }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid permissions format");
      expect(mockDB.run).not.toHaveBeenCalled();
    });
  });
});
