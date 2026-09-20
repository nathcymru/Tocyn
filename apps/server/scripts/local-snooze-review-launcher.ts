/** Host-only prototype: one loopback Miniflare owns the app, private due RPC,
 * run-owned D1/R2/DO state and the unattended timer. Never deploy this file. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { initializeFreshLocalBetaPolicy } from './local-beta-d1-bootstrap';
import { initializeSyntheticLocalBudgetAuthority } from './local-budget-d1-bootstrap';
import { createLocalSnoozeController } from './local-snooze-controller';
import { createLocalFixtureBootstrap } from './local-tenant-fixture';
import { splitSql } from './split-sql';
import type { runFundedLocalSnoozeStep } from '../src/auth/automation-composition';

const serverRoot = resolve(import.meta.dirname, '..');
const tenants = ['fixture-tenant-a', 'fixture-tenant-b'] as const;
type DueResult = Awaited<ReturnType<typeof runFundedLocalSnoozeStep>>;
type DueRpc = { runDue: (tenant: string, purpose: 'new-work' | 'recovery') => Promise<DueResult>;
  [Symbol.dispose]?: () => void };
type Scheduler = NonNullable<Parameters<typeof createLocalSnoozeController>[0]['scheduler']>;
type Credential = Readonly<{ email: string; password: string; provisioningUri?: string; portalLoginUrl?: string }>;

/** Attempt every owned cleanup step even when one fails. Successful steps are
 * not repeated; a failed step can be retried by the caller. */
export function createReviewDisposal(steps: Readonly<{
  controller: () => Promise<void>; rpc: () => void; runtime: () => Promise<void>; files: () => Promise<void>;
}>): () => Promise<void> {
  const done = new Set<keyof typeof steps>();
  let flight: Promise<void> | undefined;
  return () => {
    if (flight) return flight;
    if (done.size === 4) return Promise.resolve();
    flight = (async () => {
      const errors: unknown[] = [];
      for (const name of ['controller', 'rpc', 'runtime', 'files'] as const) {
        if (done.has(name)) continue;
        try { await steps[name](); done.add(name); }
        catch (error) { errors.push(error); }
      }
      if (errors.length) throw errors[0];
    })().finally(() => { flight = undefined; });
    return flight;
  };
}

export type IsolatedSnoozeReview = Readonly<{
  origin: string;
  credentials: readonly Credential[];
  /** Host-only test inspection. Never mount this as an HTTP route. */
  db: D1Database;
  dueSnapshot: () => ReturnType<Awaited<ReturnType<typeof createLocalSnoozeController>>['snapshot']>;
  dispose: () => Promise<void>;
}>;

/** The caller owns this disposable process. The only public socket is its new
 * loopback port; bootstrap responds 503 until both policies are committed. */
