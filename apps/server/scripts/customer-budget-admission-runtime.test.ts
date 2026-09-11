import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database, D1PreparedStatement, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { CustomerBudgetReservationService } from '../src/budgets/customer-budget-reservation.service';
import { CANONICAL_MUTATION_D1_WRITES } from '../src/budgets/canonical-mutation-envelope';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { estimateNotificationBroadcastWithCleanupEnvelope } from '../src/durable_objects/notification-resource-envelope';
import { CUSTOMER_TICKET_ENVELOPES } from '../src/middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../src/observability/resource-envelope';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { CustomerAuthBudgetFenceError } from '../src/repositories/customer-auth-budget-fence';
import { createTenantRequestDeps } from '../src/middleware/tenant.middleware';
import { admitCustomerAuthEffect, CUSTOMER_AUTH_ENVELOPES } from '../src/budgets/customer-auth-admission.service';
import {
  CUSTOMER_BUDGET_CREDENTIAL_D1_READ_BOUND,
  CUSTOMER_BUDGET_CURRENT_CREDENTIAL_SQL,
  CUSTOMER_BUDGET_TICKET_OWNERSHIP_SQL,
  CustomerCurrentCredentialRepository,
  type CustomerBudgetCredential,
  type CustomerBudgetRequirements,
} from '../src/repositories/customer-current-credential.repository';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import { sumResourceEnvelopes } from '../src/utils/cost-policy';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);
const root = resolve(import.meta.dirname, '..');

/** Records native D1 write metadata at the database boundary for one attempt. */
function meterNativeD1Writes(database: D1Database): Readonly<{
  database: D1Database; reset: () => void; rowsWritten: () => number; samples: () => readonly (readonly number[])[];
}> {
  let rowsWritten = 0;
  let samples: number[][] = [];
  const rawStatements = new WeakMap<object, D1PreparedStatement>();
  const record = (result: any): any => {
    const results = Array.isArray(result) ? result : [result];
    for (const item of results) {
      const rows = item?.meta?.rows_written;
      assert.equal(Number.isSafeInteger(rows) && rows >= 0, true, 'native D1 result exposes rows_written metadata');
      rowsWritten += rows;
    }
    samples.push(results.map(item => item.meta.rows_written));
    return result;
  };
  const statement = (target: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(target as object, { get(value, property) {
      if (property === 'bind') return (...args: unknown[]) => statement((value as D1PreparedStatement).bind(...args));
      if (property === 'run' || property === 'all') return async () => record(await (value as D1PreparedStatement)[property]());
      const member = Reflect.get(value, property);
      return typeof member === 'function' ? member.bind(value) : member;
    } }) as D1PreparedStatement;
    rawStatements.set(proxy as object, target);
    return proxy;
  };
  const metered = new Proxy(database as object, { get(target, property) {
    if (property === 'prepare') return (sql: string) => statement((target as D1Database).prepare(sql));
    if (property === 'batch') return async (statements: D1PreparedStatement[]) => record(await (target as D1Database)
      .batch(statements.map(item => rawStatements.get(item as object) ?? item)));
    const member = Reflect.get(target, property);
    return typeof member === 'function' ? member.bind(target) : member;
  } }) as D1Database;
  return { database: metered, reset: () => { rowsWritten = 0; samples = []; }, rowsWritten: () => rowsWritten, samples: () => samples };
}

