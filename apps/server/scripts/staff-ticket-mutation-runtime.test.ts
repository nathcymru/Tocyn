import { CANONICAL_MUTATION_ATTEMPT_D1_WRITES } from '../src/budgets/canonical-mutation-envelope';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { TicketMutationReplayRepository, type MutationCandidate, type StaffReplyPrecondition } from '../src/repositories/ticket-mutation-replay.repository';
import { staffReplyPreconditionConstraint, staffReplyPreconditionMatches } from '../src/repositories/staff-reply-precondition.repository';
import { CapabilityPolicyService } from '../src/repositories/capability-policy.repository';
import { LocalBetaAdmissionRepository } from '../src/repositories/local-beta-admission.repository';
import { SessionBudgetAdmissionService } from '../src/budgets/session-admission.service';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { StaffTicketMutationService } from '../src/services/staff-ticket-mutation.service';
import { OperatorActivityRepository } from '../src/repositories/operator-activity.repository';
import { OperatorActivityService } from '../src/services/operator-activity.service';
import type { TenantRequestDeps } from '../src/middleware/tenant.middleware';
import { createRequestCanonicalMutationSli } from '../src/observability/request-canonical-mutation-sli';
import type { StaffMutationCommit,StaffMutationInput } from '../src/types/staff-ticket-mutation';
import type { AuditedTicketUpdate } from '../src/types/conversation-audit';
import type { CapabilityWriteFence } from '../src/auth/capability-policy';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

const root = resolve(import.meta.dirname,'..');
const mentionRecipientIds = Array.from({ length: 16 }, (_, index) => `2${index.toString(16).padStart(7, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);
async function fixture() {
  const bundle = await build({ absWorkingDir:root,entryPoints:['scripts/budget-coordinator-do-runtime-entry.ts'],bundle:true,write:false,
    format:'esm',platform:'neutral',external:['cloudflare:workers'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers:[{name:'staff-proof',modules:true,compatibilityDate:'2024-04-03',
    script:bundle.outputFiles[0].text,d1Databases:{DB:'staff-proof-d1'},durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'},unsafeEphemeralDurableObjects:true}] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync(join(root,'migrations')).filter(name => name.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql => db.prepare(sql)));
    }
    const now = Date.now();
    const limits = {workerRequests:1000,d1RowsRead:10_000_000,d1RowsWritten:100_000,doRequests:1000,doRowsRead:1000,doRowsWritten:1000,logEvents:100_000};
    const policy = {schemaVersion:1,policyId:'staff-policy',revision:1,deploymentId:'staff-deployment',mode:'conservative',catalogueVersion:'synthetic',maxGrantLifetimeMs:60_000,
      budgets:Object.entries(limits).map(([dimension,limit]) => ({dimension,limit,allocationId:`staff-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',window:{kind:'interval',id:'staff-window',startsAt:now-1,endsAt:now+3_600_000}}))};
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('staff-deployment',1,'active',?)").bind(now),
      db.prepare("INSERT INTO budget_owner_policies VALUES ('staff-deployment','staff-policy',1,1,'staff-aggregate',128,30000,?)").bind(JSON.stringify(policy)),
    ]);
    for (const tenant of ['a','b']) await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'staff',?,'agent',1,1)").bind(tenant,`staff-${tenant}@example.test`),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'customer',?,'customer',1,0)").bind(tenant,`customer-${tenant}@example.test`),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES (?,'group','Synthetic group')").bind(tenant),
      db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,'staff','group')").bind(tenant),
      ...mentionRecipientIds.flatMap((recipient, index) => [
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,?,?,'agent',1,1)").bind(tenant,recipient,`mentionee-${index}-${tenant}@example.test`),
        db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,?,'group')").bind(tenant,recipient),
      ]),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES (?,'ticket','Synthetic',?,'group','dashboard')").bind(tenant,`customer-${tenant}@example.test`),
      db.prepare("INSERT INTO budget_tenant_allocations VALUES ('staff-deployment',?,'staff-policy',1,1,?,?,'active')").bind(tenant,`staff-${tenant}`,JSON.stringify({schemaVersion:1,tenantId:tenant,ownerPolicyId:'staff-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]})),
      db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id,role,capability,enabled,revision) VALUES (?,'agent','ticket-fields.manage',1,1)").bind(tenant),
    ]);
    await db.batch([
      db.prepare("INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES ('staff-beta',2,4,2,2)"),
      db.prepare("INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES ('staff-beta','a')"),
      db.prepare("INSERT INTO local_beta_tenants(run_id,tenant_id) VALUES ('staff-beta','b')"),
      db.prepare("INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES ('staff-beta','a','staff','staff')"),
      db.prepare("INSERT INTO local_beta_invitations(run_id,tenant_id,principal_kind,principal_id) VALUES ('staff-beta','b','staff','staff')"),
      db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES (1,'staff-beta',1,'running')"),
    ]);
    await db.batch([
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('b','foreign','Foreign','customer-b@example.test','dashboard')"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('b','33333333-3333-4333-8333-333333333333','foreign-mentionee@example.test','agent',1,1)"),
    ]);
    const rawNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = rawNamespace.get(rawNamespace.idFromName('staff-aggregate')) as unknown as BudgetCoordinatorDO;
    const calls = {refresh:0,reserve:0};
    const namespace = { idFromName:(name:string) => rawNamespace.idFromName(name),get:() => ({
      refreshFromTrustedAuthority:async (input:Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0]) => {calls.refresh++;return coordinator.refreshFromTrustedAuthority(input);},
      reserveFromTrustedAuthority:async (input:Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0]) => {calls.reserve++;return coordinator.reserveFromTrustedAuthority(input);},
    }) } as unknown as DurableObjectNamespace;
    const admission = new SessionBudgetAdmissionService(new IsolateBudgetAdmissionCache());
    let admissionNow:number|undefined;
    let afterAuthority:(()=>Promise<void>)|undefined;
    class Authority extends BudgetAuthorityRepository {
      override async resolveForVerifiedPrincipal(...args:Parameters<BudgetAuthorityRepository['resolveForVerifiedPrincipal']>) {
        const result=await super.resolveForVerifiedPrincipal(...args);
        const action=afterAuthority;afterAuthority=undefined;if(action)await action();
        return result;
      }
    }
    let beforeCommit: (() => Promise<void>) | undefined;
    let loseResponse = false;
    let canonicalAttempts=0;
    const batches: {rowsRead:number;rowsWritten:number;statements:number}[]=[];
    const canonicalDb=new Proxy(db,{get(target,property){
      if(property==='batch')return async(statements:any[])=>{
        const results=await target.batch(statements);batches.push({statements:results.length,
          rowsRead:results.reduce((n:number,r:any)=>n+r.meta.rows_read,0),rowsWritten:results.reduce((n:number,r:any)=>n+r.meta.rows_written,0)});return results;
      };
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    }});
    class Canonical extends TicketMutationReplayRepository {
      override async commitStaff(candidate:MutationCandidate,commit:StaffMutationCommit,precondition?: StaffReplyPrecondition) {
        canonicalAttempts++;
        const action = beforeCommit;beforeCommit=undefined;if (action) await action();
        const result = await super.commitStaff(candidate,commit,precondition);
        if (loseResponse) {loseResponse=false;throw new Error('Synthetic lost committed response');}
        return result;
      }
      override async commitStaffUpdate(...args: Parameters<TicketMutationReplayRepository['commitStaffUpdate']>) {
        canonicalAttempts++;
        const action = beforeCommit; beforeCommit = undefined; if (action) await action();
        const result = await super.commitStaffUpdate(...args);
        if (loseResponse) { loseResponse = false; throw new Error('Synthetic lost committed response'); }
        return result;
      }
    }
    const scope = (tenant='a',actor='staff') => createVerifiedTenantScope(tenant,actor,[actor === 'admin' ? 'admin' : 'agent'],1);
    const credential = (tenant='a',actor='staff') => ({tenantId:tenant,actorId:actor,role:(actor === 'admin' ? 'admin' : 'agent') as 'admin' | 'agent',sessionVersion:1,expiresAt:Math.floor(Date.now()/1000)+3600,mfaVerified:true});
    const service = (tenant='a',actor='staff',capability?:CapabilityWriteFence) => {
      const activeScope=scope(tenant,actor);
      const activity = new OperatorActivityService({ scope: activeScope,
        operatorActivity: new OperatorActivityRepository(activeScope, canonicalDb) } as TenantRequestDeps);
      return new StaffTicketMutationService(db,activeScope,credential(tenant,actor),new Canonical(canonicalDb,activeScope),
        {service:admission,repository:new Authority(db,activeScope),namespace,business:{workerRequests:1,d1RowsRead:4096,d1RowsWritten:128,logEvents:136},now:()=>admissionNow??Date.now()},capability,activity);
    };
    const betaService = (tenant='a',actor='staff') => {
      const activeScope=scope(tenant,actor),activeCredential=credential(tenant,actor);
      const canonicalSli=createRequestCanonicalMutationSli();
      class BetaCanonical extends TicketMutationReplayRepository {
        override async commitStaff(candidate: MutationCandidate, commit: StaffMutationCommit, precondition?: StaffReplyPrecondition) {
          canonicalAttempts++; return super.commitStaff(candidate, commit, precondition);
        }
      }
      const canonical=new BetaCanonical(canonicalDb,activeScope,
        new LocalBetaAdmissionRepository(canonicalDb,activeScope,{kind:'staff',id:actor},{sessionVersion:activeCredential.sessionVersion,expiresAt:activeCredential.expiresAt}),canonicalSli);
      const activity = new OperatorActivityService({ scope: activeScope,
        operatorActivity: new OperatorActivityRepository(activeScope, canonicalDb) } as TenantRequestDeps);
      return {service:new StaffTicketMutationService(db,activeScope,activeCredential,canonical,
        {service:admission,repository:new Authority(db,activeScope),namespace,business:{workerRequests:1,d1RowsRead:4096,d1RowsWritten:128,logEvents:136},now:()=>admissionNow??Date.now()},undefined,activity),canonicalSli};
    };
    const counts = async () => {
      const result:Record<string,number> = {};
      for (const table of ['tickets','articles','attachments','conversation_events','sla_policies','ticket_sla_clocks','ticket_sla_events','staff_ticket_mutation_receipts','operator_activities','operator_routing_profiles']) {
        result[table] = (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{n:number}>())!.n;
      }
      return result;
    };
    const betaCounters=()=>db.prepare("SELECT tickets,mutations FROM local_beta_runs WHERE run_id='staff-beta'").first<{tickets:number;mutations:number}>();
    return {mf,db,service,betaService,betaCounters,scope,credential,calls,counts,coordinator,batches,before:(action:()=>Promise<void>) => {beforeCommit=action;},lose:() => {loseResponse=true;},
      clock:(value:number)=>{admissionNow=value;},afterAuthority:(action:()=>Promise<void>)=>{afterAuthority=action;},canonicalAttempts:()=>canonicalAttempts};
  } catch (error) {await mf.dispose();throw error;}
}
const reply = (body='Synthetic reply'):StaffMutationInput => ({operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body}});
const create = ():StaffMutationInput => ({operation:'dashboard.ticket.create',data:{subject:'Staff intake',customer_email:'CUSTOMER-A@EXAMPLE.TEST',body:'Synthetic intake',group_id:'group'}});
const update = (data: AuditedTicketUpdate = { status:'pending' }): StaffMutationInput => ({ operation:'dashboard.ticket.update',ticketId:'ticket',data });
const responsibleOwner = (ownerId:string|null,expectedOwnerId:string|null,capacityOverride=false, ticketId='ticket'):StaffMutationInput => ({ operation:'dashboard.ticket.update',ticketId,data:{
  assigned_to:ownerId,responsibleOwnerAssignment:true,expectedAssignedTo:expectedOwnerId,...(capacityOverride ? {capacityOverride:true as const} : {}),
} });
async function accept(service:StaffTicketMutationService,input:StaffMutationInput,key:string) {
  const prepared = await service.prepareStaffMutation(input,key);assert.equal(prepared.replay,null);
  assert.equal((await service.admit(prepared)).status,'spent');return {prepared,outcome:await service.commit(prepared)};
}

