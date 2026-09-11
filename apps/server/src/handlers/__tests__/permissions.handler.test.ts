import { beforeEach, describe, expect, it, vi } from "vitest";
import permissions from "../permissions.handler";
import { AuthService } from "../../services/auth/auth.service";
import { CAPABILITY_CATALOG } from '../../auth/capability-policy';

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";

function permissionDb(options: { revisionChanges?: number; userRole?: "admin" | "agent" } = {}) {
  const batch = vi.fn().mockResolvedValue([
    { meta: { changes: 0 } },
    { meta: { changes: options.revisionChanges ?? 1 } },
  ]);
  const run = vi.fn().mockResolvedValue({ meta: { changes: options.revisionChanges ?? 1 } });
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: (..._values: unknown[]) => statement,
      first: async () => {
        if (sql.includes("FROM users")) {
          const role = options.userRole ?? "admin";
          return { tenant_id: "tenant-a", id: `${role}-1`, role, password_hash: null, session_version: 0, mfa_enabled: 1, email: `${role}@example.test`, full_name: role };
        }
        if (sql.includes("deployment_capability_ceiling") && sql.includes("WHERE capability")) return { enabled: 1, revision: 1 };
        if (sql.includes("deployment_role_capability_grants") && sql.includes("WHERE role")) return { enabled: 1, revision: 1 };
        if (sql.includes("tenant_capability_policy_versions")) return { revision: 4 };
        return null;
      },
      all: async () => {
        if (sql.includes("tenant_group_capability_constraints")) return { results: [] };
        if (sql.includes("deployment_capability_ceiling")) return { results: [{ capability: "settings.general.manage", enabled: 1, revision: 1 }, { capability: "permissions.manage", enabled: 1, revision: 1 }] };
        if (sql.includes("deployment_role_capability_grants")) return { results: [{ capability: "settings.general.manage", enabled: 1, revision: 1 }] };
        if (sql.includes("tenant_role_capability_policies")) return { results: [{ capability: "settings.general.manage", enabled: 1, revision: 1 }] };
        return { results: [] };
      },
      run,
    };
    return statement;
  });
  return { prepare, batch };
}

async function token(role: "admin" | "agent") {
  return new AuthService().generateToken({ id: `${role}-1`, email: `${role}@example.test`, role, tenant_id: "tenant-a", session_version: 0 }, JWT_SECRET, true);
}

describe("permissions handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the finite catalog and marks owner-managed capabilities unavailable to tenant delegation", async () => {
    const db = permissionDb();
    const response = await permissions.request("/", { headers: { Authorization: `Bearer ${await token("admin")}` } }, { DB: db as any, JWT_SECRET });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revision).toBe(4);
    expect(body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "settings.general.manage", effectiveForAgent: true }),
      expect.objectContaining({ capability: "tools.reference.read", roleAllowed: false }),
    ]));
  });

  it("does not expose the tenant-administration surface to agents", async () => {
    const db = permissionDb({ userRole: "agent" });
    const response = await permissions.request("/", { headers: { Authorization: `Bearer ${await token("agent")}` } }, { DB: db as any, JWT_SECRET });
    expect(response.status).toBe(403);
  });

  it("uses the policy revision as a conflict fence and revokes agent sessions after a committed update", async () => {
    const db = permissionDb();
    const response = await permissions.request("/", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token("admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 4, policies: { general: false } }),
    }, { DB: db as any, JWT_SECRET });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ revision: 5, sessionsRevoked: true }));
    expect(db.batch).toHaveBeenCalledOnce();
  });

  it('keeps every currently delegable legacy capability admissible under the bounded policy count', async () => {
    const db = permissionDb();
    const policies = Object.fromEntries(CAPABILITY_CATALOG.filter(capability => capability.legacyKey)
      .map(capability => [capability.legacyKey!, true]));
    const response = await permissions.request('/', {
      method: 'PUT', headers: { Authorization: `Bearer ${await token('admin')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 4, policies }),
    }, { DB: db as any, JWT_SECRET });
    expect(response.status).toBe(200);
    expect(Object.keys(policies)).toHaveLength(CAPABILITY_CATALOG.filter(capability => capability.legacyKey).length);
  });

  it("rejects stale policy writes before changing delegation", async () => {
    const db = permissionDb({ revisionChanges: 0 });
    const response = await permissions.request("/", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token("admin")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 3, policies: { general: false } }),
    }, { DB: db as any, JWT_SECRET });

    expect(response.status).toBe(409);
    expect(db.batch).toHaveBeenCalledOnce();
  });
});
