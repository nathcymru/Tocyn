import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { CustomerBudgetReservationService } from '../src/budgets/customer-budget-reservation.service';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import {
  CUSTOMER_BUDGET_CREDENTIAL_D1_READ_BOUND,
  CUSTOMER_BUDGET_CURRENT_CREDENTIAL_SQL,
  CUSTOMER_BUDGET_TICKET_OWNERSHIP_SQL,
  CustomerCurrentCredentialRepository,
  type CustomerBudgetCredential,
  type CustomerBudgetRequirements,
} from '../src/repositories/customer-current-credential.repository';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);
const root = resolve(import.meta.dirname, '..');

/** Native D1/DO proof only; customer HTTP and canonical write wiring remain later work. */
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
    const limits = { workerRequests: 1_000, d1RowsRead: 10_000_000, d1RowsWritten: 10_000, doRequests: 1_000, doRowsRead: 1_000, doRowsWritten: 1_000, logEvents: 100_000 };
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
    const reserve = async (operation: string, tenantId = 'tenant-a', credential = credentialFor(tenantId), requirements = requirementsFor(tenantId)) => {
      const scope = scopeFor(tenantId);
      const service = new CustomerBudgetReservationService(cache);
      const prepared = service.prepare({ repository: new BudgetAuthorityRepository(db, scope), customers: new CustomerCurrentCredentialRepository(db, scope), namespace,
        scope, credential, requirements, intent: { operationId: operation, operationFingerprint: `digest:${operation}`, workScopeKey: 'ticket:shared-ticket' },
        business: { d1RowsRead: 2_560, d1RowsWritten: 1, logEvents: 136 }, now: () => NOW });
      assert.ok(prepared, 'trusted composition supplied a bounded private intent');
      return { result: await service.reserve(prepared), handoff: service.commitHandoff(prepared) };
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
