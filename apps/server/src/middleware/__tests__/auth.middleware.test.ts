import { tenantMiddleware } from '../tenant.middleware';
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../auth.middleware";
import { operationalObservability } from '../operational-observability';
import type { Env } from '../../bindings';
import type { AppVariables } from '../../types';
import type { RequestAuthSliSnapshot } from '../../observability/request-auth-sli';
import * as jose from "jose";

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";

describe("authMiddleware", () => {
  const app = new Hono<{ Bindings: { JWT_SECRET: string } }>();
  app.use("*", authMiddleware);


  app.get("/protected", (c) => c.text("OK"));
  app.get("/migrated", tenantMiddleware, (c) => c.text("MIGRATED_OK"));

  const mockDB = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ tenant_id: "tenant-A", id: "user-1", role: "admin", password_hash: null, mfa_enabled: 0 }),
        all: async () => ({ results: [] })
      })
    })
  };

  it("should return 200 for a valid JWT with aud=app and valid tenant_id and sub", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new jose.SignJWT({
      sub: "user-1",
      tenant_id: "tenant-A",
      email: "test@example.com",
      role: "admin",
      mfa_verified: true,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        JWT_SECRET,
        DB: mockDB as any,
      }
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  it("should return 401 if aud is missing or not app", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const tokenWithoutAud = await new jose.SignJWT({
      sub: "user-1",
      tenant_id: "tenant-A",
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const res = await app.request(
      "/protected",
      { headers: { Authorization: `Bearer ${tokenWithoutAud}` } },
      { JWT_SECRET, DB: mockDB as any }
    );
    expect(res.status).toBe(401);
  });

  it("should return 401 if tenant_id is missing or empty", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const tokenWithoutTenant = await new jose.SignJWT({
      sub: "user-1",
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const res = await app.request(
      "/protected",
      { headers: { Authorization: `Bearer ${tokenWithoutTenant}` } },
      { JWT_SECRET, DB: mockDB as any }
    );
    expect(res.status).toBe(401);
  });

  it("should return 401 if sub is missing or empty, even if legacy id claim is present", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const tokenWithIdOnly = await new jose.SignJWT({
      id: "user-1",
      tenant_id: "tenant-A",
      role: "admin",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const res = await app.request(
      "/protected",
      { headers: { Authorization: `Bearer ${tokenWithIdOnly}` } },
      { JWT_SECRET, DB: mockDB as any }
    );
    expect(res.status).toBe(401);
  });

  it("should return 401 for an expired token", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new jose.SignJWT({
      sub: "user-1",
      tenant_id: "tenant-A",
      email: "test@example.com",
      role: "admin",
      mfa_verified: true,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800) // 30 mins ago
      .sign(secret);

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        JWT_SECRET,
        DB: mockDB as any,
      }
    );

    expect(res.status).toBe(401);
  });

  it("should return 401 for a tampered token", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new jose.SignJWT({
      sub: "user-1",
      tenant_id: "tenant-A",
      email: "test@example.com",
      role: "admin",
      mfa_verified: true,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const tamperedToken = token.replace('.', '.invalid.');

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: `Bearer ${tamperedToken}`,
        },
      },
      {
        JWT_SECRET,
        DB: mockDB as any,
      }
    );

    expect(res.status).toBe(401);
  });

  it("should return 401 for no token", async () => {
    const res = await app.request(
      "/protected",
      {},
      {
        JWT_SECRET,
        DB: mockDB as any,
      }
    );

    expect(res.status).toBe(401);
  });
});


describe("Auth & Tenant Middleware Chain Integration", () => {
  const app = new Hono<{ Bindings: { JWT_SECRET: string } }>();
  app.use("*", authMiddleware);
  app.get("/migrated", tenantMiddleware, (c) => {
    const scope = c.get('tenantScope');
    return c.json({ ok: true, tenantId: scope.tenantId });
  });

  const secret = new TextEncoder().encode(JWT_SECRET);

  it("Tenant-aware JWT with aud=app succeeds on migrated route with correct scope", async () => {
    const migratedToken = await new jose.SignJWT({ sub: "user-1", email: "test@example.com", tenant_id: "tenant-A", role: "customer" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const res = await app.request('/migrated', { headers: { Authorization: `Bearer ${migratedToken}` } }, { JWT_SECRET, DB: { prepare: () => ({ bind: () => ({ all: () => ({ results: [] }), first: () => ({ tenant_id: "tenant-A", id: "user-1", role: "customer", password_hash: null, mfa_enabled: 0 }) }) }) } as any });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tenantId: "tenant-A" });
  });

  it("returns 401 when D1 user account no longer exists (user deleted)", async () => {
    const deletedUserToken = await new jose.SignJWT({ sub: "deleted-user", email: "deleted@example.com", tenant_id: "tenant-A", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const mockDbUserDeleted = {
      prepare: () => ({
        bind: () => ({
          first: async () => null // User deleted
        })
      })
    };

    const res = await app.request('/migrated', { headers: { Authorization: `Bearer ${deletedUserToken}` } }, { JWT_SECRET, DB: mockDbUserDeleted as any });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("User account no longer exists");
  });

  it("returns 401 when D1 user role has changed/demoted", async () => {
    const demotedUserToken = await new jose.SignJWT({ sub: "user-1", email: "test@example.com", tenant_id: "tenant-A", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const mockDbUserDemoted = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ tenant_id: "tenant-A", id: "user-1", role: "customer", password_hash: null, mfa_enabled: 0 }) // Demoted to customer
        })
      })
    };

    const res = await app.request('/migrated', { headers: { Authorization: `Bearer ${demotedUserToken}` } }, { JWT_SECRET, DB: mockDbUserDemoted as any });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("User role changed");
  });
});

