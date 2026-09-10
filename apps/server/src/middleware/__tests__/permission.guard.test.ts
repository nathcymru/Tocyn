import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { permissionGuard, revalidatePermission } from "../permission.guard";

type PolicyState = {
  owner: boolean;
  role: boolean;
  tenant: boolean;
  sessionVersion: number;
  groupEnabled: boolean[];
};

function policyDb(state: PolicyState) {
  return {
    prepare(sql: string) {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        first: async () => {
          if (sql.includes("deployment_capability_ceiling")) return { enabled: state.owner ? 1 : 0, revision: 1 };
          if (sql.includes("deployment_role_capability_grants")) return { enabled: state.role ? 1 : 0, revision: 2 };
          if (sql.includes("FROM users")) return { role: "agent", session_version: state.sessionVersion };
          if (sql.includes("tenant_role_capability_policies")) return { enabled: state.tenant ? 1 : 0, revision: 3 };
          return null;
        },
        all: async () => ({ results: state.groupEnabled.map((enabled, index) => ({ enabled: enabled ? 1 : 0, revision: index + 4 })) }),
      };
      return statement;
    },
  };
}

function appWithPrincipal(state: PolicyState) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("jwtPayload", { sub: "agent-1", tenant_id: "tenant-a", role: "agent", session_version: 0, mfa_verified: true });
    await next();
  });
  app.use("*", permissionGuard("general"));
  app.get("/protected", c => c.text("OK"));
  return { app, env: { DB: policyDb(state) } };
}

describe("permissionGuard", () => {
  it("requires the owner ceiling, role grant, and tenant restriction to allow a capability", async () => {
    const state = { owner: true, role: true, tenant: true, sessionVersion: 0, groupEnabled: [] };
    const { app, env } = appWithPrincipal(state);
    expect((await app.request("/protected", undefined, env)).status).toBe(200);

    state.tenant = false;
    const denied = await app.request("/protected", undefined, env);
    expect(denied.status).toBe(403);
    expect((await denied.json()).message).toContain("settings.general.manage");
  });

  it("does not preserve the old admin bypass or accept unknown capability names", async () => {
    const state = { owner: true, role: true, tenant: true, sessionVersion: 0, groupEnabled: [] };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("jwtPayload", { sub: "admin-1", tenant_id: "tenant-a", role: "admin", session_version: 0, mfa_verified: true });
      await next();
    });
    app.use("*", permissionGuard("not.in.the.catalog"));
    app.get("/", c => c.text("unreachable"));
    expect((await app.request("/", undefined, { DB: policyDb(state) })).status).toBe(403);
  });

  it("applies group constraints as additional restrictions", async () => {
    const state = { owner: true, role: true, tenant: true, sessionVersion: 0, groupEnabled: [true, false] };
    const { app, env } = appWithPrincipal(state);
    expect((await app.request("/protected", undefined, env)).status).toBe(403);
  });

  it("fences a paused mutation when policy revocation happens before its side effect", async () => {
    const state = { owner: true, role: true, tenant: true, sessionVersion: 0, groupEnabled: [] };
    let entered!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const continueMutation = new Promise<void>(resolve => { resume = resolve; });
    let commits = 0;
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("jwtPayload", { sub: "agent-1", tenant_id: "tenant-a", role: "agent", session_version: 0, mfa_verified: true });
      await next();
    });
    app.use("*", permissionGuard("general"));
    app.post("/mutation", async c => {
      entered();
      await continueMutation;
      const failure = await revalidatePermission(c as any, "general");
      if (failure) return failure;
      commits += 1;
      return c.json({ success: true });
    });

    const request = app.request("/mutation", { method: "POST" }, { DB: policyDb(state) });
    await paused;
    state.tenant = false;
    state.sessionVersion = 1;
    resume();

    expect((await request).status).toBe(403);
    expect(commits).toBe(0);
  });
});
