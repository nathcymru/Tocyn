import { describe, it, expect, vi, beforeEach } from "vitest";
import settings from "../settings.handler";
import * as jose from "jose";

const mockDB = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
};

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";
const TOKENS = new Map<string, string>();

async function tokenFor(role: string, tenantId: string, sub = `${role}-1`) {
  if (TOKENS.has(`${tenantId}:${role}:${sub}`)) return TOKENS.get(`${tenantId}:${role}:${sub}`)!;

  const secretKey = new TextEncoder().encode(JWT_SECRET);
  const value = await new jose.SignJWT({
    sub,
    id: sub,
    email: `${sub}@example.com`,
    role,
    tenant_id: tenantId,
    tenant_version: 1,
    mfa_enabled: false,
    mfa_verified: true,
    session_version: 1,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("app")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretKey);

  TOKENS.set(`${tenantId}:${role}:${sub}`, value);
  return value;
}

function lastPreparedQuery(): string {
  const calls = vi.mocked(mockDB.prepare).mock.calls;
  const last = calls.at(-1)?.[0];
  return typeof last === "string" ? last : "";
}

function lastBound(): any[] {
  const calls = vi.mocked(mockDB.bind).mock.calls;
  return calls.at(-1) ?? [];
}

describe("Filters Handler Tests", () => {
  let filterRows = new Map<string, { id: string; name: string; is_system: number; conditions: string }>();
  let allowSyntheticFilterRows = false;

  beforeEach(() => {
    vi.clearAllMocks();
    TOKENS.clear();
    allowSyntheticFilterRows = false;

    filterRows = new Map();
    mockDB.prepare.mockReturnThis();
    mockDB.bind.mockReturnThis();
    mockDB.all.mockResolvedValue({ results: [] });
    mockDB.run.mockResolvedValue({ success: true, meta: { changes: 1 } });

    mockDB.first.mockImplementation(async () => {
      const query = lastPreparedQuery();
      const bound = lastBound();

      if (query.includes("deployment_capability_ceiling")) return { enabled: 1, revision: 1 };
      if (query.includes("deployment_role_capability_grants")) return { enabled: 1, revision: 1 };
      if (query.includes("tenant_role_capability_policies")) return { enabled: 1, revision: 1 };

      if (query.includes("FROM users")) {
        return {
          tenant_id: String(bound[0] ?? "tenant-a"),
          id: String(bound[1] ?? `${bound[1] ?? "admin-1"}`),
          role: "admin",
          password_hash: null,
          mfa_enabled: 0,
          session_version: 1,
          exp: Math.floor(Date.now() / 1000) + 3600,
        };
      }

      if (query.includes("SELECT * FROM ticket_filters WHERE tenant_id = ?") && query.includes("AND id = ?")) {
        const [tenantId, filterId] = [String(bound[0] ?? ""), String(bound[1] ?? "")];
        if (allowSyntheticFilterRows) {
          return filterRows.get(`${tenantId}:${filterId}`) ?? {
            id: filterId,
            name: "API Slice",
            is_system: 0,
            conditions: '[{"field":"status","operator":"equals","value":"open"}]',
          };
        }
        return filterRows.get(`${tenantId}:${filterId}`) ?? null;
      }

      return null;
    });
  });

  it("GET /settings/filters only returns authenticated tenant rows", async () => {
    mockDB.all.mockResolvedValueOnce({
      results: [
        {
          id: "tenant-a-open",
          name: "Open Tickets",
          is_system: 0,
          conditions: '[{"field":"status","operator":"equals","value":"open"}]',
        },
      ],
    });

    const res = await settings.request(
      "/filters",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${await tokenFor("admin", "tenant-a", "admin-1")}` },
      },
      { DB: mockDB as any, JWT_SECRET }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: "tenant-a-open",
        name: "Open Tickets",
        is_system: 0,
        conditions: [{ field: "status", operator: "equals", value: "open" }],
      },
    ]);
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM ticket_filters WHERE tenant_id = ? ORDER BY is_system"));
    expect(mockDB.bind).toHaveBeenCalledWith("tenant-a");
  });

  it("GET /settings/filters/:id returns 404 when filter is not in tenant", async () => {
    const res = await settings.request(
      "/filters/nope",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${await tokenFor("admin", "tenant-a", "admin-1")}` },
      },
      { DB: mockDB as any, JWT_SECRET }
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Filter not found" });
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM ticket_filters WHERE tenant_id = ? AND id = ?"));
    expect(mockDB.bind).toHaveBeenCalledWith("tenant-a", "nope");
  });

  it("POST /settings/filters creates tenant-scoped records", async () => {
    allowSyntheticFilterRows = true;

    const res = await settings.request(
      "/filters",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await tokenFor("admin", "tenant-a", "admin-1")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "API Slice",
          conditions: [{ field: "status", operator: "equals", value: "open" }],
        }),
      },
      { DB: mockDB as any, JWT_SECRET }
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      name: "API Slice",
      is_system: 0,
    });
    expect(mockDB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO ticket_filters (tenant_id, id, name, conditions, is_system, created_at, updated_at")
    );
  });

  it("PUT /settings/filters/:id respects tenant on read/update and returns 404 for another tenant", async () => {
    filterRows.set("tenant-a:filter-a", {
      id: "filter-a",
      name: "Open",
      is_system: 0,
      conditions: '[{"field":"status","operator":"equals","value":"open"}]',
    });

    const res = await settings.request(
      "/filters/filter-b",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${await tokenFor("admin", "tenant-a", "admin-1")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Updated",
          conditions: [{ field: "priority", operator: "in", value: ["high", "urgent"] }],
        }),
      },
      { DB: mockDB as any, JWT_SECRET }
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Filter not found" });
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM ticket_filters WHERE tenant_id = ? AND id = ?"));
    expect(mockDB.prepare).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE ticket_filters SET name = ?, conditions = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
    );
  });

  it("DELETE /settings/filters/:id respects tenant on read/delete", async () => {
    filterRows.set("tenant-a:filter-a", {
      id: "filter-a",
      name: "Open",
      is_system: 0,
      conditions: "[]",
    });

    const deleteTarget = await settings.request(
      "/filters/filter-a",
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await tokenFor("admin", "tenant-a", "admin-1")}` },
      },
      { DB: mockDB as any, JWT_SECRET }
    );
    expect(deleteTarget.status).toBe(200);
    expect(await deleteTarget.json()).toEqual({ success: true });

    const deleteMiss = await settings.request(
      "/filters/missing-filter",
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await tokenFor("admin", "tenant-a", "admin-1")}` },
      },
      { DB: mockDB as any, JWT_SECRET }
    );

    expect(deleteMiss.status).toBe(404);
    expect(await deleteMiss.json()).toEqual({ error: "Filter not found" });
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM ticket_filters WHERE tenant_id = ? AND id = ?"));
  });
});