describe('isolated request app-session SLI integration', () => {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const enabled = { JWT_SECRET, ENVIRONMENT: 'test', LOCAL_BETA_ENABLED: 'false', OBSERVABILITY_MODE: 'isolated-evidence' } as Env;

  const token = (claims: Record<string, unknown>) => new jose.SignJWT({
    sub: 'staff-1', tenant_id: 'tenant-A', email: 'staff@example.invalid', role: 'admin', ...claims,
  }).setProtectedHeader({ alg: 'HS256' }).setAudience('app').setIssuedAt().setExpirationTime('2h').sign(secret);

  const database = (first: () => unknown | Promise<unknown>) => ({
    prepare: () => ({ bind: () => ({ first, all: async () => ({ results: [] }) }) }),
  });

  it('records trusted app-session outcomes independently of the HTTP response status', async () => {
    const signals: RequestAuthSliSnapshot[] = [];
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.use('*', (c, next) => operationalObservability(c, next, () => {}, event => { signals.push(event); }));
    app.use('*', authMiddleware);
    app.get('/protected', c => c.text('OK'));

    const accepted = await app.request('/protected', { headers: { Authorization: `Bearer ${await token({ mfa_verified: true, session_version: 0 })}` } }, {
      ...enabled, DB: database(async () => ({ tenant_id: 'tenant-A', id: 'staff-1', role: 'admin', session_version: 0 })),
    });
    expect(accepted.status).toBe(200);

    const challenge = await app.request('/protected', { headers: { Authorization: `Bearer ${await token({ mfa_verified: false, session_version: 0 })}` } }, {
      ...enabled, DB: database(async () => ({ tenant_id: 'tenant-A', id: 'staff-1', role: 'admin', session_version: 0 })),
    });
    expect(challenge.status).toBe(200);

    const unavailable = await app.request('/protected', { headers: { Authorization: `Bearer ${await token({ mfa_verified: true, session_version: 0 })}` } }, {
      ...enabled, DB: database(() => { throw new Error('synthetic database fault'); }),
    });
    expect(unavailable.status).toBe(401);

    expect(signals).toEqual([
      { version: 1, type: 'auth.sli.request', scope: 'app-session', complete: true, counts: { attempted: 1, accepted: 1, denied: 0, unavailable: 0, challenge: 0 } },
      { version: 1, type: 'auth.sli.request', scope: 'app-session', complete: true, counts: { attempted: 1, accepted: 0, denied: 0, unavailable: 0, challenge: 1 } },
      { version: 1, type: 'auth.sli.request', scope: 'app-session', complete: true, counts: { attempted: 1, accepted: 0, denied: 0, unavailable: 1, challenge: 0 } },
    ]);
    expect(JSON.stringify(signals)).not.toContain('staff-1');
  });

  it('treats an explicitly disallowed signing algorithm as credential denial, not service unavailability', async () => {
    const signals: RequestAuthSliSnapshot[] = [];
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.use('*', (c, next) => operationalObservability(c, next, () => {}, event => { signals.push(event); }));
    app.use('*', authMiddleware);
    app.get('/protected', c => c.text('OK'));
    const unsupported = await new jose.SignJWT({ sub: 'staff-1', tenant_id: 'tenant-A', role: 'admin' })
      .setProtectedHeader({ alg: 'HS384' }).setAudience('app').setIssuedAt().setExpirationTime('2h').sign(secret);
    const response = await app.request('/protected', { headers: { Authorization: `Bearer ${unsupported}` } }, enabled);
    expect(response.status).toBe(401);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ complete: true, counts: { attempted: 1, denied: 1, unavailable: 0 } });
  });

  it('keeps an app-session denial and response intact when its optional observer rejects', async () => {
    let captured: AppVariables['requestAuthSli'];
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.use('*', (c, next) => operationalObservability(c, next, () => {}, async () => { throw new Error('synthetic observer fault'); }));
    app.use('*', async (c, next) => { captured = c.get('requestAuthSli'); await next(); });
    app.use('*', authMiddleware);
    app.get('/protected', c => c.text('OK'));

    const response = await app.request('/protected', { headers: { Authorization: 'Bearer malformed' } }, { ...enabled, DB: database(async () => null) });
    expect(response.status).toBe(401);
    await new Promise(resolve => setImmediate(resolve));
    expect(captured).toBeDefined();
    expect(captured!.snapshot()).toMatchObject({ complete: false, counts: { attempted: 1, denied: 1 } });
  });
});