test('direct assignment creates activity only from its authenticated tenant-qualified canonical event', async () => {
  const f = await fixture(); try {
    const recipient = mentionRecipientIds[0];
    const first = await accept(f.service(),update({ assigned_to: recipient }),'assignment-activity');
    assert.equal(first.outcome.ticket.assigned_to,recipient);
    const activity = await f.db.prepare(`SELECT id,source_id,facts,producer_id FROM operator_activities
      WHERE tenant_id='a' AND recipient_user_id=? AND kind='assignment'`).bind(recipient).first<{
        id:string;source_id:string;facts:string;producer_id:string;
      }>();
    assert.ok(activity); assert.equal(activity.producer_id,'staff');
    const eventId = JSON.parse(activity.facts).eventId;
    assert.equal(activity.source_id,`conversation:${eventId}`);
    assert.deepEqual(await f.db.prepare(`SELECT tenant_id,ticket_id,kind,actor_id,actor_provenance,source,visibility FROM conversation_events
      WHERE id=?`).bind(eventId).first(),{
      tenant_id:'a',ticket_id:'ticket',kind:'ticket.assignment_changed',actor_id:'staff',actor_provenance:'mfa-staff',source:'dashboard',visibility:'internal',
    });

    const replay = await f.service().prepareStaffMutation(update({ assigned_to: recipient }),'assignment-activity');
    assert.equal(replay.replay?.replayed,true);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a' AND kind='assignment'").first<{n:number}>())?.n,1,
      'the canonical receipt replay cannot create a second activity');

    await accept(f.service(),update({ assigned_to: recipient }),'assignment-noop');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a' AND kind='assignment'").first<{n:number}>())?.n,1,
      'a request without a changed canonical assignment event creates no activity');

    const rejected = f.service(); const prepared = await rejected.prepareStaffMutation(update({ assigned_to:'33333333-3333-4333-8333-333333333333' }),'assignment-foreign');
    assert.equal((await rejected.admit(prepared)).status,'spent'); const before = await f.counts();
    await assert.rejects(rejected.commit(prepared),(error:any) => error.status === 503);
    assert.deepEqual(await f.counts(),before,'a same-looking recipient from another tenant cannot create activity or update the ticket');
  } finally { await f.mf.dispose(); }
});

test('responsible-owner assignment is tenant-qualified, audited, receipted, and protected against stale or revoked routing', async () => {
  const f=await fixture();try {
    await f.db.batch([
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('a','owner','owner-a@example.test','agent',1,1)"),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('a','owner','group')"),
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('a','owner-2','owner-2@example.test','agent',1,1)"),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('a','owner-2','group')"),
      // The same local identifier in another tenant must never become eligible.
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('b','foreign-owner','owner-b@example.test','agent',1,1)"),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('b','foreign-owner','group')"),
    ]);
    const first=await accept(f.service(),responsibleOwner('owner',null),'responsible-owner');
    assert.equal(first.outcome.ticket.assigned_to,'owner');
    const audit=await f.db.prepare(`SELECT kind,visibility,facts FROM conversation_events WHERE tenant_id='a' AND ticket_id='ticket'
      AND kind='ticket.assignment_changed' ORDER BY sequence`).first<{kind:string;visibility:string;facts:string}>();
    assert.equal(audit?.kind,'ticket.assignment_changed');assert.equal(audit?.visibility,'internal');
    assert.deepEqual(JSON.parse(audit!.facts),{before:{assignedTo:null,groupId:'group'},after:{assignedTo:'owner',groupId:'group'}});
    const replay=await f.service().prepareStaffMutation(responsibleOwner('owner',null),'responsible-owner');
    assert.equal(replay.replay?.replayed,true);assert.equal(replay.replay?.ticket.assigned_to,'owner');
    await assert.rejects(f.service().prepareStaffMutation(responsibleOwner(null,'owner'),'responsible-owner'),(error:any)=>error.status===409);

    const staleService=f.service();
    const stale=await staleService.prepareStaffMutation(responsibleOwner(null,null),'stale-owner');
    assert.equal((await staleService.admit(stale)).status,'spent');
    const beforeStale=await f.counts();
    await assert.rejects(staleService.commit(stale),(error:any)=>error.status===409 && error.code==='responsible_owner_conflict');
    assert.deepEqual(await f.counts(),beforeStale,'a stale transition leaves no audit, receipt, or ticket side effect');

    await assert.rejects(f.service().prepareStaffMutation(responsibleOwner('foreign-owner','owner'),'foreign-owner'),(error:any)=>error.status===403);
    const revokedService=f.service();
    const revoked=await revokedService.prepareStaffMutation(responsibleOwner('owner-2','owner'),'revoked-owner');
    assert.equal((await revokedService.admit(revoked)).status,'spent');
    const beforeRevocation=await f.counts();
    await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='a' AND user_id='owner-2' AND group_id='group'").run();
    await assert.rejects(revokedService.commit(revoked),(error:any)=>error.status===503);
    assert.deepEqual(await f.counts(),beforeRevocation,'a revoked target cannot acquire responsibility or emit an audit event');
  } finally { await f.mf.dispose(); }
});

