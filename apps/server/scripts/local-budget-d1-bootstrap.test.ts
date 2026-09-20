import assert from 'node:assert/strict';
import test from 'node:test';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { initializeFreshLocalBetaPolicy } from './local-beta-d1-bootstrap';
import { initializeSyntheticLocalBudgetAuthority } from './local-budget-d1-bootstrap';
import { withTwoTenantFixture, type LocalTenantFixture } from './local-tenant-fixture';

function betaInput(fixture: LocalTenantFixture) {
  const { customerA, operatorA, customerB, operatorB } = fixture.principals;
  return {
    runId: 'synthetic-budget-run', tenants: [customerA.tenantId, customerB.tenantId],
    invitations: [customerA, operatorA, customerB, operatorB].map(principal => ({
      tenantId: principal.tenantId, id: principal.localId,
      kind: principal.role === 'customer' ? 'customer' as const : 'staff' as const,
    })),
  };
}
async function budgetRows(db: D1Database) {
  return Promise.all(['budget_deployment_authority', 'budget_owner_policies', 'budget_tenant_allocations']
    .map(async table => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n));
}

test('synthetic budget bootstrap requires the exact fresh two-tenant beta catalogue', async () => {
  await withTwoTenantFixture(async fixture => {
    const input = betaInput(fixture);
    const now = Date.now();
    const budget = { runId: input.runId, tenantIds: input.tenants, now, intervalWindowMs: 120_000 };
    await assert.rejects(initializeSyntheticLocalBudgetAuthority(fixture.db, budget),
      'the owner authority cannot precede guarded local-beta admission');
    assert.deepEqual(await budgetRows(fixture.db), [0, 0, 0]);
    await initializeFreshLocalBetaPolicy(fixture.db, input);
    await assert.rejects(initializeSyntheticLocalBudgetAuthority(fixture.db, {
      ...budget, tenantIds: [input.tenants[0], 'foreign-tenant'],
    }));
    assert.deepEqual(await budgetRows(fixture.db), [0, 0, 0]);
    await initializeSyntheticLocalBudgetAuthority(fixture.db, budget);
    assert.deepEqual(await budgetRows(fixture.db), [1, 1, 2]);
    const authority = await new BudgetAuthorityRepository(fixture.db).resolveForDeploymentIngress(now);
    assert.ok(authority, 'the full synthetic owner policy and both allocations resolve together');
    assert.ok(authority.ownerPolicy.budgets.some(budget => budget.window.kind === 'interval'
      && budget.window.endsAt === now + 120_000));
    assert.deepEqual(authority.tenantAllocations.map(allocation => allocation.effectivePolicy.tenantId).sort(),
      [...input.tenants].sort());
    await assert.rejects(initializeSyntheticLocalBudgetAuthority(fixture.db, budget),
      'a second bootstrap cannot overwrite an existing authority');
    assert.deepEqual(await budgetRows(fixture.db), [1, 1, 2]);
  });
});

test('an allocation write failure rolls back the owner authority and allows a fresh retry', async () => {
  await withTwoTenantFixture(async fixture => {
    const input = betaInput(fixture);
    await initializeFreshLocalBetaPolicy(fixture.db, input);
    const budget = { runId: input.runId, tenantIds: input.tenants, now: Date.now(), intervalWindowMs: 60_000 };
    await fixture.db.prepare(`CREATE TRIGGER reject_second_synthetic_allocation
      BEFORE INSERT ON budget_tenant_allocations WHEN NEW.tenant_id='fixture-tenant-b'
      BEGIN SELECT RAISE(ABORT,'synthetic allocation failure'); END`).run();
    await assert.rejects(initializeSyntheticLocalBudgetAuthority(fixture.db, budget));
    assert.deepEqual(await budgetRows(fixture.db), [0, 0, 0]);
    await fixture.db.prepare('DROP TRIGGER reject_second_synthetic_allocation').run();
    await initializeSyntheticLocalBudgetAuthority(fixture.db, budget);
    assert.deepEqual(await budgetRows(fixture.db), [1, 1, 2]);
  });
});
