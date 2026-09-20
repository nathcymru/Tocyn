import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RESOURCE_DIMENSIONS, STOCK_DIMENSIONS } from '@luminatick/shared';
import type { D1Database } from '@cloudflare/workers-types';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { costPolicySchema, effectiveTenantPolicy } from '../src/utils/cost-policy';
import { configureLocalBetaTicketAdmission, initializeLocalBetaTicketAdmission } from './local-beta-ticket-admission';

function state() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of ['0027_local_beta_admission.sql', '0034_budget_authority.sql']) {
    db.exec(readFileSync(join(import.meta.dirname, '../migrations', migration), 'utf8'));
  }
  db.prepare('INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES (?,100,1000,200,100)')
    .run('local-beta-test');
  db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES (1,'local-beta-test',1,'running')").run();
  for (const tenant of ['fixture-tenant-a', 'fixture-tenant-b']) {
    db.prepare('INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES (?,?)').run('local-beta-test', tenant);
  }
  return db;
}

function d1ReadAdapter(db: Database.Database): D1Database {
  const prepare = (sql: string, args: readonly unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args),
  });
  return { prepare, batch: async (statements: Array<ReturnType<typeof prepare>>) => Promise.all(statements.map(statement => statement.all())) } as unknown as D1Database;
}

test('only explicit local-beta config enables combined ticket admission', () => {
  const ordinary = { vars: { ENVIRONMENT: 'local', BUDGET_ADMISSION_POLICY: 'off' }, compatibility_flags: ['nodejs_compat'] };
  configureLocalBetaTicketAdmission(ordinary, false);
  assert.deepEqual(ordinary.vars, { ENVIRONMENT: 'local', BUDGET_ADMISSION_POLICY: 'off' });
  assert.deepEqual(ordinary.compatibility_flags, ['nodejs_compat']);
  const beta = { vars: { ENVIRONMENT: 'local', BUDGET_ADMISSION_POLICY: 'off' }, compatibility_flags: ['nodejs_compat'] } as
    { vars: Record<string, string>; compatibility_flags: string[] };
  configureLocalBetaTicketAdmission(beta, true);
  assert.deepEqual(beta.vars, { ENVIRONMENT: 'local', BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1', LOCAL_BETA_ENABLED: 'true' });
  assert.deepEqual(beta.compatibility_flags, ['nodejs_compat', 'rpc']);
  assert.throws(() => configureLocalBetaTicketAdmission({ vars: { ENVIRONMENT: 'production', BUDGET_ADMISSION_POLICY: 'off' }, compatibility_flags: ['nodejs_compat'] }, true));
  assert.throws(() => configureLocalBetaTicketAdmission({ vars: { ENVIRONMENT: 'local', BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1' }, compatibility_flags: ['nodejs_compat'] }, true));
});

test('run-owned local-beta policy gets complete two-tenant authority for an eight-hour preview', async () => {
  const db = state();
  try {
    const now = Date.parse('2026-09-20T12:00:00.000Z');
    initializeLocalBetaTicketAdmission(db, 'local-beta-test', now);
    const deployment = db.prepare('SELECT deployment_id,state FROM budget_deployment_authority').get() as { deployment_id: string; state: string };
    assert.deepEqual(deployment, { deployment_id: 'local-beta-test-budget', state: 'active' });
    const ownerRow = db.prepare('SELECT policy_json,max_reservations,authority_max_age_ms FROM budget_owner_policies').get() as { policy_json: string; max_reservations: number; authority_max_age_ms: number };
    const policy = costPolicySchema.parse(JSON.parse(ownerRow.policy_json));
    assert.equal(ownerRow.max_reservations, 1024, 'The finite local review capacity must allow extended browsing without changing production policy');
    assert.equal(ownerRow.authority_max_age_ms, 60_000);
    assert.deepEqual(policy.budgets.map(budget => budget.dimension), [...RESOURCE_DIMENSIONS]);
    assert.ok(policy.budgets.every(budget => STOCK_DIMENSIONS.includes(budget.dimension)
      ? budget.window.kind === 'stock'
      : budget.window.kind === 'interval' && budget.window.startsAt <= now && budget.window.endsAt >= now + 8 * 60 * 60 * 1000));
    const allocations = db.prepare('SELECT tenant_id,restriction_json,state FROM budget_tenant_allocations ORDER BY tenant_id')
      .all() as Array<{ tenant_id: string; restriction_json: string; state: string }>;
    assert.deepEqual(allocations.map(row => row.tenant_id), ['fixture-tenant-a', 'fixture-tenant-b']);
    for (const allocation of allocations) {
      assert.equal(allocation.state, 'active');
      const effective = effectiveTenantPolicy(policy, JSON.parse(allocation.restriction_json), allocation.tenant_id);
      assert.deepEqual(effective.budgets.map(budget => budget.dimension), [...RESOURCE_DIMENSIONS]);
    }
    const trusted = await new BudgetAuthorityRepository(d1ReadAdapter(db)).resolveForDeploymentIngress(now);
    assert.ok(trusted, 'The real owner authority resolver accepts the complete synthetic policy');
    assert.deepEqual(trusted.tenantAllocations.map(allocation => allocation.effectivePolicy.tenantId),
      ['fixture-tenant-a', 'fixture-tenant-b']);
    assert.throws(() => initializeLocalBetaTicketAdmission(db, 'local-beta-test', now), /initialized only once/);
    assert.equal((db.prepare('SELECT count(*) AS count FROM budget_tenant_allocations').get() as { count: number }).count, 2);
  } finally { db.close(); }
});

test('authority bootstrap rejects the wrong run, stopped run and extra tenant without partial writes', () => {
  for (const corrupt of ['run', 'stopped', 'tenant'] as const) {
    const db = state();
    try {
      if (corrupt === 'stopped') db.prepare("UPDATE local_beta_policy SET state='writes_stopped'").run();
      if (corrupt === 'tenant') db.prepare("INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES ('local-beta-test','other-tenant')").run();
      assert.throws(() => initializeLocalBetaTicketAdmission(db, corrupt === 'run' ? 'other-run' : 'local-beta-test'));
      assert.equal((db.prepare('SELECT count(*) AS count FROM budget_deployment_authority').get() as { count: number }).count, 0);
      assert.equal((db.prepare('SELECT count(*) AS count FROM budget_tenant_allocations').get() as { count: number }).count, 0);
    } finally { db.close(); }
  }
});