test('responsible-owner capacity is tenant-scoped, concurrent, and overrideable only by an audited administrator', async () => {
  const f=await fixture();try {
    await f.db.batch([
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('a','owner','owner-a@example.test','agent',1,1)"),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('a','owner','group')"),
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('a','admin','admin-a@example.test','admin',1,1)"),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('a','admin','group')"),
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('a','ticket-2','Synthetic second','customer-a@example.test','group','dashboard')"),
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('a','ticket-3','Synthetic third','customer-a@example.test','group','dashboard')"),
      f.db.prepare("INSERT INTO operator_routing_profiles (tenant_id,user_id,is_available,assignment_capacity) VALUES ('a','owner',1,1)"),
    ]);
    const firstService=f.service(), secondService=f.service();
    const first=await firstService.prepareStaffMutation(responsibleOwner('owner',null,false),'capacity-first');
    const second=await secondService.prepareStaffMutation(responsibleOwner('owner',null,false,'ticket-2'),'capacity-second');
    assert.equal((await firstService.admit(first)).status,'spent');
    assert.equal((await secondService.admit(second)).status,'spent');
    const simultaneous=await Promise.allSettled([firstService.commit(first),secondService.commit(second)]);
    assert.equal(simultaneous.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(simultaneous.filter(result=>result.status==='rejected' && (result.reason as any).status===409
      && (result.reason as any).code==='responsible_owner_capacity_reached').length,1);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM tickets WHERE tenant_id='a' AND assigned_to='owner'").first<{n:number}>())?.n,1);

    await assert.rejects(f.service().prepareStaffMutation(responsibleOwner('owner',null,true,'ticket-2'),'agent-override'),(error:any)=>error.status===403);
    const admin=f.service('a','admin');
    const overridden=await accept(admin,responsibleOwner('owner',null,true,'ticket-2'),'admin-override');
    assert.equal(overridden.outcome.ticket.assigned_to,'owner');
    const overrideAudit=await f.db.prepare(`SELECT facts FROM conversation_events WHERE tenant_id='a' AND ticket_id='ticket-2'
      AND kind='ticket.assignment_changed' ORDER BY sequence DESC LIMIT 1`).first<{facts:string}>();
    assert.equal(JSON.parse(overrideAudit!.facts).capacityOverride,1);

    await f.db.prepare("UPDATE operator_routing_profiles SET is_available=0 WHERE tenant_id='a' AND user_id='owner'").run();
    await assert.rejects(f.service('a','admin').prepareStaffMutation(responsibleOwner('owner',null,true,'ticket-3'),'unavailable-owner'),(error:any)=>error.status===409 && error.code==='responsible_owner_unavailable');
  } finally { await f.mf.dispose(); }
});

test('staff identity, response contracts, atomic receipts, warm zero-DO admission, current authorized replay and tenant isolation', async () => {
  const f=await fixture();try {
    const s=f.service();const initial=await accept(s,create(),'create');
    assert.equal(initial.outcome.ticket.source,'dashboard');assert.equal(initial.outcome.ticket.customer_id,'customer');
    assert.equal(initial.outcome.article.sender_type,'customer');assert.equal(initial.outcome.article.sender_id,'customer');
    assert.equal(initial.outcome.body.id,initial.outcome.ticket.id);
    const first=await accept(s,reply(),'one');const cold={...f.calls};
    const second=await accept(s,reply('Second'),'two');assert.deepEqual(f.calls,cold);
    assert.equal(first.outcome.article.sender_id,'staff');assert.equal(first.outcome.article.sender_type,'agent');
    assert.equal(second.outcome.article.is_internal,false);assert.deepEqual(second.outcome.body.attachments,[]);
    const before=await f.counts();const replayed=await s.prepareStaffMutation(reply(),'one');
    assert.equal(replayed.replay?.replayed,true);assert.deepEqual(replayed.replay?.body,first.outcome.body);
    assert.equal((await s.admit(replayed)).status,'replayed');assert.deepEqual(f.calls,cold);assert.deepEqual(await f.counts(),before);
    await assert.rejects(s.prepareStaffMutation(reply('Changed'),'one'),(error:any) => error.status===409);
    await accept(f.service('b'),reply(),'one');
    await assert.rejects(s.prepareStaffMutation({...reply(),ticketId:'foreign'} as StaffMutationInput,'foreign'));
    const audit=await f.db.prepare("SELECT actor_kind,actor_id,actor_provenance,source FROM conversation_events WHERE tenant_id='a' AND article_id=?").bind(first.outcome.article.id).first();
    assert.deepEqual(audit,{actor_kind:'staff',actor_id:'staff',actor_provenance:'mfa-staff',source:'dashboard'});
    await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='a' AND user_id='staff'").run();
    await assert.rejects(s.prepareStaffMutation(reply(),'one'));
  } finally {await f.mf.dispose();}
});

test('same-key concurrency and lost committed response return one canonical mutation', async () => {
  const f=await fixture();try {
    // Isolate simultaneous canonical collision from the separately tested
    // monotonic-authority rejection of older reads completing out of order.
    f.clock(Date.now());
    const s=f.service();const a=await s.prepareStaffMutation(reply(),'race'),b=await s.prepareStaffMutation(reply(),'race');
    const results=await Promise.all([s.admit(a),s.admit(b)]);assert.deepEqual(results.map(r=>r.status).sort(),['idempotent','spent'],
      JSON.stringify(results.map(r=>({status:r.status,reason:'reason' in r?r.reason:undefined}))));
    const outcomes=await Promise.all([s.commit(a),s.commit(b)]);assert.equal(outcomes[0].article.id,outcomes[1].article.id);
    assert.deepEqual(outcomes.map(o=>o.replayed).sort(),[false,true]);
    const before=await f.counts();f.lose();const lost=await accept(s,reply('Lost response'),'lost');
    assert.equal(lost.outcome.replayed,true);assert.equal((await f.counts()).articles,before.articles+1);
    assert.equal((await s.prepareStaffMutation(reply('Lost response'),'lost')).replay?.article.id,lost.outcome.article.id);
  } finally {await f.mf.dispose();}
});

test('staff update preserves the dashboard success contract with an atomic v2 receipt, no-op evidence, and replay conflict', async () => {
  const f = await fixture(); try {
    const s = f.service();
    const first = await accept(s,update({ status:'pending',priority:'urgent',assigned_to:null,group_id:'group',custom_fields:{ long:'x'.repeat(60_000),flag:true } }),'update-retry');
    assert.equal(first.outcome.status,200); assert.deepEqual(first.outcome.body,{success:true});
    assert.equal(first.outcome.ticket.status,'pending'); assert.equal(first.outcome.ticket.priority,'urgent');
    const receipt = await f.db.prepare(`SELECT response_version,response_status,result_article_id,response_snapshot FROM staff_ticket_mutation_receipts
      WHERE tenant_id='a' AND principal_id='staff' AND operation='dashboard.ticket.update'`).first<{response_version:number;response_status:number;result_article_id:string|null;response_snapshot:string}>();
    assert.deepEqual({ version:receipt?.response_version,status:receipt?.response_status,article:receipt?.result_article_id },{version:2,status:200,article:null});
    assert.equal(JSON.parse(receipt!.response_snapshot).staffVersion,2);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND ticket_id='ticket'").first<{n:number}>())?.n,1);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM articles WHERE tenant_id='a' AND ticket_id='ticket' AND sender_type='system'").first<{n:number}>())?.n,2,
      'state and custom-field changes retain their ordinary dashboard notes');
    const replay = await s.prepareStaffMutation(update({ status:'pending',priority:'urgent',assigned_to:null,group_id:'group',custom_fields:{flag:true,long:'x'.repeat(60_000)} }),'update-retry');
    assert.equal(replay.replay?.replayed,true); assert.deepEqual(replay.replay?.body,{success:true});
    await assert.rejects(s.prepareStaffMutation(update({status:'resolved'}),'update-retry'),(error:any)=>error.status===409&&error.code==='idempotency_conflict');

    const before = await f.counts();
    const noOp = await accept(s,update({status:'pending'}),'update-noop');
    assert.equal(noOp.outcome.status,200); assert.equal((await f.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND ticket_id='ticket'").first<{n:number}>())?.n,1);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM staff_ticket_mutation_receipts WHERE tenant_id='a' AND operation='dashboard.ticket.update'").first<{n:number}>())?.n,2);
    assert.equal((await f.counts()).tickets,before.tickets,'a no-op commits only its durable receipt and leaves ticket data unchanged');
  } finally { await f.mf.dispose(); }
});

