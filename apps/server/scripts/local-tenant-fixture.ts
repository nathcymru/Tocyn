import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as OTPAuth from 'otpauth';
import * as jose from 'jose';
import { Headers as MiniflareHeaders, Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createLocalRuntime } from '../src/local-index';
import type { Env } from '../src/bindings';
import { createSystemTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';
import { AuthService } from '../src/services/auth/auth.service';
import { MFAService } from '../src/services/auth/mfa.service';
import { splitSql } from './split-sql';

const serverRoot = resolve(import.meta.dirname, '..');
const migrationsDirectory = join(serverRoot, 'migrations');
const fixtureMarker = 'tocyn-local-fixture';
let fixtureRun = 0;
const principalNames = ['customerA', 'operatorA', 'customerB', 'operatorB'] as const;
const fixtureWidgetKeys: Record<Tenant, string> = {
  'fixture-tenant-a': 'fixture-widget-key-a',
  'fixture-tenant-b': 'fixture-widget-key-b',
};

type PrincipalName = typeof principalNames[number];
type Tenant = 'fixture-tenant-a' | 'fixture-tenant-b';
type Role = 'customer' | 'admin';
type OperatorPrincipal = 'operatorA' | 'operatorB';
type TicketPermission = 'tickets:read' | 'tickets:write';

type R2OperationCounts = Readonly<{
  get: number;
  put: number;
  delete: number;
  list: number;
}>;

type PrivatePrincipal = {
  tenantId: Tenant;
  localId: 'fixture-customer' | 'fixture-operator';
  role: Role;
  email: string;
  password: string;
  mfaSecret?: string;
};

export type FixturePrincipal = Readonly<{
  name: PrincipalName;
  tenantId: Tenant;
  localId: 'fixture-customer' | 'fixture-operator';
  role: Role;
  email: string;
  widgetKey: string;
  portalLoginUrl: string;
}>;

export type FixtureResponse = Response & {
  json: <T = unknown>() => Promise<T>;
};

/** Local-only binding shared with route composition; unavailable outside a fixture callback. */
export type FixtureR2 = Readonly<{
  bucket: R2Bucket;
  operationCounts: () => R2OperationCounts;
  /** Synthetic R2 failure; uncertain mode stores the object before reporting failure. */
  failNextPut: (uncertain?: boolean) => void;
}>;

export type LocalTenantFixture = Readonly<{
  principals: Readonly<Record<PrincipalName, FixturePrincipal>>;
  /** Enable guarded requests only after explicit local operator policy setup; no automatic invitations. */
  enableLocalBeta: () => void;
  /** Enables only the existing synthetic isolated-evidence gate for this disposable fixture. */
  enableIsolatedObservability: () => void;
  restartLocalRuntime: () => void;
  db: D1Database;
  r2: FixtureR2;
  rateLimitIdentity: string;
  request: (path: string, options?: {
    method?: string;
    body?: unknown;
    /** Sends bytes as supplied, for bounded malformed/streamed request checks. */
    rawBody?: BodyInit;
    /** Defaults to application/json for a supplied body or raw body. Use null to omit it. */
    contentType?: string | null;
    /** Additional request headers for narrow route-level assertions such as CORS preflight. */
    headers?: Record<string, string>;
    /** Optional case-sensitive retry key mapped to the public Idempotency-Key header. */
    idempotencyKey?: string;
    token?: string;
    apiKey?: string;
    origin?: string;
    ip?: string;
  }) => Promise<FixtureResponse>;
  login: (principal: PrincipalName, password?: string) => Promise<FixtureResponse>;
  currentMfaCode: (principal: 'operatorA' | 'operatorB') => string;
  invalidMfaCode: (principal: 'operatorA' | 'operatorB') => string;
  /** A synthetic, DB-backed agent session for narrow route authorization checks. */
  createAgentSession: (tenantId: Tenant, mfaVerified?: boolean) => Promise<Readonly<{ id: string; token: string }>>;
  createScopedApiKey: (operator: OperatorPrincipal, permissions: readonly TicketPermission[]) => Promise<Readonly<{
    id: string;
    apiKey: string;
    permissions: readonly TicketPermission[];
  }>>;
  revokePrincipalSessions: (principal: PrincipalName) => Promise<void>;
  tokenTenant: (token: string) => Promise<Tenant>;
  widgetTokenTenant: (token: string) => Promise<Tenant>;
  assertStoredCredentialProtection: (rawApiKey: string) => Promise<void>;
  resourceUsage: () => Promise<Readonly<{ d1Rows: number; r2Objects: number; routeRequests: number }>>;
  notificationAttempts: () => number;
  resetNotificationAttempts: () => void;
  /** Fails only the local notification provider; D1/R2 remain real Miniflare bindings. */
  failNotificationAttempts: (count: number) => void;
}>;

export type FixtureReport = Readonly<{
  result: 'passed';
  mode: 'disposable-miniflare';
  tenants: 2;
  principals: 4;
  customerPasswordLogins: 2;
  customerMagicLinkAuthentications: 2;
  operatorMfaLogins: 2;
  apiKeysCreated: 2;
  revokedKeysRejected: true;
  crossTenantMetadataWrites: 0;
  foreignKeyViolations: 0;
  remoteBindings: 0;
  d1Rows: number;
  r2Objects: number;
  routeRequests: number;
  elapsedMs: number;
  cleanup: 'disposed';
}>;

function randomLocalSecret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

function portalLoginUrl(tenantId: Tenant): string {
  const url = new URL('http://localhost:5174/login');
  url.searchParams.set('key', fixtureWidgetKeys[tenantId]);
  return url.toString();
}

function publicPrincipal(name: PrincipalName, principal: PrivatePrincipal): FixturePrincipal {
  return Object.freeze({
    name, tenantId: principal.tenantId, localId: principal.localId, role: principal.role, email: principal.email,
    widgetKey: fixtureWidgetKeys[principal.tenantId], portalLoginUrl: portalLoginUrl(principal.tenantId),
  });
}

function generatedPrincipals(): Record<PrincipalName, PrivatePrincipal> {
  return {
    customerA: { tenantId: 'fixture-tenant-a', localId: 'fixture-customer', role: 'customer', email: 'tocyn-auth-test-a@example.invalid', password: randomLocalSecret() },
    operatorA: { tenantId: 'fixture-tenant-a', localId: 'fixture-operator', role: 'admin', email: 'fixture.operator.a@example.test', password: randomLocalSecret() },
    customerB: { tenantId: 'fixture-tenant-b', localId: 'fixture-customer', role: 'customer', email: 'tocyn-auth-test-b@example.invalid', password: randomLocalSecret() },
    operatorB: { tenantId: 'fixture-tenant-b', localId: 'fixture-operator', role: 'admin', email: 'fixture.operator.b@example.test', password: randomLocalSecret() },
  };
}

function localEnv(db: D1Database, bucket: R2Bucket): Env {
  return {
    DB: db,
    ATTACHMENTS_BUCKET: bucket,
    NOTIFICATION_DO: {} as DurableObjectNamespace,
    VECTORIZE_WORKFLOW: undefined,
    VECTOR_INDEX: {} as VectorizeIndex,
    AI: undefined,
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
    JWT_SECRET: randomLocalSecret(32),
    MFA_ENCRYPTION_KEY: randomLocalSecret(32),
    APP_MASTER_KEY: randomLocalSecret(32),
    ENVIRONMENT: 'local',
    PORTAL_URL: 'http://localhost:5174',
    DASHBOARD_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5174,http://localhost:5173',
  };
}

async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort();
  for (const migration of migrations) {
    const statements = splitSql(readFileSync(join(migrationsDirectory, migration), 'utf8'));
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
}

function mfaCode(secret: string): string {
  return new OTPAuth.TOTP({
    issuer: 'Luminatick', label: fixtureMarker, algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export type LocalFixtureBootstrap = Readonly<{
  sql: string;
  credentials: ReadonlyArray<Readonly<{ email: string; password: string; provisioningUri?: string; portalLoginUrl?: string }>>;
}>;

/**
 * Builds synthetic fixture rows for a run-owned local D1 database. Callers may write
 * the SQL only to a mode-0600 temporary file and must never report its contents.
 */
export async function createLocalFixtureBootstrap(env: Pick<Env, 'MFA_ENCRYPTION_KEY'>): Promise<LocalFixtureBootstrap> {
  const principals = generatedPrincipals();
  const auth = new AuthService();
  const mfa = new MFAService();
  const rows: string[] = [];
  for (const name of principalNames) {
    const principal = principals[name];
    if (principal.role === 'admin') principal.mfaSecret = mfa.generateSecret();
    const passwordHash = await auth.hashPassword(principal.password);
    const encryptedMfaSecret = principal.mfaSecret ? await mfa.encryptSecret(principal.mfaSecret, env.MFA_ENCRYPTION_KEY) : null;
    rows.push(`INSERT INTO users (tenant_id, id, email, full_name, password_hash, role, mfa_secret, mfa_enabled) VALUES (${[
      principal.tenantId, principal.localId, principal.email, `Synthetic ${name}`, passwordHash, principal.role,
      encryptedMfaSecret, principal.mfaSecret ? '1' : '0',
    ].map(value => value === '1' || value === '0' ? value : value === null ? 'NULL' : sqlLiteral(value)).join(', ')});`);
  }
  for (const tenantId of Object.keys(fixtureWidgetKeys) as Tenant[]) {
    rows.push(`INSERT INTO tenant_config (tenant_id, key, value) VALUES (${sqlLiteral(tenantId)}, 'widget.public_key', ${sqlLiteral(fixtureWidgetKeys[tenantId])});`);
    rows.push(`INSERT INTO tenant_config (tenant_id, key, value) VALUES (${sqlLiteral(tenantId)}, 'PORTAL_URL', ${sqlLiteral('http://localhost:5174')});`);
  }
  return Object.freeze({
    sql: rows.join('\n'),
    credentials: Object.freeze(principalNames.map(name => {
      const principal = principals[name];
      return Object.freeze({
        email: principal.email,
        password: principal.password,
        ...(principal.mfaSecret ? { provisioningUri: mfa.getProvisioningUri(principal.email, principal.mfaSecret) } : {}),
        ...(principal.role === 'customer' ? { portalLoginUrl: portalLoginUrl(principal.tenantId) } : {}),
      });
    })),
  });
}

async function seedPrincipals(db: D1Database, env: Env, principals: Record<PrincipalName, PrivatePrincipal>): Promise<void> {
  const auth = new AuthService(env);
  const mfa = new MFAService();
  for (const name of principalNames) {
    const principal = principals[name];
    if (principal.role === 'admin') principal.mfaSecret = mfa.generateSecret();
    const passwordHash = await auth.hashPassword(principal.password);
    const encryptedMfaSecret = principal.mfaSecret ? await mfa.encryptSecret(principal.mfaSecret, env.MFA_ENCRYPTION_KEY) : null;
    await db.prepare(`INSERT INTO users
      (tenant_id, id, email, full_name, password_hash, role, mfa_secret, mfa_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(principal.tenantId, principal.localId, principal.email, `Synthetic ${name}`, passwordHash,
        principal.role, encryptedMfaSecret, principal.mfaSecret ? 1 : 0).run();
  }
}

async function seedFixtureTenantConfig(db: D1Database): Promise<void> {
  for (const tenantId of Object.keys(fixtureWidgetKeys) as Tenant[]) {
    await db.prepare('INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)').bind(tenantId, 'widget.public_key', fixtureWidgetKeys[tenantId]).run();
    await db.prepare('INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)').bind(tenantId, 'PORTAL_URL', 'http://localhost:5174').run();
  }
}

async function seedScopedTickets(db: D1Database, principals: Record<PrincipalName, PrivatePrincipal>): Promise<void> {
  const rows = [
    ['fixture-tenant-a', 'fixture-ticket', 'Fixture ticket A', principals.customerA.localId, principals.customerA.email],
    ['fixture-tenant-b', 'fixture-ticket', 'Fixture ticket B', principals.customerB.localId, principals.customerB.email],
    ['fixture-tenant-b', 'fixture-b-only', 'Fixture ticket B only', principals.customerB.localId, principals.customerB.email],
  ];
  for (const [tenantId, id, subject, customerId, customerEmail] of rows) {
    await db.prepare('INSERT INTO tickets (tenant_id, id, subject, customer_id, customer_email, source) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(tenantId, id, subject, customerId, customerEmail, 'fixture').run();
  }
}

function countedR2Bucket(bucket: R2Bucket): FixtureR2 {
  const counts = { get: 0, put: 0, delete: 0, list: 0 };
  let nextPutFailure: boolean | undefined;
  const counted = new Proxy(bucket, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || !['get', 'put', 'delete', 'list'].includes(String(property))) return value;
      return (...args: unknown[]) => {
        counts[property as keyof typeof counts]++;
        if (property === 'put' && nextPutFailure !== undefined) {
          const uncertain = nextPutFailure; nextPutFailure = undefined;
          return (async () => { if (uncertain) await value.apply(target,args); throw new Error('Synthetic local storage failure'); })();
        }
        return value.apply(target, args);
      };
    },
  }) as R2Bucket;
  return Object.freeze({
    bucket: counted,
    operationCounts: () => Object.freeze({ ...counts }),
    failNextPut: (uncertain = false) => { nextPutFailure = uncertain; },
  });
}

/**
 * Creates only in-memory local D1/R2 bindings. The callback receives route-level
 * handles; plaintext synthetic credentials never appear in a report or filesystem.
 */
export async function withTwoTenantFixture<T>(callback: (fixture: LocalTenantFixture) => Promise<T>): Promise<T> {
  const headersGlobal = globalThis as typeof globalThis & { Headers: typeof MiniflareHeaders };
  const originalHeaders = headersGlobal.Headers;
  Object.assign(headersGlobal, { Headers: MiniflareHeaders });
  let miniflare: Miniflare | undefined;

  try {
    miniflare = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: fixtureMarker,
      modules: true,
      script: 'export default { fetch() { return new Response("fixture"); } }',
      d1Databases: { DB: 'e2d1b2a2-b2f8-42f4-82f7-0c58f5371e58' },
      r2Buckets: ['ATTACHMENTS_BUCKET'],
    }] }));
    const db = await miniflare.getD1Database('DB');
    const rawBucket = await miniflare.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket;
    const r2 = countedR2Bucket(rawBucket);
    let notificationAttempts = 0;
    let remainingNotificationFailures = 0;
    const notificationDo = {
      idFromName: (name: string) => name,
      get: (_id: string) => ({
        fetch: async () => {
          notificationAttempts++;
          if (remainingNotificationFailures > 0) {
            remainingNotificationFailures--;
            throw new Error('Synthetic local notification failure');
          }
          return new Response(null, { status: 204 });
        },
      }),
    } as unknown as DurableObjectNamespace;
    const env: Env = { ...localEnv(db, r2.bucket), NOTIFICATION_DO: notificationDo };
    const privatePrincipals = generatedPrincipals();
    let localRuntime = createLocalRuntime();
    const requestIp = `fixture-run-${++fixtureRun}`;
    let routeRequests = 0;
    await applyMigrations(db);
    await seedPrincipals(db, env, privatePrincipals);
    await seedFixtureTenantConfig(db);
    await seedScopedTickets(db, privatePrincipals);

    const request: LocalTenantFixture['request'] = async (path, options = {}) => {
      assert.ok(path.startsWith('/'), 'Fixture requests must use an application path');
      routeRequests++;
      const headers = new Headers(options.headers);
      const suppliedBody = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      if (options.contentType === null) headers.delete('Content-Type');
      else if (options.contentType !== undefined) headers.set('Content-Type', options.contentType);
      else if (suppliedBody !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey);
      if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
      if (options.apiKey) headers.set('X-API-Key', options.apiKey);
      if (options.origin) headers.set('Origin', options.origin);
      headers.set('cf-connecting-ip', options.ip ?? requestIp);
      const response = await localRuntime.fetch(new Request(`http://localhost:8787${path}`, {
        method: options.method ?? 'GET', headers,
        ...(suppliedBody === undefined ? {} : { body: suppliedBody }),
      }), env, {} as ExecutionContext);
      return response as FixtureResponse;
    };

    const fixture: LocalTenantFixture = Object.freeze({
      enableLocalBeta: () => { env.LOCAL_BETA_ENABLED = 'true'; },
      enableIsolatedObservability: () => { env.OBSERVABILITY_MODE = 'isolated-evidence'; },
      restartLocalRuntime: () => { localRuntime = createLocalRuntime(); },
      principals: Object.freeze(Object.fromEntries(principalNames.map(name => [name, publicPrincipal(name, privatePrincipals[name])])) as Record<PrincipalName, FixturePrincipal>),
      db,
      r2,
      rateLimitIdentity: requestIp,
      request,
      login: (principal, password = privatePrincipals[principal].password) => request('/api/auth/login', {
        method: 'POST', body: { email: privatePrincipals[principal].email, password },
      }),
      tokenTenant: async token => {
        const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { audience: 'app' });
        const tenantId = (payload as { tenant_id?: unknown }).tenant_id;
        if (tenantId !== 'fixture-tenant-a' && tenantId !== 'fixture-tenant-b') throw new Error('Fixture token has no valid tenant claim');
        return tenantId;
      },
      widgetTokenTenant: async token => {
        const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { audience: 'widget' });
        const tenantId = (payload as { tenant_id?: unknown }).tenant_id;
        if (tenantId !== 'fixture-tenant-a' && tenantId !== 'fixture-tenant-b') throw new Error('Fixture widget token has no valid tenant claim');
        return tenantId;
      },
      currentMfaCode: principal => {
        const secret = privatePrincipals[principal].mfaSecret;
        if (!secret) throw new Error('Fixture operator MFA secret is unavailable');
        return mfaCode(secret);
      },
      invalidMfaCode: principal => {
        const secret = privatePrincipals[principal].mfaSecret;
        if (!secret) throw new Error('Fixture operator MFA secret is unavailable');
        const verifier = new MFAService();
        for (let candidate = 0; candidate < 1_000_000; candidate++) {
          const code = String(candidate).padStart(6, '0');
          if (!verifier.verifyCode(code, secret)) return code;
        }
        throw new Error('Unable to derive a deliberately invalid fixture OTP');
      },
      createAgentSession: async (tenantId, mfaVerified = true) => {
        const id = `fixture-agent-${crypto.randomUUID()}`;
        const email = `${id}@example.test`;
        await db.prepare('INSERT INTO users (tenant_id, id, email, full_name, role, mfa_enabled) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(tenantId, id, email, 'Synthetic route agent', 'agent', 1).run();
        const token = await new AuthService().generateToken({
          id, email, full_name: 'Synthetic route agent', role: 'agent', tenant_id: tenantId, mfa_enabled: true,
        } as any, env.JWT_SECRET, mfaVerified);
        return Object.freeze({ id, token });
      },
      createScopedApiKey: async (operator, permissions) => {
        assert.ok(permissions.length > 0 && permissions.every(permission => permission === 'tickets:read' || permission === 'tickets:write'), 'Fixture API-key permissions must be ticket permissions');
        const principal = privatePrincipals[operator];
        assert.equal(principal.role, 'admin', 'Fixture API keys are available only for its fixed synthetic operators');
        const repositories = createRepositories(
          createSystemTenantScope({ tenantId: principal.tenantId, actor: 'synthetic-fixture-key-bootstrap' }),
          db,
        );
        const created = await repositories.apiKeys.create(`fixture-${operator}`, [...permissions]);
        return Object.freeze({ id: created.id, apiKey: created.apiKey, permissions: Object.freeze([...permissions]) });
      },
      revokePrincipalSessions: async principal => {
        const identity = privatePrincipals[principal];
        await db.prepare('UPDATE users SET session_version = session_version + 1 WHERE tenant_id = ? AND id = ?')
          .bind(identity.tenantId, identity.localId).run();
      },
      assertStoredCredentialProtection: async rawApiKey => {
        const rows = await db.prepare('SELECT email, password_hash, mfa_secret, mfa_enabled FROM users WHERE email IN (?, ?, ?, ?)').bind(...principalNames.map(name => privatePrincipals[name].email)).all<{
          email: string; password_hash: string; mfa_secret: string | null; mfa_enabled: number;
        }>();
        const credentialRows = rows.results as Array<{ email: string; password_hash: string; mfa_secret: string | null; mfa_enabled: number }>;
        assert.equal(credentialRows.length, 4);
        for (const principal of Object.values(privatePrincipals)) {
          const stored = credentialRows.find((row) => row.email === principal.email);
          assert.ok(stored?.password_hash && stored.password_hash !== principal.password && stored.password_hash.includes(':'));
          if (principal.mfaSecret) assert.ok(stored.mfa_enabled === 1 && stored.mfa_secret && stored.mfa_secret !== principal.mfaSecret);
          else assert.ok(stored?.mfa_enabled === 0 && stored.mfa_secret === null);
        }
        const keys = await db.prepare('SELECT key_hash, prefix, permissions, is_active FROM api_keys').all<{ key_hash: string; prefix: string; permissions: string; is_active: number }>();
        const storedKeys = keys.results as Array<{ key_hash: string; prefix: string; permissions: string; is_active: number }> ;
        assert.ok(storedKeys.length >= 1 && storedKeys.every((key) => key.key_hash !== rawApiKey && !key.key_hash.includes(rawApiKey) && key.prefix.length === 8));
      },
      resourceUsage: async () => {
        const rows = await db.prepare(`SELECT
          (SELECT count(*) FROM users) + (SELECT count(*) FROM tickets) + (SELECT count(*) FROM api_keys) AS count`).first<{ count: number }>();
        const objects = await r2.bucket.list();
        return Object.freeze({ d1Rows: rows?.count ?? 0, r2Objects: objects.objects.length, routeRequests });
      },
      notificationAttempts: () => notificationAttempts,
      resetNotificationAttempts: () => { notificationAttempts = 0; remainingNotificationFailures = 0; },
      failNotificationAttempts: count => {
        assert.ok(Number.isSafeInteger(count) && count >= 0, 'Notification failure count must be a non-negative integer');
        remainingNotificationFailures = count;
      },
    });
    return await callback(fixture);
  } finally {
    Object.assign(headersGlobal, { Headers: originalHeaders });
    await miniflare?.dispose();
  }
}

