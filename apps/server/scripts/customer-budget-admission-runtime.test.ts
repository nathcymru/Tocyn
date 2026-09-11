import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
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
import { createTenantRequestDeps } from '../src/middleware/tenant.middleware';
import { admitCustomerAuthEffect } from '../src/budgets/customer-auth-admission.service';
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

test('customer auth fences native token and session effects after admission-time widget, session, and policy changes', async () => {
  const f = await fixture();
  try {
    const clock = Date.now();
    const policyRow = await f.db.prepare("SELECT policy_json FROM budget_owner_policies WHERE deployment_id='customer-deployment'").first<{policy_json:string}>();
    const currentPolicy = JSON.parse(policyRow!.policy_json);
    currentPolicy.budgets = currentPolicy.budgets.map((budget: any) => ({ ...budget,
      window: { ...budget.window, startsAt: clock - 1_000, endsAt: clock + 60_000 } }));
    await f.db.prepare("UPDATE budget_owner_policies SET policy_json=? WHERE deployment_id='customer-deployment'").bind(JSON.stringify(currentPolicy)).run();
    const namespace = await f.mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace;
    const env = { DB: f.db, BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', BUDGET_COORDINATOR_DO: namespace,
      localNow: () => clock } as any;
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

    const staleWidget = await admitWidget();
    assert.equal(staleWidget.status, 'admitted');
    await f.db.prepare("UPDATE tenant_config SET value='widget-rotated' WHERE tenant_id='tenant-a' AND key='widget.public_key'").run();
    await assert.rejects(() => widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'auth-widget-revoked', 'hash-widget-revoked', 'magic_link', '2099-01-01', staleWidget.admission!.fence));
    staleWidget.admission!.settle('unknown');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM customer_auth_tokens WHERE tenant_id='tenant-a'").first<{ n:number }>())!.n, 1,
      'a rotated widget key cannot write an admitted token after the prepay');

    await f.db.prepare("UPDATE tenant_config SET value='widget-a' WHERE tenant_id='tenant-a' AND key='widget.public_key'").run();
    const stalePolicy = await admitWidget();
    assert.equal(stalePolicy.status, 'admitted');
    await f.db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='tenant-a'").run();
    await assert.rejects(() => widgetDeps.repositories.users.storeCustomerAuthToken('shared-customer', 'auth-policy-revoked', 'hash-policy-revoked', 'magic_link', '2099-01-01', stalePolicy.admission!.fence));
    stalePolicy.admission!.settle('unknown');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM customer_auth_tokens WHERE tenant_id='tenant-a'").first<{ n:number }>())!.n, 1,
      'a revoked tenant allocation cannot write an admitted token after the prepay');

    await f.db.prepare("UPDATE budget_tenant_allocations SET state='active' WHERE tenant_id='tenant-a'").run();
    const customerScope = createVerifiedTenantScope('tenant-a', 'shared-customer', ['customer'], 1);
    const customerDeps = createTenantRequestDeps(customerScope, env);
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