test('staff update concurrent winner, lost response recovery, and tenant/group fences retain one ticket mutation', async () => {
  const f = await fixture(); try {
    f.clock(Date.now());
    const s = f.service(); const input = update({status:'pending'});
    const [left,right] = await Promise.all([s.prepareStaffMutation(input,'update-race'),s.prepareStaffMutation(input,'update-race')]);
    const admissions = await Promise.all([s.admit(left),s.admit(right)]);
    assert.deepEqual(admissions.map(value=>value.status).sort(),['idempotent','spent'],JSON.stringify(admissions));
    const results = await Promise.all([s.commit(left),s.commit(right)]);
    assert.deepEqual(results.map(result=>result.body),[{success:true},{success:true}]); assert.deepEqual(results.map(result=>result.replayed).sort(),[false,true]);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM staff_ticket_mutation_receipts WHERE tenant_id='a' AND operation='dashboard.ticket.update'").first<{n:number}>())?.n,1);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND ticket_id='ticket'").first<{n:number}>())?.n,1);
    f.lose(); const lost = await accept(s,update({priority:'high'}),'update-lost'); assert.equal(lost.outcome.replayed,true);
    assert.equal((await s.prepareStaffMutation(update({priority:'high'}),'update-lost')).replay?.replayed,true);
    await assert.rejects(s.prepareStaffMutation({operation:'dashboard.ticket.update',ticketId:'foreign',data:{status:'resolved'}},'cross-tenant'),(error:any)=>error.status===403);
    const fenced = await s.prepareStaffMutation(update({status:'resolved'}),'group-revoked'); assert.equal((await s.admit(fenced)).status,'spent'); const before=await f.counts();
    f.before(async()=>{ await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='a' AND user_id='staff' AND group_id='group'").run(); });
    await assert.rejects(s.commit(fenced),(error:any)=>error.status===403); assert.deepEqual(await f.counts(),before);
  } finally { await f.mf.dispose(); }
});

