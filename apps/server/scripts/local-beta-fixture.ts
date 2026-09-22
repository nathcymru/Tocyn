import type { LocalTenantFixture } from './local-tenant-fixture';
import type { BetaInitialization } from '../src/types/local-beta';
import { initializeFreshLocalBetaPolicy } from './local-beta-d1-bootstrap';

/** Test/operator composition only, never exposed by an HTTP route or imported by an application. */
export async function initializeLocalBetaFixture(fixture:LocalTenantFixture,input:BetaInitialization) {
  await initializeFreshLocalBetaPolicy(fixture.db,input);
  fixture.enableLocalBeta();
}

export async function guardedFixture(f:LocalTenantFixture,limits:BetaInitialization['limits']={ticketLimit:2,mutationLimit:4,recoveryReserve:2,uploadLimit:2}) {
  const keys={a:await f.createScopedApiKey('operatorA',['tickets:read','tickets:write']),b:await f.createScopedApiKey('operatorB',['tickets:read','tickets:write'])};
  await initializeLocalBetaFixture(f,{
    runId:'guarded-acceptance',tenants:[f.principals.customerA.tenantId,f.principals.customerB.tenantId],limits,
    invitations:[...Object.values(f.principals).map(p=>({tenantId:p.tenantId,id:p.localId,kind:p.role==='customer'?'customer' as const:'staff' as const})),
      {tenantId:f.principals.customerA.tenantId,id:keys.a.id,kind:'api-key'},
      {tenantId:f.principals.customerB.tenantId,id:keys.b.id,kind:'api-key'}],
  });
  return keys;
}

export async function betaCounters(f:LocalTenantFixture) {
  return f.db.prepare('SELECT tickets,mutations,upload_attempts FROM local_beta_runs WHERE run_id=(SELECT run_id FROM local_beta_policy WHERE singleton=1)').first<{tickets:number;mutations:number;upload_attempts:number}>();
}
