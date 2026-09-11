import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

const NOW = Date.UTC(2026, 8, 11, 11, 0, 0);

test('real Miniflare warm holder persists a decrement before reply and rejects replay/fault races', async () => {
  const bundled = await build({ entryPoints: ['scripts/budget-coordinator-do-runtime-entry.ts'], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], write: false });
  let mf: Miniflare | undefined;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'budget-holder-proof', modules: true, script: bundled.outputFiles[0].text,
      durableObjects: { BUDGET_GRANT_HOLDER_DO: 'BudgetGrantHolderDO' }, unsafeEphemeralDurableObjects: true }] }));
    const namespace = await mf.getDurableObjectNamespace('BUDGET_GRANT_HOLDER_DO') as unknown as DurableObjectNamespace<BudgetGrantHolderDO>;
    const holder = namespace.get(namespace.idFromName(JSON.stringify(['budget-grant-holder-v1', 'tenant-a', 'holder-a']))) as unknown as BudgetGrantHolderDO;
    const grant = {
      reservationId: 'server-issued-reservation-a:1', holderId: 'holder-a', idempotencyKey: 'grant-a', purpose: 'new-work' as const,
      policyRevision: 7, restrictionRevision: 3, createdAt: NOW, expiresAt: NOW + 60_000, status: 'reserved' as const, holderSeedAttempts: 1,
      envelope: { workerRequests: 5 }, remaining: { workerRequests: 5 }, accounted: { workerRequests: 5 },
      allocations: [{ dimension: 'workerRequests' as const, allocationId: 'owner-worker-requests', windowId: 'subscription-2026-09' }],
    };
    await holder.seedFromTrustedAuthority({ grant, tenantId: 'tenant-a', authorityRevision: 1, authorityExpiresAt: NOW + 30_000 });
    const concurrent = await Promise.all([
      holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-a', envelope: { workerRequests: 4 }, now: NOW + 1 }),
      holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-b', envelope: { workerRequests: 4 }, now: NOW + 1 }),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'spent').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason === 'exhausted').length, 1);
    const replay = await holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-a', envelope: { workerRequests: 4 }, now: NOW + 2 });
    assert.equal(replay.status, 'idempotent');
    const conflict = await holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-a', envelope: { workerRequests: 1 }, now: NOW + 2 });
    assert.equal(conflict.reason, 'replay-conflict');
    assert.equal(await holder.refreshFromTrustedAuthority({ tenantId: 'tenant-a', policyRevision: 7, restrictionRevision: 3, authorityRevision: 2, authorityExpiresAt: NOW + 60_000, now: NOW + 2 }), true);
    assert.equal((await holder.inspectForTrustedRuntime())?.authorityExpiresAt, NOW + 60_000, 'holder keeps its grant expiry even when authority lease refreshes later');
    assert.equal(await holder.refreshFromTrustedAuthority({ tenantId: 'tenant-a', policyRevision: 8, restrictionRevision: 3, authorityRevision: 3, authorityExpiresAt: NOW + 60_000, now: NOW + 2 }), false, 'a current policy revision fences warm spend');
    const stored = await holder.inspectForTrustedRuntime();
    assert.equal(stored?.grant.remaining.workerRequests, 1);
    assert.equal((await holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-c', envelope: { workerRequests: 1 }, now: NOW + 2 })).status, 'spent');
    assert.equal((await holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-c', envelope: { workerRequests: 1 }, now: NOW + 2 })).status, 'idempotent',
      'a persisted receipt may acknowledge a consumed grant once without authorizing another spend');
    assert.equal((await holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-after-consumed', envelope: { workerRequests: 1 }, now: NOW + 2 })).reason, 'stale-policy');
    const stale = await holder.spendFromTrustedAuthority({ tenantId: 'tenant-a', reservationId: grant.reservationId, operationId: 'operation-after-lease', envelope: { workerRequests: 1 }, now: NOW + 60_000 });
    assert.equal(stale.reason, 'stale-policy');
  } finally { await mf?.dispose(); }
});
