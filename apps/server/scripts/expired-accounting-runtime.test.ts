import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { CostPolicy, EffectiveTenantCostPolicy, ResourceAmounts } from '@luminatick/shared';
import type { TrustedBudgetCoordinatorAuthority } from '../src/budgets/owner-aggregate';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ExpiredAccountingDiagnosticDO } from './expired-accounting-runtime-entry';
import { encodeCoordinatorState } from '../src/budgets/coordinator-storage';
const NOW = Date.UTC(2026, 8, 11, 9, 0, 0);

function ownerPolicy(): CostPolicy {
  return {
    schemaVersion: 1, policyId: 'owner-policy', revision: 7, deploymentId: 'deployment-verified', mode: 'conservative', catalogueVersion: 'catalogue-1', maxGrantLifetimeMs: 60_000,
    budgets: [{ dimension: 'workerRequests', allocationId: 'owner-worker-requests', window: { kind: 'interval', id: 'month-2026-09', startsAt: NOW - 1, endsAt: NOW + 3_600_000 }, limit: 1_000_000_000, recoveryPercent: 20, provenance: 'owner-allocation' }],
  };
}

function tenantPolicy(tenantId: string): EffectiveTenantCostPolicy {
  return { ...ownerPolicy(), tenantId, restrictionRevision: 3, disabledFeatures: [], budgets: [{ ...ownerPolicy().budgets[0], limit: 1_000_000_000 }] };
}

function authority(): TrustedBudgetCoordinatorAuthority {
  return {
    aggregateId: 'server-derived-owner-aggregate', ownerPolicy: ownerPolicy(), authorityCheckedAt: NOW, authorityRevision: 1, authorityExpiresAt: NOW + 30_000, maxReservations: 4096,
    tenantAllocations: [
      { reservationNamespace: 'server-issued-reservation-a', effectivePolicy: tenantPolicy('tenant-a') },
      { reservationNamespace: 'server-issued-reservation-b', effectivePolicy: tenantPolicy('tenant-b') },
    ],
  };
}

function reserve(tenantId: string, holderId: string, idempotencyKey: string, units: number) {
  return { tenantId, holderId, idempotencyKey, expectedPolicyId: 'owner-policy', expectedPolicyRevision: 7, expectedRestrictionRevision: 3, purpose: 'new-work' as const, envelope: { workerRequests: units } satisfies ResourceAmounts, now: NOW };
}