test('staff update receipt cleanup and maximal field projection remain within the admitted canonical envelope', async () => {
  const f = await fixture(); try {
    const s = f.service(); await accept(s,update({status:'pending'}),'update-cleanup-seed');
    await f.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<150)
      INSERT INTO staff_ticket_mutation_receipts (tenant_id,principal_id,operation,key_hash,payload_hash,fingerprint_version,response_version,result_ticket_id,result_article_id,response_status,response_snapshot,created_at,expires_at)
      SELECT tenant_id,principal_id,operation,printf('%064d',x),payload_hash,1,2,result_ticket_id,NULL,200,response_snapshot,unixepoch()-100,unixepoch()-1
      FROM staff_ticket_mutation_receipts,n WHERE tenant_id='a' AND principal_id='staff' AND operation='dashboard.ticket.update' LIMIT 150`).run();
    const result = await accept(s,update({status:'resolved',priority:'urgent',assigned_to:null,group_id:'group',custom_fields:{payload:'x'.repeat(60_000),first:true,second:42,third:null}}),'update-envelope');
    const measured = f.batches.at(-1)!;
    console.log(JSON.stringify({fixture:'native-d1-staff-update-envelope',measured}));
    assert.equal(result.outcome.status,200); assert.ok(measured.rowsWritten>100,'the exact 99-row bounded cleanup is exercised');
    assert.ok(measured.rowsWritten<=CANONICAL_MUTATION_ATTEMPT_D1_WRITES);
    assert.ok(measured.rowsRead<=2_570);
  } finally { await f.mf.dispose(); }
});

test('0046 preserves legacy staff receipt bytes and permits only the dashboard update v2 shape', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers:[{name:'staff-update-migration',modules:true,compatibilityDate:'2024-04-03',
    script:'export default { fetch() { return new Response("migration") } }',d1Databases:{DB:'staff-update-migration-d1'} }] }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync(join(root,'migrations')).filter(name => name.endsWith('.sql') && name < '0046_staff_ticket_update_receipts.sql').sort()) {
      await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql => db.prepare(sql)));
    }
    const legacy = JSON.stringify({staffVersion:1,staffBodyFormat:'plain',ticket:{id:'ticket'},article:{id:'article',body_format:'plain'},attachments:[]});
    await db.prepare(`INSERT INTO staff_ticket_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,result_ticket_id,result_article_id,response_snapshot)
      VALUES ('a','staff','dashboard.ticket.reply',printf('%064d',1),printf('%064d',2),'ticket','article',?)`).bind(legacy).run();
    await db.batch(splitSql(readFileSync(join(root,'migrations','0046_staff_ticket_update_receipts.sql'),'utf8')).map(sql => db.prepare(sql)));
    assert.equal((await db.prepare("SELECT response_snapshot FROM staff_ticket_mutation_receipts WHERE tenant_id='a'").first<{response_snapshot:string}>())?.response_snapshot,legacy);
    const update = JSON.stringify({staffVersion:2,ticket:{id:'ticket'}});
    await db.prepare(`INSERT INTO staff_ticket_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_version,result_ticket_id,response_status,response_snapshot)
      VALUES ('a','staff','dashboard.ticket.update',printf('%064d',3),printf('%064d',4),2,'ticket',200,?)`).bind(update).run();
    await assert.rejects(db.prepare(`INSERT INTO staff_ticket_mutation_receipts
      (tenant_id,principal_id,operation,key_hash,payload_hash,response_version,result_ticket_id,response_status,response_snapshot)
      VALUES ('a','staff','dashboard.ticket.reply',printf('%064d',5),printf('%064d',6),2,'ticket',200,?)`).bind(update).run());
  } finally { await mf.dispose(); }
});

test('delayed older staff authority is rejected and a fresh bounded retry recovers behind one canonical receipt',async()=>{
  const f=await fixture();try{
    const s=f.service();await accept(s,reply('Warm'),'warm-ordering');
    const older=await s.prepareStaffMutation(reply(),'ordered'),newer=await s.prepareStaffMutation(reply(),'ordered');
    let release!:()=>void,observed!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),read=new Promise<void>(resolve=>{observed=resolve;});
    f.afterAuthority(async()=>{observed();await gate;});
    const delayed=s.admit(older);await read;
    // Advance the actual clock so this later current-authority read has a
    // strictly newer timestamp, then deliver the older completed D1 snapshot.
    await new Promise(resolve=>setTimeout(resolve,5));
    const current=await s.admit(newer);assert.equal(current.status,'spent');
    release();const stale=await delayed;assert.equal(stale.status,'rejected');assert.equal('reason' in stale?stale.reason:undefined,'stale-policy');
    const calls={...f.calls},before=f.batches.length,attempts=f.canonicalAttempts();
    const retried=await s.admit(older);assert.equal(retried.status,'idempotent');
    const third=await s.prepareStaffMutation(reply(),'ordered');const exhausted=await s.admit(third);
    assert.equal(exhausted.status,'rejected');assert.equal('reason' in exhausted?exhausted.reason:undefined,'replay-exhausted');
    const outcomes=await Promise.all([s.commit(older),s.commit(newer)]);
    assert.equal(outcomes[0].article.id,outcomes[1].article.id);assert.deepEqual(outcomes.map(o=>o.replayed).sort(),[false,true]);
    assert.equal(f.batches.length-before,1,'only the winning batch commits');
    assert.ok(f.canonicalAttempts()-attempts<=2,'one charged operation permits at most two canonical attempts');
    assert.equal((await s.prepareStaffMutation(reply(),'ordered')).replay?.article.id,outcomes[0].article.id);
    assert.deepEqual(f.calls,calls,'fresh retry and durable replay require no extra charged grant');
  }finally{await f.mf.dispose();}
});

for (const [name,sql] of [
  ['session',"UPDATE users SET session_version=2 WHERE tenant_id='a' AND id='staff'"],
  ['role',"UPDATE users SET role='customer' WHERE tenant_id='a' AND id='staff'"],
  ['MFA',"UPDATE users SET mfa_enabled=0 WHERE tenant_id='a' AND id='staff'"],
  ['membership',"DELETE FROM user_groups WHERE tenant_id='a' AND user_id='staff'"],
  ['group',"UPDATE tickets SET group_id=NULL WHERE tenant_id='a' AND id='ticket'"],
  ['authority',"UPDATE budget_deployment_authority SET state='revoked'"],
  ['policy',"UPDATE budget_owner_policies SET policy_json=json_set(policy_json,'$.budgets[0].limit',999)"],
  ['window',"UPDATE budget_owner_policies SET policy_json=json_set(policy_json,'$.budgets[0].window.id','changed')"],
  ['restriction',"UPDATE budget_tenant_allocations SET restriction_json=json_set(restriction_json,'$.disabledFeatures',json('[\"changed\"]')) WHERE tenant_id='a'"],
] as const) test(`atomic staff fence rejects ${name} change after admission without canonical side effects`,async()=>{
  const f=await fixture();try{
    const s=f.service();const p=await s.prepareStaffMutation(reply(),'changed');assert.equal((await s.admit(p)).status,'spent');
    const before=await f.counts();f.before(async()=>{await f.db.prepare(sql).run();});
    await assert.rejects(s.commit(p));assert.deepEqual(await f.counts(),before);
  }finally{await f.mf.dispose();}
});

test('optional existing capability and actual grant expiry are fenced inside the staff transaction',async()=>{
  const f=await fixture();try{
    const scope=f.scope();
    await f.db.prepare("INSERT INTO tenant_group_capability_constraints (tenant_id,group_id,capability,enabled,revision) VALUES ('a','group','ticket-fields.manage',1,2)").run();
    const principal={tenantId:'a',actorId:'staff',role:'agent' as const,sessionVersion:1};
    const decision=await new CapabilityPolicyService(f.db,scope).authorize(principal,'ticket-fields.manage');assert.equal(decision.allowed,true);
    const s=f.service('a','staff',{...principal,capability:decision.capability,policyFingerprint:decision.policyFingerprint});
    await accept(s,reply('Capability baseline'),'cap-positive');
    const p=await s.prepareStaffMutation(reply(),'cap');assert.equal((await s.admit(p)).status,'spent');
    const before=await f.counts();f.before(async()=>{await f.db.prepare("UPDATE deployment_capability_ceiling SET enabled=0 WHERE capability='ticket-fields.manage'").run();});
    await assert.rejects(s.commit(p));assert.deepEqual(await f.counts(),before);
    await f.db.prepare("UPDATE deployment_capability_ceiling SET enabled=1 WHERE capability='ticket-fields.manage'").run();
    await f.db.prepare('UPDATE budget_owner_policies SET authority_max_age_ms=1000').run();
    const exp=f.service();const prepared=await exp.prepareStaffMutation(reply(),'expiry');const result=await exp.admit(prepared);assert.equal(result.status,'spent');
    f.before(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
    await assert.rejects(exp.commit(prepared));assert.deepEqual(await f.counts(),before);
  }finally{await f.mf.dispose();}
});

test('attachment intent, immutable preparation, deletion redaction and snapshot cap retain bounded retry then receipt replay',async()=>{
  const f=await fixture();try{
    const s=f.service();const input:StaffMutationInput={operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'Attachment',is_internal:true,attachments:[{storageKey:'agent-attachments/staff/file',filename:'file.txt'}]}};
    const p=await s.prepareStaffMutation(input,'attachment');input.data.body='Mutated';assert.equal((await s.admit(p)).status,'spent');
    await assert.rejects(s.commit(p,[{storageKey:'agent-attachments/staff/other',filename:'file.txt',size:4,contentType:'text/plain'}]));
    const result=await s.commit(p,[{storageKey:'agent-attachments/staff/file',filename:'file.txt',size:4,contentType:'text/plain'}]);
    assert.equal(result.article.body,'Attachment');assert.equal(result.article.is_internal,true);assert.equal(result.attachments.length,1);
    await f.db.prepare('DELETE FROM attachments WHERE tenant_id=? AND id=?').bind('a',result.attachments[0].id).run();
    await assert.rejects(s.prepareStaffMutation({...input,data:{...input.data,body:'Attachment'}},'attachment'),(error:any)=>error.status===410);
    const row=await f.db.prepare("SELECT response_snapshot,lifecycle FROM staff_ticket_mutation_receipts WHERE tenant_id='a'").first();assert.deepEqual(row,{response_snapshot:null,lifecycle:'gone'});
    const huge=await s.prepareStaffMutation(reply(),'huge');assert.equal((await s.admit(huge)).status,'spent');
    await f.db.prepare("UPDATE tickets SET custom_fields=? WHERE tenant_id='a' AND id='ticket'").bind('x'.repeat(262144)).run();
    const before=await f.counts();await assert.rejects(s.commit(huge));assert.deepEqual(await f.counts(),before);
    await f.db.prepare("UPDATE tickets SET custom_fields=NULL WHERE tenant_id='a' AND id='ticket'").run();
    const retry=await s.prepareStaffMutation(reply(),'huge');assert.equal(retry.replay,null);assert.equal((await s.admit(retry)).status,'idempotent');
    const committed=await s.commit(retry);assert.equal(committed.replayed,false);
    const replay=await s.prepareStaffMutation(reply(),'huge');assert.equal(replay.replay?.replayed,true);assert.equal(replay.replay?.article.id,committed.article.id);
  }finally{await f.mf.dispose();}
});

test('two tenants persist shared article formats, reject unknown formats, and replay the canonical format without a second batch',async()=>{
  const f=await fixture();try{
    const markdownCreate:StaffMutationInput={operation:'dashboard.ticket.create',data:{subject:'Markdown intake',customer_email:'customer-a@example.test',body:'# Markdown intake',bodyFormat:'markdown-v1',group_id:'group'}};
    const created=await accept(f.service('a'),markdownCreate,'format-create');assert.equal(created.outcome.article.body_format,'markdown-v1');
    const createdStored=await f.db.prepare("SELECT body_format FROM articles WHERE tenant_id='a' AND id=?").bind(created.outcome.article.id).first();
    assert.deepEqual(createdStored,{body_format:'markdown-v1'});
    const markdown:StaffMutationInput={operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'# Markdown',bodyFormat:'markdown-v1'}};
    const first=await accept(f.service('a'),markdown,'format-key');
    assert.equal(first.outcome.article.body_format,'markdown-v1');
    const stored=await f.db.prepare("SELECT body_format FROM articles WHERE tenant_id='a' AND id=?").bind(first.outcome.article.id).first();
    assert.deepEqual(stored,{body_format:'markdown-v1'});
    const receipt=await f.db.prepare("SELECT response_snapshot FROM staff_ticket_mutation_receipts WHERE tenant_id='a' AND principal_id='staff' AND operation='dashboard.ticket.reply'").first<{response_snapshot:string}>();
    const snapshot=JSON.parse(receipt!.response_snapshot);assert.equal(snapshot.staffBodyFormat,'markdown-v1');assert.equal(snapshot.article.body_format,'markdown-v1');
    const batches=f.batches.length;const replay=await f.service('a').prepareStaffMutation(markdown,'format-key');
    assert.equal(replay.replay?.replayed,true);assert.equal(replay.replay?.article.body_format,'markdown-v1');assert.equal(f.batches.length,batches);
    await assert.rejects(f.service('a').prepareStaffMutation({...markdown,data:{...markdown.data,bodyFormat:'plain'}},'format-key'),(error:any)=>error.status===409);
    const plain:StaffMutationInput={operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'Plain',bodyFormat:'plain'}};
    const other=await accept(f.service('b'),plain,'format-key');assert.equal(other.outcome.article.body_format,'plain');assert.notEqual(other.outcome.article.id,first.outcome.article.id);
    await assert.rejects(f.service('a').prepareStaffMutation({operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'Unknown',bodyFormat:'markdown-v2' as unknown as 'plain'}},'unknown-format'),(error:any)=>error.code==='unsupported_article_format');
  }finally{await f.mf.dispose();}
});

test('staff bodies use the current 16000-character and byte format boundary before canonical admission',async()=>{
  const f=await fixture();try{
    const s=f.service();
    const unicode='é'.repeat(8_000);
    const accepted=await accept(s,{operation:'dashboard.ticket.create',data:{subject:'Unicode boundary',customer_email:'customer-a@example.test',body:unicode,bodyFormat:'markdown-v1',group_id:'group'}},'unicode-boundary');
    assert.equal(accepted.outcome.article.body,unicode);assert.equal(accepted.outcome.article.body_format,'markdown-v1');
    const before={calls:{...f.calls},counts:await f.counts(),attempts:f.canonicalAttempts()};
    const invalidBodies:StaffMutationInput[]=[
      {operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'a'.repeat(16_001),bodyFormat:'markdown-v1'}},
      {operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'é'.repeat(8_001),bodyFormat:'markdown-v1'}},
      {operation:'dashboard.ticket.create',data:{subject:'Too long',customer_email:'customer-a@example.test',body:'a'.repeat(16_001),bodyFormat:'markdown-v1',group_id:'group'}},
    ];
    for (const input of invalidBodies) await assert.rejects(s.prepareStaffMutation(input,crypto.randomUUID()),(error:any)=>error.code==='invalid_mutation');
    assert.deepEqual(f.calls,before.calls,'oversize bodies do not reserve session budget capacity');
    assert.equal(f.canonicalAttempts(),before.attempts,'oversize bodies never reach the canonical batch');
    assert.deepEqual(await f.counts(),before.counts,'oversize bodies do not write tickets, articles, audit, SLA, or receipts');
  }finally{await f.mf.dispose();}
});

test('actual #93 beta admission rolls back the entire staff canonical batch on exhaustion and completed receipt replay is quota-free',async()=>{
  const f=await fixture();try{
    const beta=f.betaService();
    const first=await accept(beta.service,reply('Beta receipt'),'beta-replay');
    assert.equal((await f.betaCounters())?.mutations,1);
    assert.deepEqual(beta.canonicalSli.snapshot().counts,{attempted:1,durablyCompleted:1,replayed:0,noOp:0,denied:0,uncertain:0});
    await f.db.prepare("UPDATE local_beta_runs SET mutations=mutation_limit WHERE run_id='staff-beta'").run();
    const replay=await beta.service.prepareStaffMutation(reply('Beta receipt'),'beta-replay');
    assert.equal(replay.replay?.replayed,true);assert.equal(replay.replay?.article.id,first.outcome.article.id);
    assert.deepEqual(await f.betaCounters(),{tickets:0,mutations:4},'completed receipt replay does not increment the exhausted beta quota');

    const blocked=f.betaService();const prepared=await blocked.service.prepareStaffMutation(reply('Quota exhausted'),'beta-exhausted');
    assert.equal((await blocked.service.admit(prepared)).status,'spent');const before=await f.counts();
    await assert.rejects(blocked.service.commit(prepared));
    assert.deepEqual(await f.counts(),before,'beta assertion failure rolls back article, audit, SLA, and staff receipt writes together');
    assert.deepEqual(await f.betaCounters(),{tickets:0,mutations:4});
  }finally{await f.mf.dispose();}
});


test('receipt expiry cleanup is indexed and bounded to the current tenant and staff actor',async()=>{
  const f=await fixture();try{
    const s=f.service();await accept(s,reply(),'seed');
    for (const [tenant,actor] of [['a','staff'],['a','other'],['b','staff']]) {
      await f.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<150)
        INSERT INTO staff_ticket_mutation_receipts (tenant_id,principal_id,operation,key_hash,payload_hash,
          result_ticket_id,result_article_id,response_snapshot,created_at,expires_at)
        SELECT ?,?,operation,printf('%064d',x),payload_hash,result_ticket_id,result_article_id,response_snapshot,
          unixepoch()-100,unixepoch()-1 FROM staff_ticket_mutation_receipts,n
        WHERE tenant_id='a' AND principal_id='staff' AND key_hash=(SELECT key_hash FROM staff_ticket_mutation_receipts WHERE tenant_id='a' AND principal_id='staff' LIMIT 1)`)
        .bind(tenant,actor).run();
    }
    const plan=await f.db.prepare(`EXPLAIN QUERY PLAN SELECT rowid FROM staff_ticket_mutation_receipts
      WHERE tenant_id=? AND principal_id=? AND expires_at<=unixepoch() ORDER BY expires_at LIMIT 99`).bind('a','staff').all();
    const details=plan.results.map((row:{detail:unknown})=>String(row.detail)).join(' ');
    assert.match(details,/SEARCH.*idx_staff_mutation_receipts_expiry/);assert.doesNotMatch(details,/SCAN|TEMP B-TREE/);
    await accept(s,reply('Cleanup'),'cleanup');
    const rows=await f.db.prepare(`SELECT tenant_id,principal_id,count(*) AS n FROM staff_ticket_mutation_receipts
      WHERE expires_at<=unixepoch() GROUP BY tenant_id,principal_id ORDER BY tenant_id,principal_id`).all();
    assert.deepEqual(rows.results,[{tenant_id:'a',principal_id:'other',n:150},{tenant_id:'a',principal_id:'staff',n:51},{tenant_id:'b',principal_id:'staff',n:150}]);
    const active=await f.db.prepare(`SELECT expires_at-created_at AS lifetime FROM staff_ticket_mutation_receipts WHERE expires_at>unixepoch()`).all();
    assert.ok(active.results.every((row:{lifetime:unknown})=>row.lifetime===86400));
  }finally{await f.mf.dispose();}
});