/** Native D1/DO proof for the customer reservation seam; route composition is covered separately. */
async function fixture() {
  const bundled = await build({ absWorkingDir: root, entryPoints: ['scripts/budget-coordinator-do-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'customer-budget-proof', modules: true,
    compatibilityDate: '2024-04-03', script: bundled.outputFiles[0].text, d1Databases: { DB: 'customer-budget-d1' },
    durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true,
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const migration of readdirSync(join(root, 'migrations')).filter((file: string) => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', migration), 'utf8')).map(sql => db.prepare(sql)));
    }
    const limits = { workerRequests: 1_000, d1RowsRead: 10_000_000, d1RowsWritten: 10_000, r2ClassBOperations: 10_000,
      doRequests: 10_000, doRowsRead: 10_000, doRowsWritten: 10_000, logEvents: 10_000_000 };
    const owner = { schemaVersion: 1, policyId: 'customer-policy', revision: 1, deploymentId: 'customer-deployment', mode: 'conservative',
      catalogueVersion: 'synthetic-2026-09', maxGrantLifetimeMs: 60_000,
      budgets: Object.entries(limits).map(([dimension, limit]) => ({ dimension, limit, allocationId: `customer-${dimension}`, recoveryPercent: 20,
        provenance: 'owner-allocation', window: { kind: 'interval', id: 'customer-window', startsAt: NOW - 1, endsAt: NOW + 3_600_000 } })),
    };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('customer-deployment',1,'active',?)").bind(NOW),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('customer-deployment','customer-policy',1,1,'customer-aggregate',64,30000,?)`).bind(JSON.stringify(owner)),
    ]);
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      const restriction = { schemaVersion: 1, tenantId, ownerPolicyId: 'customer-policy', ownerPolicyRevision: 1, revision: 1, mode: 'conservative', limits, disabledFeatures: [] };
      await db.batch([
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES (?,'shared-customer',?,'customer',1)").bind(tenantId, ` Customer-${tenantId}@Example.test `),
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES (?,'other-customer',?,'customer',1)").bind(tenantId, `other-${tenantId}@example.test`),
        db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_id,customer_email,source) VALUES (?,'shared-ticket','Synthetic','shared-customer',?,'portal')").bind(tenantId, ` CUSTOMER-${tenantId}@example.test `),
        db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('customer-deployment',?,'customer-policy',1,1,?,?,'active')`).bind(tenantId, `customer-${tenantId}`, JSON.stringify(restriction)),
      ]);
    }
    const rawNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = rawNamespace.get(rawNamespace.idFromName('customer-aggregate')) as unknown as BudgetCoordinatorDO;
    const calls = { refresh: 0, reserve: 0 };
    const namespace = {
      idFromName: (name: string) => rawNamespace.idFromName(name),
      get: () => ({
        refreshFromTrustedAuthority: async (value: Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0]) => { calls.refresh++; return coordinator.refreshFromTrustedAuthority(value); },
        reserveFromTrustedAuthority: async (value: Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0]) => { calls.reserve++; return coordinator.reserveFromTrustedAuthority(value); },
      }),
    } as unknown as DurableObjectNamespace;
    const cache = new IsolateBudgetAdmissionCache();
    const scopeFor = (tenantId: string) => createVerifiedTenantScope(tenantId, 'shared-customer', ['customer'], 1);
    const credentialFor = (tenantId: string): CustomerBudgetCredential => ({ tenantId, actorId: 'shared-customer', role: 'customer', sessionVersion: 1,
      expiresAt: NOW / 1_000 + 60, email: `customer-${tenantId}@example.test` });
    const requirementsFor = (tenantId: string): CustomerBudgetRequirements => ({ ticket: { id: 'shared-ticket', customerId: 'shared-customer', customerEmail: `customer-${tenantId}@example.test` } });
    const reserve = async (operation: string, tenantId = 'tenant-a', credential = credentialFor(tenantId), requirements = requirementsFor(tenantId),
      business: ResourceAmounts = { d1RowsRead: 2_560, d1RowsWritten: 1, logEvents: 136 }) => {
      const scope = scopeFor(tenantId);
      const service = new CustomerBudgetReservationService(cache);
      const prepared = service.prepareCustomerReservation({ repository: new BudgetAuthorityRepository(db, scope), customers: new CustomerCurrentCredentialRepository(db, scope), namespace,
        scope, credential, requirements, intent: { operationId: operation, operationFingerprint: `digest:${operation}`, workScopeKey: 'ticket:shared-ticket' },
        business, now: () => NOW });
      assert.ok(prepared, 'trusted composition supplied a bounded private intent');
      return { service, prepared, result: await service.reserve(prepared), handoff: service.commitHandoff(prepared) };
    };
    return { mf, db, coordinator, calls, cache, reserve, credentialFor, requirementsFor };
  } catch (error) { await mf.dispose(); throw error; }
}

test('customer reservations isolate colliding tenant/customer/ticket IDs and keep warm admissions off the budget DO', async () => {
  const f = await fixture();
  try {
    const first = await f.reserve('portal.reply.a');
    assert.equal(first.result.status, 'spent');
    assert.ok(first.handoff);
    assert.ok(Object.isFrozen(first.handoff) && Object.isFrozen(first.handoff.credential) && Object.isFrozen(first.handoff.authority));
    assert.equal(first.handoff.authority.purpose, 'new-work');
    assert.equal(first.service.commitHandoff(first.prepared), null, 'a grant cannot be handed to two canonical write attempts');
    const cold = { ...f.calls };
    assert.equal((await f.reserve('portal.reply.b')).result.status, 'spent');
    assert.deepEqual(f.calls, cold, 'the second authorized customer operation spends a preallocated warm grant');
    assert.equal((await f.reserve('portal.reply.a', 'tenant-b')).result.status, 'spent');
    const states = (await f.coordinator.inspectForTrustedRuntime()).tenantStates;
    assert.equal(states.find(state => state.tenantId === 'tenant-a')?.grants.length, 1);
    assert.equal(states.find(state => state.tenantId === 'tenant-b')?.grants.length, 1);
  } finally { await f.mf.dispose(); }
});

test('customer credential failures deny before admission and leave canonical tables untouched', async () => {
  const f = await fixture();
  try {
    const credential = f.credentialFor('tenant-a');
    for (const changed of [
      { ...credential, tenantId: 'tenant-b' }, { ...credential, actorId: 'missing' }, { ...credential, role: 'agent' as never },
      { ...credential, sessionVersion: 0 }, { ...credential, expiresAt: NOW / 1_000 }, { ...credential, email: 'other-tenant-a@example.test' },
    ]) assert.equal((await f.reserve(`denied:${JSON.stringify(changed)}`, 'tenant-a', changed)).result.status, 'rejected');
    assert.equal((await f.reserve('wrong-owner', 'tenant-a', credential, { ticket: { id: 'shared-ticket', customerId: 'other-customer', customerEmail: credential.email } })).result.status, 'rejected');
    assert.equal((await f.reserve('wrong-ticket', 'tenant-a', credential, { ticket: { id: 'missing-ticket', customerId: 'shared-customer', customerEmail: credential.email } })).result.status, 'rejected');
    assert.deepEqual(f.calls, { refresh: 0, reserve: 0 });
    assert.equal(f.cache.inspectForTrustedRuntime().operations, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM tickets').first<{ count: number }>())?.count, 2);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM articles').first<{ count: number }>())?.count, 0);
  } finally { await f.mf.dispose(); }
});

test('customer auth fences native token and session effects after admission-time widget, session, and policy changes', async t => {
  const f = await fixture();
  try {
    const clock = Date.now();
    const policyRow = await f.db.prepare("SELECT policy_json FROM budget_owner_policies WHERE deployment_id='customer-deployment'").first<{policy_json:string}>();
    const currentPolicy = JSON.parse(policyRow!.policy_json);
    currentPolicy.budgets = currentPolicy.budgets.map((budget: any) => ({ ...budget,
      window: { ...budget.window, startsAt: clock - 1_000, endsAt: clock + 60_000 } }));
    await f.db.prepare("UPDATE budget_owner_policies SET policy_json=? WHERE deployment_id='customer-deployment'").bind(JSON.stringify(currentPolicy)).run();
    const namespace = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace;
    const writeMeter = meterNativeD1Writes(f.db);
    const env = { DB: writeMeter.database, BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: namespace,
      localNow: () => clock } as any;
    const assertEnvelopeWrites = (operation: 'request' | 'verify' | 'logout' | 'session'): void => {
      const rowsWritten = writeMeter.rowsWritten(), envelope = CUSTOMER_AUTH_ENVELOPES[operation].d1RowsWritten ?? 0;
      assert.ok(rowsWritten <= envelope, `${operation} wrote ${rowsWritten}/${envelope} D1 rows`);
      t.diagnostic(`native customer auth ${operation}: ${rowsWritten}/${envelope} D1 rows written ${JSON.stringify(writeMeter.samples())}`);
    };
    const widgetScope = createVerifiedTenantScope('tenant-a', 'widget-anonymous', ['customer'], 1);
    const widgetDeps = createTenantRequestDeps(widgetScope, env);
    await f.db.prepare("INSERT INTO tenant_config(tenant_id,key,value) VALUES ('tenant-a','widget.public_key','widget-a')").run();
    const admitWidget = () => admitCustomerAuthEffect({ env, deps: widgetDeps, operation: 'request',
      principal: { kind: 'widget' as const, widgetKey: 'widget-a' }, credentialKey: 'widget:widget-a', now: () => clock });

    const first = await admitWidget();
    assert.equal(first.status, 'admitted');
    assert.ok(first.admission);
    await widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'auth-success', 'hash-success', 'magic_link', '2099-01-01', first.admission!.fence);
    first.admission!.settle('committed');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM customer_auth_tokens WHERE tenant_id='tenant-a'").first<{ n:number }>())!.n, 1);

    const historicalOtpCount = 512;
    for (let offset = 0; offset < historicalOtpCount; offset += 64) {
      await f.db.batch(Array.from({ length: Math.min(64, historicalOtpCount - offset) }, (_, index) => {
        const token = offset + index;
        return f.db.prepare(`INSERT INTO customer_auth_tokens (tenant_id,id,user_id,token_hash,type,expires_at)
          VALUES ('tenant-a',?,'shared-customer',?,'otp','2000-01-01')`).bind(`historical-otp-${token}`, `historical-hash-${token}`);
      }));
    }
    writeMeter.reset();
    const admitOtpVerify = () => admitCustomerAuthEffect({ env, deps: widgetDeps, operation: 'verify',
      principal: { kind: 'widget' as const, widgetKey: 'widget-a' }, credentialKey: 'widget:widget-a', now: () => clock });
    const otpIssue = await admitWidget();
    await widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'otp-fifth', 'otp-fifth-hash', 'otp', '2099-01-01', otpIssue.admission!.fence);
    otpIssue.admission!.settle('committed');
    const otpIssueWrites = writeMeter.rowsWritten();
    assertEnvelopeWrites('request');
    t.diagnostic(`native OTP issue after ${historicalOtpCount} historical rows: ${otpIssueWrites}/${CUSTOMER_AUTH_ENVELOPES.request.d1RowsWritten} D1 rows written`);
    for (let attempt = 0; attempt < 4; attempt++) {
      const admission = await admitOtpVerify();
      assert.equal(await widgetDeps.repositories.users.verifyAndConsumeCustomerAuthToken(`wrong-${attempt}`, '2026-09-11T10:00:00.000Z', 'otp-fifth', admission.admission!.fence), null);
      admission.admission!.settle('committed');
    }
    writeMeter.reset();
    const fifth = await admitOtpVerify();
    assert.equal((await widgetDeps.repositories.users.verifyAndConsumeCustomerAuthToken('otp-fifth-hash', '2026-09-11T10:00:00.000Z', 'otp-fifth', fifth.admission!.fence))?.id, 'shared-customer');
    fifth.admission!.settle('committed');
    assertEnvelopeWrites('verify');
    const exhaustedIssue = await admitWidget();
    await widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'otp-exhausted', 'otp-exhausted-hash', 'otp', '2099-01-01', exhaustedIssue.admission!.fence);
    exhaustedIssue.admission!.settle('committed');
    for (let attempt = 0; attempt < 5; attempt++) {
      const admission = await admitOtpVerify();
      assert.equal(await widgetDeps.repositories.users.verifyAndConsumeCustomerAuthToken(`exhausted-${attempt}`, '2026-09-11T10:00:00.000Z', 'otp-exhausted', admission.admission!.fence), null);
      admission.admission!.settle('committed');
    }
    const exhausted = await admitOtpVerify();
    assert.equal(await widgetDeps.repositories.users.verifyAndConsumeCustomerAuthToken('otp-exhausted-hash', '2026-09-11T10:00:00.000Z', 'otp-exhausted', exhausted.admission!.fence), null,
      'an exhausted OTP is not consumed by a later claim');
    exhausted.admission!.settle('committed');
    assert.equal((await f.db.prepare("SELECT used_at FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id='otp-exhausted'").first<{used_at:string|null}>())!.used_at, null);
    await f.db.batch([
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-a','pointer-delete','pointer-delete@example.test','customer',1)"),
      f.db.prepare("INSERT INTO customer_auth_tokens (tenant_id,id,user_id,token_hash,type,expires_at) VALUES ('tenant-a','pointer-delete-otp','pointer-delete','pointer-delete-hash','otp','2099-01-01')"),
      f.db.prepare("INSERT INTO customer_current_otp_challenges(tenant_id,user_id,token_id) VALUES ('tenant-a','pointer-delete','pointer-delete-otp')"),
    ]);
    await f.db.prepare("DELETE FROM users WHERE tenant_id='tenant-a' AND id='pointer-delete'").run();
    assert.equal(await f.db.prepare("SELECT token_id FROM customer_current_otp_challenges WHERE tenant_id='tenant-a' AND user_id='pointer-delete'").first(), null,
      'deleting a tenant-qualified customer cascades its OTP pointer');

    const staleWidget = await admitWidget();
    assert.equal(staleWidget.status, 'admitted');
    await f.db.prepare("UPDATE tenant_config SET value='widget-rotated' WHERE tenant_id='tenant-a' AND key='widget.public_key'").run();
    await assert.rejects(() => widgetDeps.repositories.users.get('shared-customer', staleWidget.admission!.fence), CustomerAuthBudgetFenceError,
      'a stale fence is not indistinguishable from a missing customer');
    await assert.rejects(() => widgetDeps.repositories.users.create({ tenant_id: 'tenant-a', email: 'stale-create@example.test', full_name: 'stale', role: 'customer', mfa_enabled: false }, staleWidget.admission!.fence), CustomerAuthBudgetFenceError,
      'a stale fence cannot report a failed customer creation as an ordinary write failure');
    await assert.rejects(() => widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'auth-widget-revoked', 'hash-widget-revoked', 'magic_link', '2099-01-01', staleWidget.admission!.fence));
    staleWidget.admission!.settle('unknown');
    const expectedAuthTokens = historicalOtpCount + 3;
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM customer_auth_tokens WHERE tenant_id='tenant-a'").first<{ n:number }>())!.n, expectedAuthTokens,
      'a rotated widget key cannot write an admitted token after the prepay');

    await f.db.prepare("UPDATE tenant_config SET value='widget-a' WHERE tenant_id='tenant-a' AND key='widget.public_key'").run();
    const stalePolicy = await admitWidget();
    assert.equal(stalePolicy.status, 'admitted');
    await f.db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='tenant-a'").run();
    await assert.rejects(() => widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'auth-policy-revoked', 'hash-policy-revoked', 'magic_link', '2099-01-01', stalePolicy.admission!.fence));
    stalePolicy.admission!.settle('unknown');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM customer_auth_tokens WHERE tenant_id='tenant-a'").first<{ n:number }>())!.n, expectedAuthTokens,
      'a revoked tenant allocation cannot write an admitted token after the prepay');

    await f.db.prepare("UPDATE budget_tenant_allocations SET state='active' WHERE tenant_id='tenant-a'").run();
    const customerScope = createVerifiedTenantScope('tenant-a', 'shared-customer', ['customer'], 1);
    const customerDeps = createTenantRequestDeps(customerScope, env);
    writeMeter.reset();
    const session = await admitCustomerAuthEffect({ env, deps: customerDeps, operation: 'session',
      principal: { kind: 'session' as const, sessionVersion: 1 }, credentialKey: 'customer:shared-customer:1', now: () => clock });
    assert.equal(session.status, 'admitted');
    assert.equal((await customerDeps.repositories.users.get('shared-customer', session.admission!.fence))?.id, 'shared-customer');
    session.admission!.settle('committed');
    assertEnvelopeWrites('session');

    await f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version) VALUES ('tenant-a','logout-customer','logout-customer@example.test','customer',1)").run();
    const normalLogoutScope = createVerifiedTenantScope('tenant-a', 'logout-customer', ['customer'], 1);
    const normalLogoutDeps = createTenantRequestDeps(normalLogoutScope, env);
    writeMeter.reset();
    const normalLogout = await admitCustomerAuthEffect({ env, deps: normalLogoutDeps, operation: 'logout',
      principal: { kind: 'session' as const, sessionVersion: 1 }, credentialKey: 'customer:logout-customer:1', now: () => clock });
    assert.equal(normalLogout.status, 'admitted');
    await normalLogoutDeps.repositories.users.revokeSessions('logout-customer', normalLogout.admission!.fence);
    normalLogout.admission!.settle('committed');
    assertEnvelopeWrites('logout');

    const logout = await admitCustomerAuthEffect({ env, deps: customerDeps, operation: 'logout',
      principal: { kind: 'session' as const, sessionVersion: 1 }, credentialKey: 'customer:shared-customer:1', now: () => clock });
    assert.equal(logout.status, 'admitted');
    await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='shared-customer'").run();
    await assert.rejects(() => customerDeps.repositories.users.revokeSessions('shared-customer', logout.admission!.fence));
    logout.admission!.settle('unknown');
    assert.equal((await f.db.prepare("SELECT session_version FROM users WHERE tenant_id='tenant-a' AND id='shared-customer'").first<{session_version:number}>())!.session_version, 2,
      'a revoked customer session cannot perform a later logout write');
  } finally { await f.mf.dispose(); }
});

test('customer credential issuance atomically rechecks tenant identity and the current OTP pointer', async t => {
  const f = await fixture();
  try {
    const clock = Date.now();
    const policyRow = await f.db.prepare("SELECT policy_json FROM budget_owner_policies WHERE deployment_id='customer-deployment'").first<{ policy_json: string }>();
    const policy = JSON.parse(policyRow!.policy_json);
    policy.budgets = policy.budgets.map((budget: any) => ({ ...budget,
      window: { ...budget.window, startsAt: clock - 1_000, endsAt: clock + 60_000 } }));
    await f.db.prepare("UPDATE budget_owner_policies SET policy_json=? WHERE deployment_id='customer-deployment'").bind(JSON.stringify(policy)).run();
    const writeMeter = meterNativeD1Writes(f.db);
    const env = { DB: writeMeter.database, BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO'),
      localNow: () => clock } as any;
    const depsFor = (tenantId: string) => createTenantRequestDeps(createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1), env);
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      await f.db.prepare("INSERT INTO tenant_config(tenant_id,key,value) VALUES (?, 'widget.public_key', ?)")
        .bind(tenantId, `widget-${tenantId}`).run();
    }
    const admit = async (tenantId: string) => {
      const deps = depsFor(tenantId);
      const result = await admitCustomerAuthEffect({ env, deps, operation: 'request', principal: { kind: 'widget', widgetKey: `widget-${tenantId}` },
        credentialKey: `widget:${tenantId}`, now: () => clock });
      assert.equal(result.status, 'admitted');
      assert.ok(result.admission);
      return { deps, admission: result.admission! };
    };
    const issue = (email: string, userId: string, tokenId: string, type: 'magic_link' | 'otp' = 'magic_link', expectedUserId: string | null = null,
      expectedCurrentOtpTokenId: string | null = null, expectedCurrentOtpTokenHash: string | null = null) => ({ email, fullName: email.split('@')[0], expectedUserId, userId, tokenId,
      tokenHash: `hash-${tokenId}`, type, expiresAt: '2099-01-01T00:00:00.000Z', expectedCurrentOtpTokenId, expectedCurrentOtpTokenHash });
    const newIssueRows: string[] = [];

    // Matching user IDs in separate tenant scopes must not collide.
    for (const [tenantId, type] of [['tenant-a', 'magic_link'], ['tenant-b', 'otp']] as const) {
      writeMeter.reset();
      const current = await admit(tenantId);
      await current.deps.repositories.users.issueCustomerAuthCredential(
        issue(`new-customer-${tenantId}@example.test`, 'new-customer', `credential-${tenantId}`, type), current.admission.fence);
      current.admission.settle('committed');
      assert.ok(writeMeter.rowsWritten() <= (CUSTOMER_AUTH_ENVELOPES.request.d1RowsWritten ?? 0),
        `new-user ${type} issue wrote ${writeMeter.rowsWritten()}/${CUSTOMER_AUTH_ENVELOPES.request.d1RowsWritten} D1 rows`);
      newIssueRows.push(`${type}:${writeMeter.rowsWritten()}/${CUSTOMER_AUTH_ENVELOPES.request.d1RowsWritten}`);
    }
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM users WHERE id='new-customer'").first<{ count: number }>())?.count, 2);
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM customer_auth_tokens WHERE id IN ('credential-tenant-a','credential-tenant-b')").first<{ count: number }>())?.count, 2);
    assert.equal((await f.db.prepare("SELECT token_id FROM customer_current_otp_challenges WHERE tenant_id='tenant-b' AND user_id='new-customer'").first<{ token_id: string }>())?.token_id, 'credential-tenant-b');
    t.diagnostic(`native new-customer customer-auth writes ${newIssueRows.join(', ')}`);

    // A customer created after preflight cannot leave the planned shadow user or token behind.
    const identityRace = await admit('tenant-a');
    await f.db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES ('tenant-a','racing-customer','identity-race@example.test','customer')").run();
    await assert.rejects(() => identityRace.deps.repositories.users.issueCustomerAuthCredential(
      issue('identity-race@example.test', 'planned-shadow', 'identity-race-token'), identityRace.admission.fence), CustomerAuthBudgetFenceError);
    identityRace.admission.settle('unknown');
    assert.equal(await f.db.prepare("SELECT id FROM users WHERE tenant_id='tenant-a' AND id='planned-shadow'").first(), null);
    assert.equal(await f.db.prepare("SELECT id FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id='identity-race-token'").first(), null);

    // A different tenant can win the globally unique login after preflight.
    const globalRace = await admit('tenant-a');
    await f.db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES ('tenant-b','global-racer','global-race@example.test','customer')").run();
    await assert.rejects(() => globalRace.deps.repositories.users.issueCustomerAuthCredential(
      issue('global-race@example.test', 'global-shadow', 'global-race-token'), globalRace.admission.fence), /UNIQUE constraint failed/);
    globalRace.admission.settle('unknown');
    assert.equal(await f.db.prepare("SELECT id FROM users WHERE tenant_id='tenant-a' AND id='global-shadow'").first(), null);
    assert.equal(await f.db.prepare("SELECT id FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id='global-race-token'").first(), null);
    assert.ok(await f.db.prepare("SELECT id FROM users WHERE tenant_id='tenant-b' AND id='global-racer'").first());

    // A changed OTP pointer invalidates the issue snapshot before the token insert.
    const pointerRace = await admit('tenant-a');
    await f.db.batch([
      f.db.prepare("INSERT INTO customer_auth_tokens(tenant_id,id,user_id,token_hash,type,expires_at) VALUES ('tenant-a','prior-otp','shared-customer','prior-hash','otp','2099-01-01')"),
      f.db.prepare("INSERT INTO customer_current_otp_challenges(tenant_id,user_id,token_id) VALUES ('tenant-a','shared-customer','prior-otp')"),
    ]);
    await assert.rejects(() => pointerRace.deps.repositories.users.issueCustomerAuthCredential(
      issue('customer-tenant-a@example.test', 'shared-customer', 'pointer-race-token', 'otp', 'shared-customer'), pointerRace.admission.fence), CustomerAuthBudgetFenceError);
    pointerRace.admission.settle('unknown');
    assert.equal(await f.db.prepare("SELECT id FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id='pointer-race-token'").first(), null);
    assert.equal((await f.db.prepare("SELECT token_id FROM customer_current_otp_challenges WHERE tenant_id='tenant-a' AND user_id='shared-customer'").first<{ token_id: string }>())?.token_id, 'prior-otp');

    // Keeping the pointer but mutating its token hash also invalidates the snapshot.
    const hashRace = await admit('tenant-a');
    await f.db.prepare("UPDATE customer_auth_tokens SET token_hash='mutated-prior-hash' WHERE tenant_id='tenant-a' AND id='prior-otp'").run();
    await assert.rejects(() => hashRace.deps.repositories.users.issueCustomerAuthCredential(
      issue('customer-tenant-a@example.test', 'shared-customer', 'hash-race-token', 'otp', 'shared-customer', 'prior-otp', 'prior-hash'), hashRace.admission.fence), CustomerAuthBudgetFenceError);
    hashRace.admission.settle('unknown');
    assert.equal(await f.db.prepare("SELECT id FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id='hash-race-token'").first(), null);

    // Live credential authority is checked in the same batch, after reservation but before issue.
    const widgetRace = await admit('tenant-a');
    await f.db.prepare("UPDATE tenant_config SET value='rotated-widget' WHERE tenant_id='tenant-a' AND key='widget.public_key'").run();
    await assert.rejects(() => widgetRace.deps.repositories.users.issueCustomerAuthCredential(
      issue('widget-race@example.test', 'widget-race-user', 'widget-race-token'), widgetRace.admission.fence), CustomerAuthBudgetFenceError);
    widgetRace.admission.settle('unknown');
    assert.equal(await f.db.prepare("SELECT id FROM users WHERE tenant_id='tenant-a' AND id='widget-race-user'").first(), null);

    await f.db.prepare("UPDATE tenant_config SET value='widget-tenant-a' WHERE tenant_id='tenant-a' AND key='widget.public_key'").run();
    const policyRace = await admit('tenant-a');
    await f.db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='tenant-a'").run();
    await assert.rejects(() => policyRace.deps.repositories.users.issueCustomerAuthCredential(
      issue('policy-race@example.test', 'policy-race-user', 'policy-race-token'), policyRace.admission.fence), CustomerAuthBudgetFenceError);
    policyRace.admission.settle('unknown');
    assert.equal(await f.db.prepare("SELECT id FROM users WHERE tenant_id='tenant-a' AND id='policy-race-user'").first(), null);

    await f.db.prepare("UPDATE budget_tenant_allocations SET state='active' WHERE tenant_id='tenant-a'").run();
    const lostAck = await admit('tenant-a');
    await lostAck.deps.repositories.users.issueCustomerAuthCredential(
      issue('lost-ack@example.test', 'lost-ack-user', 'lost-ack-token'), lostAck.admission.fence);
    // A caller that loses the response cannot infer a rollback; it retains the reservation as unknown.
    lostAck.admission.settle('unknown');
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM users WHERE tenant_id='tenant-a' AND id='lost-ack-user'").first<{ count: number }>())?.count, 1);
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id='lost-ack-token'").first<{ count: number }>())?.count, 1);
    t.diagnostic('native customer credential issue preserves durable effects when acknowledgement is lost; no storage-stock credit is inferred');
  } finally { await f.mf.dispose(); }
});

test('admission-off customer credential issuance keeps identity/credential writes atomic on token collisions', async () => {
  const f = await fixture();
  try {
    const scope = createVerifiedTenantScope('tenant-a', 'widget-anonymous', ['customer'], 1);
    const deps = createTenantRequestDeps(scope, { DB: f.db } as any);
    const collisionToken = 'admission-off-token-collision';
    await f.db.prepare("INSERT INTO customer_auth_tokens (tenant_id,id,user_id,token_hash,type,expires_at) VALUES ('tenant-a',?,?,?,?,?)")
      .bind(collisionToken, 'shared-customer', 'existing-token-hash', 'magic_link', '2099-01-01').run();
    await assert.rejects(() => deps.repositories.users.issueCustomerAuthCredential({
      email: 'admission-off-atomic@example.test',
      fullName: 'atomic-offline',
      expectedUserId: null,
      userId: 'admission-off-shadow-user',
      tokenId: collisionToken,
      tokenHash: 'shadow-token-hash',
      type: 'magic_link',
      expiresAt: '2099-01-01',
      expectedCurrentOtpTokenId: null,
      expectedCurrentOtpTokenHash: null,
    }), /UNIQUE constraint failed/);

    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM users WHERE tenant_id='tenant-a' AND id='admission-off-shadow-user'").first<{ count: number }>())?.count,
      0, 'no shadow user remains after a token-insert collision without admission');
    assert.equal((await f.db.prepare("SELECT count(*) AS count FROM customer_auth_tokens WHERE tenant_id='tenant-a' AND id=?").bind(collisionToken)
      .first<{ count: number }>())?.count, 1, 'the preexisting token is untouched by the failed issuance');
  } finally { await f.mf.dispose(); }
});

test('customer read authority resolves current ownership before a warm grant can reveal a target ticket', async () => {
  const f = await fixture();
  try {
    const read = { readTicketId: 'shared-ticket' };
    assert.equal((await f.reserve('read-before-change', 'tenant-a', f.credentialFor('tenant-a'), read)).result.status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare("UPDATE tickets SET customer_id='other-customer',customer_email='other-tenant-a@example.test' WHERE tenant_id='tenant-a' AND id='shared-ticket'").run();
    assert.equal((await f.reserve('read-after-owner-change', 'tenant-a', f.credentialFor('tenant-a'), read)).result.status, 'rejected');
    assert.deepEqual(f.calls, before, 'current ownership denial consumes no further coordinator work');
    assert.equal((await f.reserve('read-tenant-b', 'tenant-b', f.credentialFor('tenant-b'), { readTicketId: 'shared-ticket' })).result.status, 'spent');
  } finally { await f.mf.dispose(); }
});

for (const [label, mutation] of [
  ['customer session revocation', "UPDATE users SET session_version=2 WHERE tenant_id='tenant-a' AND id='shared-customer'"],
  ['customer role change', "UPDATE users SET role='agent' WHERE tenant_id='tenant-a' AND id='shared-customer'"],
  ['ticket owner change', "UPDATE tickets SET customer_id='other-customer',customer_email='other-tenant-a@example.test' WHERE tenant_id='tenant-a' AND id='shared-ticket'"],
] as const) test(`a ${label} rejects a previously warm customer reservation without another DO call`, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.reserve('before-change')).result.status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare(mutation).run();
    assert.equal((await f.reserve('after-change')).result.status, 'rejected');
    assert.deepEqual(f.calls, before);
    assert.equal((await f.reserve('tenant-b-remains-current', 'tenant-b')).result.status, 'spent');
  } finally { await f.mf.dispose(); }
});

test('malformed policy authority fails closed after current customer evidence, without claiming provider billing behavior', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.reserve('before-policy-failure')).result.status, 'spent');
    const before = { ...f.calls };
    await f.db.prepare("UPDATE budget_tenant_allocations SET restriction_json='not-json' WHERE tenant_id='tenant-a'").run();
    assert.equal((await f.reserve('policy-failure')).result.status, 'rejected');
    assert.deepEqual(f.calls, before);
  } finally { await f.mf.dispose(); }
});

test('customer current-credential reads are bounded and use tenant-scoped primary-key lookups', async () => {
  const f = await fixture();
  try {
    assert.equal(CUSTOMER_BUDGET_CREDENTIAL_D1_READ_BOUND, 2);
    const userPlan = await f.db.prepare(`EXPLAIN QUERY PLAN ${CUSTOMER_BUDGET_CURRENT_CREDENTIAL_SQL}`).bind('tenant-a', 'shared-customer').all<{ detail: string }>();
    const ticketPlan = await f.db.prepare(`EXPLAIN QUERY PLAN ${CUSTOMER_BUDGET_TICKET_OWNERSHIP_SQL}`).bind('tenant-a', 'shared-ticket').all<{ detail: string }>();
    assert.ok(userPlan.results.some((row: { detail: string }) => /SEARCH users USING (?:COVERING )?INDEX sqlite_autoindex_users_1/.test(row.detail)));
    assert.ok(ticketPlan.results.some((row: { detail: string }) => /SEARCH tickets USING (?:COVERING )?INDEX sqlite_autoindex_tickets_1/.test(row.detail)));
  } finally { await f.mf.dispose(); }
});

test('customer reply reservation includes bounded NotificationDO fanout and retry reuses its allowance', async () => {
  const expectedReplyEnvelope = sumResourceEnvelopes({ workerRequests: 2, d1RowsRead: 2_570,
    d1RowsWritten: CANONICAL_MUTATION_D1_WRITES, r2ClassBOperations: 30,
    ...estimateDiagnosticEnvelope({ httpRequests: 2 }),
  }, estimateNotificationBroadcastWithCleanupEnvelope());
  assert.deepEqual(CUSTOMER_TICKET_ENVELOPES['portal.ticket.reply'], expectedReplyEnvelope);
  assert.equal(CUSTOMER_TICKET_ENVELOPES['portal.ticket.create'].doRequests, undefined,
    'customer creates and widget creates have no committed notification broadcast');

  const f = await fixture();
  try {
    const winner = await f.reserve('portal.ticket.reply', 'tenant-a', f.credentialFor('tenant-a'), f.requirementsFor('tenant-a'), expectedReplyEnvelope);
    assert.equal(winner.result.status, 'spent');
    assert.ok(winner.handoff, 'the winner carries the complete reply reservation into its canonical fence');
    const callsBeforeRetry = { ...f.calls };
    assert.equal((await f.reserve('portal.ticket.reply', 'tenant-a', f.credentialFor('tenant-a'), f.requirementsFor('tenant-a'), expectedReplyEnvelope)).result.status, 'idempotent',
      'the same operation fingerprint can recover with its existing reservation');
    assert.deepEqual(f.calls, callsBeforeRetry, 'a recovery uses no second coordinator allocation for the reply fanout envelope');
  } finally { await f.mf.dispose(); }
});
