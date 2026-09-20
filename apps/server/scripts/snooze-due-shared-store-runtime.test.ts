import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { RESOURCE_DIMENSIONS, STOCK_DIMENSIONS } from '@luminatick/shared';
import { createLocalSnoozeController } from './local-snooze-controller';
import { splitSql } from './split-sql';
import type { runFundedLocalSnoozeStep } from '../src/auth/automation-composition';

const root = resolve(import.meta.dirname, '..');
type DueResult = Awaited<ReturnType<typeof runFundedLocalSnoozeStep>>;
type DueRpc = { runDue: (tenant: string, purpose: 'new-work' | 'recovery') => Promise<DueResult>;
  [Symbol.dispose]?: () => void };

test('the private due timer shares the review app store, wakes unattended and survives a restart', async () => {
  const [app, due] = await Promise.all([
    build({ entryPoints: [join(root, 'src/local-index.ts')], bundle: true, format: 'esm', platform: 'neutral',
      external: ['cloudflare:workers', 'node:crypto', 'node:async_hooks'], write: false }),
    build({ entryPoints: [join(root, 'scripts/snooze-due-local-entry.ts')], bundle: true, format: 'esm', platform: 'neutral',
      external: ['cloudflare:workers', 'node:crypto'], write: false }),
  ]);
  const common = { modules: true as const, compatibilityDate: '2024-04-03', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'review-shared-d1' } };
  const options = convertV4MiniflareOptions({ workers: [
    { ...common, name: 'review-app', script: app.outputFiles[0].text,
      bindings: { ENVIRONMENT: 'local', LOCAL_BETA_ENABLED: 'false', BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1' },
      durableObjects: { BUDGET_COORDINATOR_DO: 'BudgetCoordinatorDO', BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO',
        NOTIFICATION_DO: 'NotificationDO' } },
    { ...common, name: 'due-private', script: due.outputFiles[0].text,
      bindings: { ENVIRONMENT: 'local', LOCAL_BETA_ENABLED: 'true', BUDGET_ADMISSION_POLICY: 'ticket-mutations-v1',
        LOCAL_DUE_CATALOGUE: JSON.stringify(['due-a', 'due-b']) },
      durableObjects: {
        BUDGET_COORDINATOR_DO: { className: 'BudgetCoordinatorDO', scriptName: 'review-app' },
        BUDGET_GRANT_HOLDER_DO: { className: 'BudgetGrantHolderDO', scriptName: 'review-app' },
      } },
  ] });
  const mf = new Miniflare(options);
  const directory = await mkdtemp(join(tmpdir(), 'due-shared-'));
  const markerPath = join(directory, 'marker.json');
  let controller: Awaited<ReturnType<typeof createLocalSnoozeController>> | undefined;
  let rpc: DueRpc | undefined;
  try {
    let db = await mf.getD1Database('DB', 'review-app');
    for (const file of readdirSync(join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root, 'migrations', file), 'utf8')).map(sql => db.prepare(sql)));
    }
    const now = Date.now();
    const limits = Object.fromEntries(RESOURCE_DIMENSIONS.map(dimension => [dimension, 1_000_000_000]));
    const policy = { schemaVersion: 1, policyId: 'due-policy', revision: 1, deploymentId: 'due-deployment',
      mode: 'conservative', catalogueVersion: 'synthetic-due', maxGrantLifetimeMs: 60_000,
      budgets: RESOURCE_DIMENSIONS.map(dimension => ({ dimension, allocationId: `due-${dimension}`, limit: limits[dimension],
        recoveryPercent: 20, provenance: 'owner-allocation', window: STOCK_DIMENSIONS.includes(dimension)
          ? { kind: 'stock', id: `due-stock-${dimension}` }
          : { kind: 'interval', id: 'due-window', startsAt: now - 1_000, endsAt: now + 3_600_000 } })) };
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES('due-deployment',1,'active',?)").bind(now),
      db.prepare("INSERT INTO budget_owner_policies VALUES('due-deployment','due-policy',1,1,'due-coordinator',64,60000,?)")
        .bind(JSON.stringify(policy)),
    ]);
    const futureDeadline = new Date(now + 3_600_000).toISOString();
    for (const tenant of ['due-a', 'due-b']) {
      const restriction = { schemaVersion: 1, tenantId: tenant, ownerPolicyId: 'due-policy', ownerPolicyRevision: 1,
        revision: 1, mode: 'conservative', limits, disabledFeatures: [] };
      await db.batch([
        db.prepare("INSERT INTO budget_tenant_allocations VALUES('due-deployment',?,'due-policy',1,1,?,?,'active')")
          .bind(tenant, tenant, JSON.stringify(restriction)),
        db.prepare('INSERT INTO groups(tenant_id,id,name) VALUES(?,?,?)').bind(tenant, 'group', 'Synthetic'),
        db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,group_id,source) VALUES(?,'same-id','Due review','customer@example.test','group','dashboard')")
          .bind(tenant),
      ]);
      await db.prepare('UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id=?')
        .bind(futureDeadline, tenant).run();
    }
    const health = await mf.dispatchFetch('http://localhost:8787/health');
    assert.equal(health.status, 200, `the review app worker must be live in the shared runtime: ${await health.text()}`);
    assert.equal((await mf.dispatchFetch('http://localhost:8787/no-private-due-route')).status, 404);
    rpc = await mf.getWorker('due-private') as unknown as DueRpc;
    await assert.rejects(async () => rpc!.runDue('outside-catalogue', 'new-work'));
    const scheduler = { set(callback: () => void, requestedMs: number) {
      assert.equal(requestedMs, 60_000);
      return setTimeout(callback, 80);
    }, clear(handle: unknown) { clearTimeout(handle as NodeJS.Timeout); } };
    controller = await createLocalSnoozeController({ tenantIds: ['due-a', 'due-b'], markerPath, mode: 'fresh',
      scheduler, invoke: (tenant, purpose) => rpc!.runDue(tenant, purpose) });
    await controller.start();
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{ n: number }>())?.n, 0);
    // Set a due time only after the first empty cycle; the next host timer
    // must discover it without a test call to controller.tick().
    await db.prepare("UPDATE ticket_support_state SET snoozed_until=? WHERE tenant_id='due-a'")
      .bind(new Date(Date.now() + 350).toISOString()).run();
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline &&
      (await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{ n: number }>())?.n !== 1) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{ n: number }>())?.n, 1,
      'the host timer must wake the due ticket without an explicit tick');
    assert.equal((await db.prepare("SELECT active_snoozes AS n FROM snooze_scheduler_tenants WHERE tenant_id='due-a'").first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare("SELECT active_snoozes AS n FROM snooze_scheduler_tenants WHERE tenant_id='due-b'").first<{ n: number }>())?.n, 1,
      'same ticket ID in another tenant remains snoozed');
    assert.deepEqual(await db.prepare("SELECT snoozed_until, resurface_reason FROM ticket_support_state WHERE tenant_id='due-a' AND ticket_id='same-id'")
      .first(), { snoozed_until: null, resurface_reason: 'due' });
    const generation = (await db.prepare("SELECT generation FROM snooze_due_checkpoint WHERE tenant_id='due-a'")
      .first<{ generation: number }>())?.generation;
    assert.ok(generation && generation > 0);
    const namespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO', 'review-app') as unknown as
      DurableObjectNamespace & { [Symbol.dispose]?: () => void };
    const coordinator = namespace.get(namespace.idFromName('due-coordinator')) as unknown as {
      inspectForTrustedRuntime: () => Promise<{ tenantStates: Array<{ tenantId: string; grants: unknown[] }> }>;
      [Symbol.dispose]?: () => void;
    };
    try {
      const charged = await coordinator.inspectForTrustedRuntime() as Awaited<ReturnType<typeof coordinator.inspectForTrustedRuntime>> & {
        [Symbol.dispose]?: () => void;
      };
      try {
        assert.ok(charged.tenantStates.find(state => state.tenantId === 'due-a')?.grants.length,
          'private due grants must be present in the review app Durable Object namespace');
      } finally { charged[Symbol.dispose]?.(); }
    } finally { coordinator[Symbol.dispose]?.(); namespace[Symbol.dispose]?.(); }
    await controller.dispose();
    controller = undefined;
    rpc[Symbol.dispose]?.();
    await mf.setOptions(options);
    db = await mf.getD1Database('DB', 'review-app');
    rpc = await mf.getWorker('due-private') as unknown as DueRpc;
    controller = await createLocalSnoozeController({ tenantIds: ['due-a', 'due-b'], markerPath, mode: 'restart',
      scheduler, invoke: (tenant, purpose) => rpc!.runDue(tenant, purpose) });
    await controller.start();
    assert.equal(controller.snapshot()[0].purpose, 'recovery');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM support_state_events WHERE tenant_id='due-a'").first<{ n: number }>())?.n, 1,
      'the recovery read must not replay the due transition');
    assert.equal((await db.prepare("SELECT generation FROM snooze_due_checkpoint WHERE tenant_id='due-a'")
      .first<{ generation: number }>())?.generation, generation);
    assert.equal((await db.prepare("SELECT active_snoozes AS n FROM snooze_scheduler_tenants WHERE tenant_id='due-b'")
      .first<{ n: number }>())?.n, 1);
  } finally {
    await controller?.dispose();
    rpc?.[Symbol.dispose]?.();
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