test('actor-qualified keys do not replay another staff member and the optional capability gate rejects a 65th membership atomically',async()=>{
  const f=await fixture();try{
    await f.db.batch([
      f.db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('a','other','other@example.test','agent',1,1)"),
      f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES ('a','other','group')"),
    ]);
    const first=await accept(f.service(),reply(),'same-key');
    const other=await accept(f.service('a','other'),reply(),'same-key');assert.notEqual(first.outcome.article.id,other.outcome.article.id);
    const principal={tenantId:'a',actorId:'staff',role:'agent' as const,sessionVersion:1};
    const decision=await new CapabilityPolicyService(f.db,f.scope()).authorize(principal,'ticket-fields.manage');
    const s=f.service('a','staff',{...principal,capability:decision.capability,policyFingerprint:decision.policyFingerprint});
    const p=await s.prepareStaffMutation(reply('Membership sentinel'),'sentinel');assert.equal((await s.admit(p)).status,'spent');
    const before=await f.counts();
    f.before(async()=>{
      for(let i=0;i<64;i++) await f.db.batch([
        f.db.prepare('INSERT INTO groups (tenant_id,id,name) VALUES (?,?,?)').bind('a',`extra-${i}`,'Synthetic'),
        f.db.prepare("INSERT INTO user_groups (tenant_id,user_id,group_id) VALUES (?,'staff',?)").bind('a',`extra-${i}`),
      ]);
    });
    await assert.rejects(s.commit(p));assert.deepEqual(await f.counts(),before);
  }finally{await f.mf.dispose();}
});


