import { tenantMiddleware } from '../tenant.middleware';
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../auth.middleware";
import * as jose from "jose";

const JWT_SECRET = "test-secret-key-at-least-32-chars-long-123456";

describe("authMiddleware", () => {
  const app = new Hono<{ Bindings: { JWT_SECRET: string } }>();
  app.use("*", authMiddleware);


  app.get("/protected", (c) => c.text("OK"));
  app.get("/migrated", tenantMiddleware, (c) => c.text("MIGRATED_OK"));

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
      { JWT_SECRET }
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
      { JWT_SECRET }
    );
    expect(res.status).toBe(401);
  });

  it("should return 401 if sub is missing or empty", async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const tokenWithoutSub = await new jose.SignJWT({
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
      { headers: { Authorization: `Bearer ${tokenWithoutSub}` } },
      { JWT_SECRET }
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
    const migratedToken = await new jose.SignJWT({ sub: "user-1", email: "test@example.com", tenant_id: "tenant-A" })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const res = await app.request('/migrated', { headers: { Authorization: `Bearer ${migratedToken}` } }, { JWT_SECRET, DB: { prepare: () => ({ bind: () => ({ all: () => ({ results: [] }), first: () => null }) }) } as any });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tenantId: "tenant-A" });
  });
});
