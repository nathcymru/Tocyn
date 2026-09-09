import type { LocalTenantFixture } from './local-tenant-fixture';
import { validateBetaInitialization, type BetaInitialization } from '../src/types/local-beta';

/** Test/operator composition only, never exposed by an HTTP route or imported by an application. */
export async function initializeLocalBetaFixture(fixture:LocalTenantFixture,input:BetaInitialization) {
  const policy=validateBetaInitialization(input);const l=policy.limits;
  await fixture.db.batch([
    fixture.db.prepare('INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES (?,?,?,?,?)').bind(policy.runId,l.ticketLimit,l.mutationLimit,l.recoveryReserve,l.uploadLimit),
    ...policy.tenants.map(t=>fixture.db.prepare('INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES (?,?)').bind(policy.runId,t)),
    ...policy.invitations.map(i=>fixture.db.prepare('INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES (?,?,?,?)').bind(policy.runId,i.tenantId,i.kind,i.id)),
    fixture.db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES(1,?,1,'running')").bind(policy.runId),
    fixture.db.prepare("INSERT INTO local_beta_operator_receipts(revision,action,run_id,prior_run_id,prior_tickets,prior_mutations,prior_upload_attempts) VALUES(1,'initialize',?,NULL,0,0,0)").bind(policy.runId),
  ]);
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