test('unadmitted and foreign prepared tokens cannot commit, and an unkeyed token can commit only once',async()=>{
  const f=await fixture();try{
    const s=f.service();const p=await s.prepareStaffMutation(reply());const before=await f.counts();
    await assert.rejects(s.commit(p));await assert.rejects(f.service().commit(p));
    await assert.rejects(s.commit(Object.freeze({replay:null})));assert.deepEqual(await f.counts(),before);
    assert.equal((await s.admit(p)).status,'spent');
    const results=await Promise.allSettled([s.commit(p),s.commit(p)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal((await f.counts()).articles,before.articles+1);
    const denied=await s.prepareStaffMutation(reply('No allocation'),'no-allocation');
    await f.db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='a'").run();
    assert.equal((await s.admit(denied)).status,'rejected');
    const after=await f.counts();await assert.rejects(s.commit(denied));assert.deepEqual(await f.counts(),after);
  }finally{await f.mf.dispose();}
});

test('a failed staff batch requires fresh bounded admission, and exhausted admission cannot retain an old commit fence',async()=>{
  const f=await fixture();try{
    const s=f.service();const p=await s.prepareStaffMutation(reply(),'retry');assert.equal((await s.admit(p)).status,'spent');
    const before=await f.counts();f.before(async()=>{throw new Error('Synthetic preparation interruption');});
    await assert.rejects(s.commit(p));await assert.rejects(s.commit(p));assert.deepEqual(await f.counts(),before);
    const retry=await s.prepareStaffMutation(reply(),'retry');assert.equal((await s.admit(retry)).status,'idempotent');
    assert.equal((await s.commit(retry)).replayed,false);
    const exhausted=await s.prepareStaffMutation(reply('Exhaust attempts'),'exhausted');
    assert.equal((await s.admit(exhausted)).status,'spent');assert.equal((await s.admit(exhausted)).status,'idempotent');
    assert.equal((await s.admit(exhausted)).status,'rejected');
    const after=await f.counts();await assert.rejects(s.commit(exhausted));assert.deepEqual(await f.counts(),after);
  }finally{await f.mf.dispose();}
});


test('native staff metadata includes 100-receipt cleanup, ten attachments, audit, first-response SLA and assertion writes',async()=>{
  const f=await fixture();try{
    const s=f.service();await accept(s,{operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'Internal seed',is_internal:true}},'metadata-seed');
    const key='metadata-ten',hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))).toString('hex');
    await f.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<150)
      INSERT INTO staff_ticket_mutation_receipts (tenant_id,principal_id,operation,key_hash,payload_hash,result_ticket_id,result_article_id,response_snapshot,created_at,expires_at)
      SELECT tenant_id,principal_id,operation,CASE WHEN x=1 THEN ? ELSE printf('%064d',x) END,payload_hash,result_ticket_id,result_article_id,response_snapshot,
        unixepoch()-100,unixepoch()-1 FROM staff_ticket_mutation_receipts,n WHERE tenant_id='a' AND principal_id='staff'`).bind(hash).run();
    const attachments=Array.from({length:10},(_,index)=>({storageKey:`agent-attachments/staff/${index}`,filename:`${index}.txt`,size:10*1024*1024,contentType:'text/plain'}));
    const p=await s.prepareStaffMutation({operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'First public response',attachments}},key);
    assert.equal((await s.admit(p)).status,'spent');const result=await s.commit(p,attachments);assert.equal(result.attachments.length,10);
    const measured=f.batches.at(-1)!;console.log(JSON.stringify({fixture:'native-d1-canonical-metadata',operation:'staff-reply-ten-attachments',...measured}));
    assert.ok(measured.rowsWritten>100);assert.ok(measured.rowsRead>0);assert.ok(measured.rowsWritten<=CANONICAL_MUTATION_ATTEMPT_D1_WRITES);
    const inventory:Record<string,number>={}; const conversationEventIndexes = [
      'idx_conversation_events_article', 'idx_conversation_events_operational_metric_projection',
      'idx_conversation_events_staff_reply_precondition', 'idx_conversation_events_ticket_article_kind',
      'idx_conversation_events_ticket_kind_visibility_sequence', 'sqlite_autoindex_conversation_events_1',
      'sqlite_autoindex_conversation_events_2',
    ].sort();
    for(const table of ['tickets','articles','attachments','conversation_events','sla_policies','ticket_sla_clocks','ticket_sla_events','support_state_definitions','ticket_support_state','budget_mutation_assertion','local_beta_assertion','local_beta_runs','ticket_mutation_receipts','staff_ticket_mutation_receipts']) {
      const indexes=await f.db.prepare(`PRAGMA index_list(${table})`).all();inventory[table]=indexes.results.length;
      if (table === 'conversation_events') assert.deepEqual(indexes.results.map((index: { name: string }) => index.name).sort(), conversationEventIndexes,
        'The accepted staff and bounded-detail event indexes are accounted for');
      else if (table === 'tickets') {
        const names = indexes.results.map((index: {name:string}) => index.name);
        assert.deepEqual(names.sort(),['idx_tickets_list_tenant_created_id','idx_tickets_list_tenant_updated_id','idx_tickets_operational_metric_projection','idx_tickets_retention_cursor','idx_tickets_tenant_customer_created','idx_tickets_tenant_group','sqlite_autoindex_tickets_1']);
        console.log(JSON.stringify({fixture:'reviewed-ticket-indexes',names:names.sort()}));
        assert.equal(indexes.results.length,7,'Ticket list, retention and group indexes are included in the native measured write bound');
      } else if(table==='articles') {
        assert.deepEqual(indexes.results.map((index:{name:string})=>index.name).sort(),
          ['idx_articles_retention_cursor','idx_articles_tenant_ticket_recent','idx_articles_tenant_ticket_visibility_created_id','idx_articles_ticket','sqlite_autoindex_articles_1']);
      } else if (table === 'ticket_support_state') {
        // Shared snooze adds one tenant-qualified lookup index. Keep the
        // allowance explicit so future index growth still fails closed.
        assert.deepEqual(indexes.results.map((index: {name:string}) => index.name).sort(), [
          'idx_ticket_support_state_definition',
          'idx_ticket_support_state_definition_ticket',
          'idx_ticket_support_state_snooze',
          'idx_ticket_support_state_transition_ticket',
          'sqlite_autoindex_ticket_support_state_1',
        ]);
      } else assert.ok(indexes.results.length<=4,`${table} index growth requires envelope review`);
    }
    assert.equal(inventory.ticket_mutation_receipts,4);assert.equal(inventory.staff_ticket_mutation_receipts,4);
    assert.equal(inventory.conversation_events,7, 'Two unique keys and five deliberate query indexes are accounted for');
    assert.ok(100*5+50*9+(2*3*2)<=CANONICAL_MUTATION_ATTEMPT_D1_WRITES);
    console.log(JSON.stringify({fixture:'native-d1-index-inventory',inventory}));
  }finally{await f.mf.dispose();}
});


test('native stale-reply precondition is tenant-and-actor scoped, ignores metadata, and expires after 48 hours', async () => {
  const f = await fixture(); try {
    const generation = '11111111-1111-4111-8111-111111111111';
    const mentionedUserId = mentionRecipientIds[0];
    const candidate = {
      ticketId: 'ticket', articleId: '11111111-1111-4111-8111-111111111112', attachments: [], mentionedUserIds: [mentionedUserId],
      article: { sender_type: 'agent', body: 'Draft reply', body_format: 'markdown-v1', is_internal: true, intake_source: 'dashboard', received_at: '2030-01-01T00:00:00.000Z', processed_at: '2030-01-01T00:00:00.000Z' },
    } as MutationCandidate;
    const precondition = { ticketId: 'ticket', generation, revision: 1, baseConversationRevision: 0 } as const;
    await f.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,updated_at)
      VALUES ('a','staff','ticket',?,1,'internal','Draft reply','markdown-v1','[]',?,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(generation, JSON.stringify([mentionedUserId])).run();
    assert.equal(await staffReplyPreconditionMatches(f.db, f.scope(), candidate, precondition), true);
    const condition = staffReplyPreconditionConstraint(f.scope(), candidate, precondition);
    const plan = await f.db.prepare(`EXPLAIN QUERY PLAN SELECT CASE WHEN ${condition.sql} THEN 1 ELSE 0 END`).bind(...condition.values).all<{ detail: string }>();
    const details = plan.results.map((row: { detail: string }) => row.detail).join(' ');
    assert.match(details, /idx_conversation_events_staff_reply_precondition/);
    assert.doesNotMatch(details, /SCAN conversation_events|TEMP B-TREE/);
    assert.equal(await staffReplyPreconditionMatches(f.db, f.scope(), { ...candidate, mentionedUserIds: [mentionRecipientIds[1]] }, precondition), false,
      'A different recipient selection cannot satisfy an acknowledged draft precondition');
    await f.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES ('a',?,'ticket',1,'ticket.state_changed','staff','staff','mfa-staff','dashboard','internal','{}')`).bind(crypto.randomUUID()).run();
    assert.equal(await staffReplyPreconditionMatches(f.db, f.scope(), candidate, precondition), true,
      'Metadata does not force a fresh content review');
    await f.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES ('a',?,'ticket',2,'message.reply','customer','customer','authenticated-customer','portal','public','{}')`).bind(crypto.randomUUID()).run();
    assert.equal(await staffReplyPreconditionMatches(f.db, f.scope(), candidate, precondition), false,
      'New material customer content blocks the stale reply before any mutation writes');
    await f.db.prepare("DELETE FROM conversation_events WHERE tenant_id='a' AND ticket_id='ticket'").run();
    await f.db.prepare("UPDATE operator_drafts SET expires_at='2020-01-01T00:00:00.000Z' WHERE tenant_id='a' AND user_id='staff'").run();
    assert.equal(await staffReplyPreconditionMatches(f.db, f.scope(), candidate, precondition), false);
    assert.equal(await staffReplyPreconditionMatches(f.db, f.scope('b'), candidate, precondition), false,
      'A colliding ticket and generation in another tenant cannot satisfy the precondition');
  } finally { await f.mf.dispose(); }
});


test('internal mentions are bounded, authorized in the winning batch, and idempotent with their canonical note', async () => {
  const recipient = mentionRecipientIds[0];
  const foreignRecipient = '33333333-3333-4333-8333-333333333333';
  const mentioned = (body = 'Private note', recipients: readonly string[] = [recipient]): StaffMutationInput => ({
    operation: 'dashboard.ticket.reply', ticketId: 'ticket', data: { body, is_internal: true, mentionedUserIds: recipients },
  });

  const f = await fixture(); try {
    const s = f.service();
    const first = await accept(s, mentioned(), 'mention-winner');
    assert.equal(first.outcome.article.is_internal, true);
    const activity = await f.db.prepare(`SELECT recipient_user_id,kind,source_id,facts FROM operator_activities
      WHERE tenant_id='a'`).first<{recipient_user_id:string;kind:string;source_id:string;facts:string}>();
    assert.deepEqual(activity && { recipient: activity.recipient_user_id, kind: activity.kind, facts: JSON.parse(activity.facts) },
      { recipient, kind: 'mention', facts: { articleId: first.outcome.article.id } });
    assert.equal(activity?.source_id, `article:${first.outcome.article.id}:mention:${recipient}`);

    const replay = await s.prepareStaffMutation(mentioned(), 'mention-winner');
    assert.equal(replay.replay?.replayed, true, 'a lost response retries the winning canonical receipt before composing activity');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a'").first<{n:number}>())!.n, 1);
    await assert.rejects(s.prepareStaffMutation(mentioned('Private note', []), 'mention-winner'),
      (error: any) => error.status === 409 && error.code === 'idempotency_conflict',
      'selected normalized recipients are part of the canonical idempotency fingerprint');
    await assert.rejects(s.prepareStaffMutation({ operation: 'dashboard.ticket.reply', ticketId: 'ticket',
      data: { body: 'Public note', mentionedUserIds: [recipient] } }, 'public-mention'),
    (error: any) => error.status === 400 && error.code === 'invalid_mutation', 'public mention payloads are explicitly rejected');
    const foreign = await s.prepareStaffMutation(mentioned('Foreign recipient', [foreignRecipient]), 'foreign-mention');
    assert.equal((await s.admit(foreign)).status, 'spent'); const beforeForeign = await f.counts();
    await assert.rejects(s.commit(foreign), (error: any) => error.status === 409 && error.code === 'mention_recipient_unavailable',
      'a recipient in another tenant is denied by the final D1 batch');
    assert.deepEqual(await f.counts(), beforeForeign, 'a denied cross-tenant mention leaves no partial note or activity');
  } finally { await f.mf.dispose(); }

  const revoked = await fixture(); try {
    const s = revoked.service(); const prepared = await s.prepareStaffMutation(mentioned('Revoked before commit'), 'revoked-mention');
    assert.equal((await s.admit(prepared)).status, 'spent'); const before = await revoked.counts();
    revoked.before(async () => { await revoked.db.prepare(`DELETE FROM user_groups
      WHERE tenant_id='a' AND user_id=? AND group_id='group'`).bind(recipient).run(); });
    await assert.rejects(s.commit(prepared), (error: any) => error.status === 409 && error.code === 'mention_recipient_unavailable');
    assert.deepEqual(await revoked.counts(), before,
      'recipient revocation rejects the entire final D1 batch: no note, receipt, audit, SLA, or activity remains');
  } finally { await revoked.mf.dispose(); }
});

test('a full bounded mention list remains within the existing staff reservation with observed projection cost', async () => {
  const internal = (recipients: readonly string[]): StaffMutationInput => ({
    operation: 'dashboard.ticket.reply', ticketId: 'ticket', data: { body: 'Projection envelope', is_internal: true, mentionedUserIds: recipients },
  });
  const baseline = await fixture(); const projected = await fixture(); try {
    await accept(baseline.service(), internal([]), 'mention-envelope-base');
    await accept(projected.service(), internal(mentionRecipientIds), 'mention-envelope-max');
    const baseBatch = baseline.batches.at(-1)!; const mentionBatch = projected.batches.at(-1)!;
    assert.equal((await projected.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a'").first<{n:number}>())!.n, 16);
    console.log(JSON.stringify({ fixture: 'native-d1-internal-mention-envelope', baseBatch, mentionBatch,
      projectionStatements: mentionBatch.statements - baseBatch.statements, projectionRowsWritten: mentionBatch.rowsWritten - baseBatch.rowsWritten }));
    assert.equal(mentionBatch.statements - baseBatch.statements, 16,
      'the canonical batch contains one prepared activity statement per bounded recipient');
    assert.ok(mentionBatch.rowsWritten <= CANONICAL_MUTATION_ATTEMPT_D1_WRITES,
      'the observed final batch remains inside the existing 128-row staff reservation');
    assert.ok(mentionBatch.rowsRead <= 2_570,
      'the observed recipient authorization reads remain inside the existing staff envelope');
  } finally { await baseline.mf.dispose(); await projected.mf.dispose(); }
});

test('combined worst-case reply keeps durable mentions, attachments, precondition, and receipt inside the operation envelope', async () => {
  const f = await fixture(); try {
    const generation = '44444444-4444-4444-8444-444444444444';
    const attachments = Array.from({ length: 10 }, (_, index) => ({
      storageKey: `agent-attachments/staff/combined-${index}`, filename: `combined-${index}.txt`, size: 10 * 1024 * 1024, contentType: 'text/plain',
    }));
    await f.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,updated_at)
      VALUES ('a','staff','ticket',?,1,'internal','Combined worst-case','plain',?,?,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(generation, JSON.stringify(attachments), JSON.stringify(mentionRecipientIds)).run();
    const { service } = f.betaService();
    const input: StaffMutationInput = { operation: 'dashboard.ticket.reply', ticketId: 'ticket', data: {
      body: 'Combined worst-case', is_internal: true, attachments, mentionedUserIds: mentionRecipientIds,
      draft: { generation, revision: 1, baseConversationRevision: 0 },
    } };
    const prepared = await service.prepareStaffMutation(input, 'combined-mention-envelope');
    assert.equal((await service.admit(prepared)).status, 'spent');
    const result = await service.commit(prepared, attachments);
    const measured = f.batches.at(-1)!;
    assert.equal(result.attachments.length, 10);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a'").first<{n:number}>())!.n, 16);
    console.log(JSON.stringify({ fixture: 'native-d1-combined-mention-attachment-precondition-envelope', measured }));
    assert.ok(measured.rowsWritten > 128,
      'the accepted worst case proves a 128-row estimate is insufficient for this composition');
    assert.ok(measured.rowsWritten <= CANONICAL_MUTATION_ATTEMPT_D1_WRITES,
      'the complete accepted canonical attempt remains within the existing 1,024-row per-attempt reservation');
    assert.ok(measured.rowsRead <= 2_570,
      'the complete accepted canonical attempt remains within the configured staff read envelope');
  } finally { await f.mf.dispose(); }
});

test('concurrent worst-case combined attempts produce one receipt winner and bounded durable projections', async () => {
  const f = await fixture(); try {
    const generation = '55555555-5555-4555-8555-555555555555';
    const attachments = Array.from({ length: 10 }, (_, index) => ({
      storageKey: `agent-attachments/staff/race-${index}`, filename: `race-${index}.txt`, size: 10 * 1024 * 1024, contentType: 'text/plain',
    }));
    await f.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,updated_at)
      VALUES ('a','staff','ticket',?,1,'internal','Concurrent worst-case','plain',?,?,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(generation, JSON.stringify(attachments), JSON.stringify(mentionRecipientIds)).run();
    const { service } = f.betaService();
    const input: StaffMutationInput = { operation: 'dashboard.ticket.reply', ticketId: 'ticket', data: {
      body: 'Concurrent worst-case', is_internal: true, attachments, mentionedUserIds: mentionRecipientIds,
      draft: { generation, revision: 1, baseConversationRevision: 0 },
    } };
    const [left, right] = await Promise.all([
      service.prepareStaffMutation(input, 'combined-mention-race'), service.prepareStaffMutation(input, 'combined-mention-race'),
    ]);
    assert.deepEqual((await Promise.all([service.admit(left), service.admit(right)])).map(outcome => outcome.status).sort(), ['idempotent', 'spent']);
    const outcomes = await Promise.all([service.commit(left, attachments), service.commit(right, attachments)]);
    assert.equal(outcomes[0].article.id, outcomes[1].article.id);
    assert.equal(f.canonicalAttempts(), 2, 'only the admitted contender and its receipt loser reach a bounded canonical attempt');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM articles WHERE tenant_id='a'").first<{n:number}>())!.n, 1);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM attachments WHERE tenant_id='a'").first<{n:number}>())!.n, 10);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_activities WHERE tenant_id='a'").first<{n:number}>())!.n, 16);
    const retry = await service.prepareStaffMutation(input, 'combined-mention-race');
    assert.equal(retry.replay?.replayed, true, 'a later lost-response retry returns the existing receipt without new fanout');
  } finally { await f.mf.dispose(); }
});

test('staff reply precondition stays in the fingerprint and atomically retains a stale acknowledged draft', async () => {
  const f = await fixture(); try {
    const generation = '22222222-2222-4222-8222-222222222222';
    const input: StaffMutationInput = { operation: 'dashboard.ticket.reply', ticketId: 'ticket', data: {
      body: 'Acknowledged draft', bodyFormat: 'plain', draft: { generation, revision: 1, baseConversationRevision: 0 },
    } };
    await f.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,base_conversation_revision,updated_at)
      VALUES ('a','staff','ticket',?,1,'public','Acknowledged draft','plain','[]',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(generation).run();
    const service = f.service(); const prepared = await service.prepareStaffMutation(input, 'stale-draft');
    assert.equal((await service.admit(prepared)).status, 'spent');
    const before = await f.counts();
    f.before(async () => { await f.db.prepare(`INSERT INTO conversation_events
      (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts)
      VALUES ('a',?,'ticket',1,'message.reply','customer','customer','authenticated-customer','portal','public','{}')`).bind(crypto.randomUUID()).run(); });
    await assert.rejects(service.commit(prepared), (error: any) => error.status === 409 && error.code === 'staff_reply_stale');
    const after = await f.counts();
    assert.deepEqual({ tickets: after.tickets, articles: after.articles, attachments: after.attachments,
      receipts: after.staff_ticket_mutation_receipts }, { tickets: before.tickets, articles: before.articles,
      attachments: before.attachments, receipts: before.staff_ticket_mutation_receipts }, 'Stale replies create no ticket, article, attachment, or receipt side effect');
    await f.db.prepare("UPDATE operator_drafts SET revision=2,base_conversation_revision=1 WHERE tenant_id='a' AND user_id='staff' AND ticket_id='ticket'").run();
    const rebased: StaffMutationInput = { ...input, data: { ...input.data, draft: { generation, revision: 2, baseConversationRevision: 1 } } };
    const winner = await service.prepareStaffMutation(rebased, 'fingerprint');
    assert.equal((await service.admit(winner)).status, 'spent');
    await service.commit(winner);
    await assert.rejects(service.prepareStaffMutation({ ...rebased, data: { ...rebased.data, draft: { generation, revision: 1, baseConversationRevision: 0 } } }, 'fingerprint'),
      (error: any) => error.status === 409, 'The acknowledged draft reference is part of the idempotency fingerprint');
  } finally { await f.mf.dispose(); }
});