function tokenFrom(value: unknown): string {
  const token = (value as { token?: unknown })?.token;
  if (typeof token !== 'string') throw new Error('Expected an application token without reporting it');
  return token;
}

async function assertStatus(response: FixtureResponse, expected: number, message: string): Promise<void> {
  if (response.status !== expected) {
    await response.body?.cancel();
    assert.fail(`${message}: received status ${response.status}`);
  }
}

/** Executes the approved route-level two-tenant proof without logging secrets. */
export async function verifyTwoTenantFixture(): Promise<FixtureReport> {
  const started = Date.now();
  return withTwoTenantFixture(async fixture => {
    const customerAToken = tokenFrom(await (await fixture.login('customerA')).json());
    const customerBToken = tokenFrom(await (await fixture.login('customerB')).json());
    await assertStatus(await fixture.login('customerA', 'not-the-generated-password'), 401, 'Wrong customer password must be denied');

    const customerAIdentity = await (await fixture.request('/api/auth/me', { token: customerAToken })).json<{ user: { email: string; id: string } }>();
    const customerBIdentity = await (await fixture.request('/api/auth/me', { token: customerBToken })).json<{ user: { email: string; id: string } }>();
    assert.equal(customerAIdentity.user.email, fixture.principals.customerA.email);
    assert.equal(customerAIdentity.user.id, fixture.principals.customerA.localId);
    assert.equal(customerBIdentity.user.email, fixture.principals.customerB.email);
    assert.equal(customerBIdentity.user.id, fixture.principals.customerB.localId);
    assert.equal(await fixture.tokenTenant(customerAToken), fixture.principals.customerA.tenantId);
    assert.equal(await fixture.tokenTenant(customerBToken), fixture.principals.customerB.tenantId);

    for (const customer of ['customerA', 'customerB'] as const) {
      const principal = fixture.principals[customer];
      await assertStatus(await fixture.request('/api/v1/customer/auth/request', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { email: principal.email, type: 'magic_link', widgetKey: principal.widgetKey },
      }), 200, 'Customer magic-link request must use its scoped widget key');
      const messages = await (await fixture.request('/__local/auth-capture/messages')).json<Array<{ to: string; loginLink?: string }>>();
      const message = messages.find(candidate => candidate.to === principal.email);
      assert.ok(message?.loginLink, 'Local capture must retain the selected approved recipient and link');
      const link = new URL(message.loginLink!);
      assert.equal(link.origin, 'http://localhost:5174');
      assert.equal(link.pathname, '/verify');
      assert.equal(link.searchParams.get('key'), principal.widgetKey);
      const token = link.searchParams.get('token');
      assert.ok(token && /^[0-9a-f]{64}$/.test(token), 'Captured local link must contain an opaque auth token');
      const other = customer === 'customerA' ? fixture.principals.customerB : fixture.principals.customerA;
      await assertStatus(await fixture.request('/api/v1/customer/auth/verify', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { token, widgetKey: other.widgetKey },
      }), 401, 'Wrong tenant widget key must not redeem a customer link');
      const verified = await (await fixture.request('/api/v1/customer/auth/verify', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { token, widgetKey: principal.widgetKey },
      })).json<{ token: string; user: { tenant_id: string; email: string } }>();
      assert.equal(await fixture.widgetTokenTenant(verified.token), principal.tenantId);
      assert.equal(verified.user.tenant_id, principal.tenantId);
      assert.equal(verified.user.email, principal.email);
      const widgetIdentity = await (await fixture.request('/api/v1/customer/auth/me', { token: verified.token })).json<{ user: { tenant_id: string; email: string } }>();
      assert.equal(widgetIdentity.user.tenant_id, principal.tenantId);
      assert.equal(widgetIdentity.user.email, principal.email);
      await assertStatus(await fixture.request('/api/v1/customer/auth/verify', {
        method: 'POST', ip: `${fixture.rateLimitIdentity}-widget-${customer}`, body: { token, widgetKey: principal.widgetKey },
      }), 401, 'Customer link replay must be denied');
    }

    const operatorTokens: Partial<Record<'operatorA' | 'operatorB', string>> = {};
    for (const operator of ['operatorA', 'operatorB'] as const) {
      const challenge = await (await fixture.login(operator)).json<{ mfa_required: boolean; token: string }>();
      assert.equal(challenge.mfa_required, true, 'Fixture operator login must require MFA');
      await assertStatus(await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: challenge.token, body: { code: fixture.invalidMfaCode(operator) },
      }), 400, 'Authenticated wrong operator OTP must permit correction without granting access');
      await assertStatus(await fixture.request('/api/api-keys', { token: challenge.token }), 401, 'MFA challenge token must not reach dashboard metadata');
      operatorTokens[operator] = tokenFrom(await (await fixture.request('/api/auth/mfa/verify', {
        method: 'POST', token: challenge.token, body: { code: fixture.currentMfaCode(operator) },
      })).json());
    }

    const aToken = operatorTokens.operatorA!;
    const bToken = operatorTokens.operatorB!;
    const aKey = await (await fixture.request('/api/api-keys', { method: 'POST', token: aToken, body: { name: 'fixture-a-read' } })).json<{ id: string; apiKey: string }>();
    const bKey = await (await fixture.request('/api/api-keys', { method: 'POST', token: bToken, body: { name: 'fixture-b-read' } })).json<{ id: string; apiKey: string }>();
    assert.equal(typeof aKey.apiKey, 'string', 'API key stays only in local memory');
    assert.equal(typeof bKey.apiKey, 'string', 'API key stays only in local memory');

    const aMetadata = await (await fixture.request('/api/api-keys', { token: aToken })).json<Array<{ id: string }>>();
    const bMetadata = await (await fixture.request('/api/api-keys', { token: bToken })).json<Array<{ id: string }>>();
    assert.deepEqual(aMetadata.map(key => key.id), [aKey.id]);
    assert.deepEqual(bMetadata.map(key => key.id), [bKey.id]);
    await assertStatus(await fixture.request(`/api/api-keys/${bKey.id}`, { method: 'DELETE', token: aToken }), 200, 'Cross-tenant delete response');
    const bMetadataAfterForeignDelete = await (await fixture.request('/api/api-keys', { token: bToken })).json<Array<{ id: string }>>();
    assert.deepEqual(bMetadataAfterForeignDelete.map(key => key.id), [bKey.id], 'A cannot revoke B metadata');

    const aScopedTicket = await (await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: aKey.apiKey })).json<{ subject: string }>();
    const bScopedTicket = await (await fixture.request('/api/v1/tickets/fixture-ticket', { apiKey: bKey.apiKey })).json<{ subject: string }>();
    assert.equal(aScopedTicket.subject, 'Fixture ticket A');
    assert.equal(bScopedTicket.subject, 'Fixture ticket B');
    await assertStatus(await fixture.request('/api/v1/tickets/fixture-b-only', { apiKey: aKey.apiKey }), 404, 'A key cannot read B-only ticket');
    await assertStatus(await fixture.request('/api/v1/tickets/fixture-b-only', { apiKey: bKey.apiKey }), 200, 'B key can read B-only ticket');
    const ticketRowsBefore = await fixture.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>();
    await assertStatus(await fixture.request('/api/v1/tickets', {
      method: 'POST', apiKey: aKey.apiKey,
      body: { subject: 'must-not-write', customer_email: fixture.principals.customerA.email },
    }), 403, 'Read-only key must not write');
    await assertStatus(await fixture.request('/api/v1/tickets', { method: 'POST' }), 401, 'Missing key must be denied');
    await assertStatus(await fixture.request('/api/v1/tickets', { method: 'POST', apiKey: 'malformed' }), 401, 'Malformed key must be denied');
    const ticketRowsAfter = await fixture.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>();
    assert.equal(ticketRowsAfter?.count, ticketRowsBefore?.count, 'Denied key requests must not write tickets');

    await fixture.assertStoredCredentialProtection(aKey.apiKey);
    const duplicateRevocations = await Promise.all([0, 1].map(() => fixture.request(`/api/api-keys/${aKey.id}`, { method: 'DELETE', token: aToken })));
    for (const response of duplicateRevocations) await assertStatus(response, 200, 'Concurrent owner key revocation is idempotent');
    await assertStatus(await fixture.request('/api/v1/tickets/not-a-ticket', { apiKey: aKey.apiKey }), 401, 'Revoked key must be denied');

    await fixture.db.prepare('UPDATE users SET role = ? WHERE tenant_id = ? AND id = ?')
      .bind('customer', fixture.principals.operatorB.tenantId, fixture.principals.operatorB.localId).run();
    await assertStatus(await fixture.request('/api/api-keys', { token: bToken }), 401, 'Current D1 role/session change must deny stale operator token');

    await assert.rejects(
      fixture.db.prepare('INSERT INTO users (tenant_id, id, email, role) VALUES (?, ?, ?, ?)')
        .bind(fixture.principals.customerB.tenantId, 'duplicate-email', ` ${fixture.principals.customerA.email.toUpperCase()} `, 'customer').run(),
      /UNIQUE constraint failed|SQLITE_CONSTRAINT/,
      'Canonical email collision must be rejected',
    );
    const foreignKeys = await fixture.db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(foreignKeys.results.length, 0, 'Fresh fixture must satisfy foreign keys');

    const usage = await fixture.resourceUsage();
    return Object.freeze({
      result: 'passed', mode: 'disposable-miniflare', tenants: 2, principals: 4,
      customerPasswordLogins: 2, customerMagicLinkAuthentications: 2, operatorMfaLogins: 2, apiKeysCreated: 2,
      revokedKeysRejected: true, crossTenantMetadataWrites: 0,
      foreignKeyViolations: 0, remoteBindings: 0, ...usage, elapsedMs: Date.now() - started, cleanup: 'disposed',
    });
  });
}