const bundle=build({entryPoints:[resolve(import.meta.dirname,'expired-accounting-runtime-entry.ts')],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers'],write:false});
async function fixture(path?:string) {
 const result=await bundle;
 const mf=new Miniflare(convertV4MiniflareOptions({...(path?{resourcePersistencePath:path}:{}),workers:[{name:'expired-accounting',modules:true,script:result.outputFiles[0].text,durableObjects:{COORDINATOR:'ExpiredAccountingDiagnosticDO'}}]}));
 const ns=await mf.getDurableObjectNamespace('COORDINATOR') as unknown as DurableObjectNamespace;
 const coordinator=ns.get(ns.idFromName('server-derived-owner-aggregate')) as unknown as ExpiredAccountingDiagnosticDO;
 return {mf,coordinator};
}
const snapshot=async(c:ExpiredAccountingDiagnosticDO)=>JSON.parse(JSON.stringify(await c.inspectForTrustedRuntime())) as Awaited<ReturnType<ExpiredAccountingDiagnosticDO['inspectForTrustedRuntime']>>;
const count=(state:Awaited<ReturnType<ExpiredAccountingDiagnosticDO['inspectForTrustedRuntime']>>)=>state.tenantStates.flatMap(t=>t.grants).filter(g=>g.compacted&&g.status==='uncertain').length;
test('native retirement is two total per transition, read-only inspection is inert, and full charges survive restart',async()=>{
 const path=await mkdtemp(resolve(tmpdir(),'tocyn-expired-accounting-'));
 let f=await fixture(path);
 try {
  await f.coordinator.initializeFromTrustedAuthority(authority());
  for(let i=0;i<4;i++)assert.equal((await f.coordinator.reserveFromTrustedAuthority(reserve(i%2?'tenant-b':'tenant-a','holder'+i,'key'+i,1))).status,'granted');
  const now=NOW+30001, fresh={...authority(),authorityCheckedAt:now,authorityExpiresAt:now+30000};
  await f.coordinator.refreshFromTrustedAuthority(fresh);
  const first=await snapshot(f.coordinator);assert.equal(count(first),2);
  assert.deepEqual(await snapshot(f.coordinator),first);
  await f.mf.dispose();f=await fixture(path);
  assert.deepEqual(await snapshot(f.coordinator),first);
  await f.coordinator.refreshFromTrustedAuthority(fresh);
  const second=await snapshot(f.coordinator);assert.equal(count(second),4);
  assert.equal(second.tenantStates.flatMap(t=>t.closedCharges).reduce((n,c)=>n+c.units,0),4);
  await f.coordinator.refreshFromTrustedAuthority(fresh);
  assert.deepEqual(await snapshot(f.coordinator),second);
 } finally {await f.mf.dispose();await rm(path,{recursive:true,force:true});}
});
test('injected native storage rejection issues no grant and preserves original unretired full charges',async()=>{
 const f=await fixture();try {
  await f.coordinator.initializeFromTrustedAuthority(authority());
  for(let i=0;i<3;i++)assert.equal((await f.coordinator.reserveFromTrustedAuthority(reserve('tenant-a','failure'+i,'failure'+i,1))).status,'granted');
  const before=await snapshot(f.coordinator);
  const result=await f.coordinator.reserveWithFailingWrite({...reserve('tenant-a','after','after',1),now:NOW+30001});
  assert.match(result.error??'',/synthetic storage put failure/);assert.equal(result.writes,1);
  assert.equal(result.outcome,undefined);assert.deepEqual(await snapshot(f.coordinator),before);
 }finally{await f.mf.dispose();}
});
test('native rejected growth persists only bounded retired base, never the rejected new reservation',async()=>{
 const f=await fixture();try {
  await f.coordinator.initializeFromTrustedAuthority(authority());
  for(let i=0;i<6;i++)assert.equal((await f.coordinator.reserveFromTrustedAuthority(reserve('tenant-a','expired'+i,'expired'+i,1))).status,'granted');
  for(let i=0;i<512;i++){
   const response=await f.coordinator.reserveFromTrustedAuthority({...reserve('tenant-a','fill'+i+'€'.repeat(80),'fill'+i+'€'.repeat(80),1),purpose:'recovery'});
   if(response.status==='rejected'){assert.equal(response.reason,'capacity-exhausted');break;}
   assert.equal(response.status,'granted');
  }
  const now=NOW+30001;
  await f.coordinator.refreshFromTrustedAuthority({...authority(),authorityCheckedAt:now,authorityExpiresAt:now+30000});
  const before=await snapshot(f.coordinator);assert.equal(count(before),2);
  const refusedHolder='H'+'€'.repeat(159);
  const response=await f.coordinator.reserveFromTrustedAuthority({...reserve('tenant-a',refusedHolder,'K'+'€'.repeat(159),1),now});
  assert.equal(response.status,'rejected');assert.equal(response.reason,'capacity-exhausted');
  const after=await snapshot(f.coordinator);assert.equal(count(after),4);
  assert.equal(after.tenantStates[0].nextReservationSequence,before.tenantStates[0].nextReservationSequence);
  assert.equal(after.tenantStates[0].grants.some(g=>g.holderId===refusedHolder),false);
  assert.ok(new TextEncoder().encode(encodeCoordinatorState(after)).byteLength<=120*1024);
 }finally{await f.mf.dispose();}
});