export async function startIsolatedSnoozeReview(input: { port: number; intervalWindowMs: number;
  scheduler?: Scheduler }): Promise<IsolatedSnoozeReview> {
  if (!Number.isSafeInteger(input.port) || input.port < 1024 || input.port > 65535 || input.port === 8787) {
    throw new Error('Choose an isolated loopback port other than 8787');
  }
  if (!Number.isSafeInteger(input.intervalWindowMs) || input.intervalWindowMs < 60_000
    || input.intervalWindowMs > 86_400_000) throw new Error('Local budget window must be 1 minute to 24 hours');

  const [app, due] = await Promise.all([
    build({ entryPoints: [join(serverRoot, 'src/local-index.ts')], bundle: true, format: 'esm', platform: 'neutral',
      external: ['cloudflare:workers', 'node:crypto', 'node:async_hooks'], write: false }),
    build({ entryPoints: [join(serverRoot, 'scripts/snooze-due-local-entry.ts')], bundle: true, format: 'esm',
      platform: 'neutral', external: ['cloudflare:workers', 'node:crypto'], write: false }),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'tocyn-snooze-review-'));
  const state = join(directory, 'state');
  const markerPath = join(directory, 'due-marker.json');
  const origin = `http://127.0.0.1:${input.port}`;
  const secrets = { JWT_SECRET: randomBytes(32).toString('hex'), APP_MASTER_KEY: randomBytes(32).toString('hex'),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
  const common = { modules: true as const, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'snooze-review-d1' } };
  const appBindings = { ...secrets, ENVIRONMENT: 'local', LOCAL_BETA_ENABLED: 'true',
    BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', PORTAL_URL: 'http://localhost:5174',
    DASHBOARD_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5174,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:5173',
    LOCAL_RUNTIME_ORIGIN: origin };
  const options = (live: boolean) => convertV4MiniflareOptions({ host: '127.0.0.1', port: input.port,
    resourcePersistencePath: state, workers: live ? [
      { ...common, name: 'review-app', script: app.outputFiles[0].text, bindings: appBindings,
        r2Buckets: { ATTACHMENTS_BUCKET: 'snooze-review-r2' },
        durableObjects: { NOTIFICATION_DO: 'NotificationDO', BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO',
          BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' } },
      { ...common, name: 'due-private', script: due.outputFiles[0].text,
        bindings: { ENVIRONMENT: 'local', LOCAL_BETA_ENABLED: 'true',
          BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', LOCAL_DUE_CATALOGUE: JSON.stringify(tenants) },
        durableObjects: {
          BUDGET_COORDINATOR_DO: { className: 'BudgetCoordinatorDO', scriptName: 'review-app' },
          BUDGET_GRANT_HOLDER_DO: { className: 'BudgetGrantHolderDO', scriptName: 'review-app' },
        } },
    ] : [{ ...common, name: 'review-app', script: 'export default { fetch() { return new Response(null, { status: 503 }) } }',
      bindings: { ENVIRONMENT: 'local', LOCAL_BETA_ENABLED: 'false', BUDGET_ADMISSION_POLICY: 'off' },
      r2Buckets: { ATTACHMENTS_BUCKET: 'snooze-review-r2' } }] });
  let mf: Miniflare | undefined;
  let controller: Awaited<ReturnType<typeof createLocalSnoozeController>> | undefined;
  let rpc: DueRpc | undefined;
  const dispose = createReviewDisposal({
    controller: async () => { await controller?.dispose(); },
    rpc: () => { rpc?.[Symbol.dispose]?.(); },
    runtime: async () => { await mf?.dispose(); },
    files: () => rm(directory, { recursive: true, force: true }),
  });
  try {
    mf = new Miniflare(options(false));
    let db = await mf.getD1Database('DB', 'review-app');
    for (const file of readdirSync(join(serverRoot, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(serverRoot, 'migrations', file), 'utf8')).map(sql => db.prepare(sql)));
    }
    const bootstrap = await createLocalFixtureBootstrap(secrets);
    await db.batch(splitSql(bootstrap.sql).map(sql => db.prepare(sql)));
    const now = Date.now();
    await db.batch(tenants.flatMap(tenant => [
      db.prepare('INSERT INTO groups(tenant_id,id,name) VALUES(?,?,?)').bind(tenant, 'review-group', 'Review'),
      db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,group_id,source) VALUES(?,'due-review','Synthetic snooze review','fixture-customer',?,'review-group','dashboard')")
        .bind(tenant, tenant === tenants[0] ? 'tocyn-auth-test-a@example.invalid' : 'tocyn-auth-test-b@example.invalid'),
    ]));
    await db.batch(tenants.map((tenant, index) => db.prepare("UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id=? AND ticket_id='due-review'")
      .bind(new Date(now + (index === 0 ? 90_000 : 3_600_000)).toISOString(), tenant)));
    const runId = `snooze-review-${randomBytes(8).toString('hex')}`;
    await initializeFreshLocalBetaPolicy(db, { runId, tenants, invitations: tenants.flatMap(tenant => [
      { tenantId: tenant, kind: 'customer' as const, id: 'fixture-customer' },
      { tenantId: tenant, kind: 'staff' as const, id: 'fixture-operator' },
    ]) });
    await initializeSyntheticLocalBudgetAuthority(db, { runId, tenantIds: tenants, now, intervalWindowMs: input.intervalWindowMs });
    await mf.setOptions(options(true));
    // setOptions replaces Miniflare stubs even though run-owned D1/DO storage
    // remains the same; never hand a poisoned bootstrap stub to the host.
    db = await mf.getD1Database('DB', 'review-app');
    const publicUrl = await mf.ready;
    assert.equal(publicUrl.hostname, '127.0.0.1');
    assert.equal(publicUrl.port, String(input.port));
    const health = await fetch(new URL('/health', publicUrl), { signal: AbortSignal.timeout(5_000) });
    assert.equal(health.status, 200, 'Local review app did not become healthy');
    await health.body?.cancel();
    rpc = await mf.getWorker('due-private') as unknown as DueRpc;
    controller = await createLocalSnoozeController({ tenantIds: tenants, markerPath, mode: 'fresh',
      scheduler: input.scheduler, invoke: (tenant, purpose) => rpc!.runDue(tenant, purpose) });
    await controller.start();
    return { origin, credentials: bootstrap.credentials, db, dueSnapshot: () => controller!.snapshot(), dispose };
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Local review setup and cleanup both failed'); }
    throw error;
  }
}
