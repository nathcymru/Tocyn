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
import { TicketMutationReplayRepository, type MutationCandidate } from '../src/repositories/ticket-mutation-replay.repository';
import { CapabilityPolicyService } from '../src/repositories/capability-policy.repository';
import { SessionBudgetAdmissionService } from '../src/budgets/session-admission.service';
import { IsolateBudgetAdmissionCache } from '../src/budgets/isolate-admission.service';
import { StaffTicketMutationService } from '../src/services/staff-ticket-mutation.service';
import type { StaffMutationCommit,StaffMutationInput } from '../src/types/staff-ticket-mutation';
import type { CapabilityWriteFence } from '../src/auth/capability-policy';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';

const root = resolve(import.meta.dirname,'..');
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
    const limits = {workerRequests:1000,d1RowsRead:10_000_000,d1RowsWritten:10_000,doRequests:1000,doRowsRead:1000,doRowsWritten:1000,logEvents:100_000};
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
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES (?,'ticket','Synthetic',?,'group','dashboard')").bind(tenant,`customer-${tenant}@example.test`),
      db.prepare("INSERT INTO budget_tenant_allocations VALUES ('staff-deployment',?,'staff-policy',1,1,?,?,'active')").bind(tenant,`staff-${tenant}`,JSON.stringify({schemaVersion:1,tenantId:tenant,ownerPolicyId:'staff-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]})),
      db.prepare("INSERT INTO tenant_role_capability_policies (tenant_id,role,capability,enabled,revision) VALUES (?,'agent','ticket-fields.manage',1,1)").bind(tenant),
    ]);
    await db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('b','foreign','Foreign','customer-b@example.test','dashboard')").run();
    const rawNamespace = await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace<BudgetCoordinatorDO>;
    const coordinator = rawNamespace.get(rawNamespace.idFromName('staff-aggregate')) as unknown as BudgetCoordinatorDO;
    const calls = {refresh:0,reserve:0};
    const namespace = { idFromName:(name:string) => rawNamespace.idFromName(name),get:() => ({
      refreshFromTrustedAuthority:async (input:Parameters<BudgetCoordinatorDO['refreshFromTrustedAuthority']>[0]) => {calls.refresh++;return coordinator.refreshFromTrustedAuthority(input);},
      reserveFromTrustedAuthority:async (input:Parameters<BudgetCoordinatorDO['reserveFromTrustedAuthority']>[0]) => {calls.reserve++;return coordinator.reserveFromTrustedAuthority(input);},
    }) } as unknown as DurableObjectNamespace;
    const admission = new SessionBudgetAdmissionService(new IsolateBudgetAdmissionCache());
    let beforeCommit: (() => Promise<void>) | undefined;
    let loseResponse = false;
    class Canonical extends TicketMutationReplayRepository {
      override async commitStaff(candidate:MutationCandidate,commit:StaffMutationCommit) {
        const action = beforeCommit;beforeCommit=undefined;if (action) await action();
        const result = await super.commitStaff(candidate,commit);
        if (loseResponse) {loseResponse=false;throw new Error('Synthetic lost committed response');}
        return result;
      }
    }
    const scope = (tenant='a',actor='staff') => createVerifiedTenantScope(tenant,actor,['agent'],1);
    const credential = (tenant='a',actor='staff') => ({tenantId:tenant,actorId:actor,role:'agent' as const,sessionVersion:1,expiresAt:Math.floor(Date.now()/1000)+3600,mfaVerified:true});
    const service = (tenant='a',actor='staff',capability?:CapabilityWriteFence) => new StaffTicketMutationService(db,scope(tenant,actor),credential(tenant,actor),new Canonical(db,scope(tenant,actor)),
      {service:admission,repository:new BudgetAuthorityRepository(db,scope(tenant,actor)),namespace,business:{workerRequests:1,d1RowsRead:4096,d1RowsWritten:128,logEvents:136}},capability);
    const counts = async () => {
      const result:Record<string,number> = {};
      for (const table of ['tickets','articles','attachments','conversation_events','ticket_sla_events','staff_ticket_mutation_receipts']) {
        result[table] = (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{n:number}>())!.n;
      }
      return result;
    };
    return {mf,db,service,scope,credential,calls,counts,coordinator,before:(action:()=>Promise<void>) => {beforeCommit=action;},lose:() => {loseResponse=true;}};
  } catch (error) {await mf.dispose();throw error;}
}
const reply = (body='Synthetic reply'):StaffMutationInput => ({operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body}});
const create = ():StaffMutationInput => ({operation:'dashboard.ticket.create',data:{subject:'Staff intake',customer_email:'CUSTOMER-A@EXAMPLE.TEST',body:'Synthetic intake',group_id:'group'}});
async function accept(service:StaffTicketMutationService,input:StaffMutationInput,key:string) {
  const prepared = await service.prepare(input,key);assert.equal(prepared.replay,null);
  assert.equal((await service.admit(prepared)).status,'spent');return {prepared,outcome:await service.commit(prepared)};
}

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
    const before=await f.counts();const replayed=await s.prepare(reply(),'one');
    assert.equal(replayed.replay?.replayed,true);assert.deepEqual(replayed.replay?.body,first.outcome.body);
    assert.equal((await s.admit(replayed)).status,'replayed');assert.deepEqual(f.calls,cold);assert.deepEqual(await f.counts(),before);
    await assert.rejects(s.prepare(reply('Changed'),'one'),(error:any) => error.status===409);
    await accept(f.service('b'),reply(),'one');
    await assert.rejects(s.prepare({...reply(),ticketId:'foreign'} as StaffMutationInput,'foreign'));
    const audit=await f.db.prepare("SELECT actor_kind,actor_id,actor_provenance,source FROM conversation_events WHERE tenant_id='a' AND article_id=?").bind(first.outcome.article.id).first();
    assert.deepEqual(audit,{actor_kind:'staff',actor_id:'staff',actor_provenance:'mfa-staff',source:'dashboard'});
    await f.db.prepare("DELETE FROM user_groups WHERE tenant_id='a' AND user_id='staff'").run();
    await assert.rejects(s.prepare(reply(),'one'));
  } finally {await f.mf.dispose();}
});

test('same-key concurrency and lost committed response return one canonical mutation', async () => {
  const f=await fixture();try {
    const s=f.service();const a=await s.prepare(reply(),'race'),b=await s.prepare(reply(),'race');
    const results=await Promise.all([s.admit(a),s.admit(b)]);assert.deepEqual(results.map(r=>r.status).sort(),['idempotent','spent']);
    const outcomes=await Promise.all([s.commit(a),s.commit(b)]);assert.equal(outcomes[0].article.id,outcomes[1].article.id);
    assert.deepEqual(outcomes.map(o=>o.replayed).sort(),[false,true]);
    const before=await f.counts();f.lose();const lost=await accept(s,reply('Lost response'),'lost');
    assert.equal(lost.outcome.replayed,true);assert.equal((await f.counts()).articles,before.articles+1);
    assert.equal((await s.prepare(reply('Lost response'),'lost')).replay?.article.id,lost.outcome.article.id);
  } finally {await f.mf.dispose();}
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
    const s=f.service();const p=await s.prepare(reply(),'changed');assert.equal((await s.admit(p)).status,'spent');
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
    const p=await s.prepare(reply(),'cap');assert.equal((await s.admit(p)).status,'spent');
    const before=await f.counts();f.before(async()=>{await f.db.prepare("UPDATE deployment_capability_ceiling SET enabled=0 WHERE capability='ticket-fields.manage'").run();});
    await assert.rejects(s.commit(p));assert.deepEqual(await f.counts(),before);
    await f.db.prepare("UPDATE deployment_capability_ceiling SET enabled=1 WHERE capability='ticket-fields.manage'").run();
    await f.db.prepare('UPDATE budget_owner_policies SET authority_max_age_ms=1000').run();
    const exp=f.service();const prepared=await exp.prepare(reply(),'expiry');const result=await exp.admit(prepared);assert.equal(result.status,'spent');
    f.before(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
    await assert.rejects(exp.commit(prepared));assert.deepEqual(await f.counts(),before);
  }finally{await f.mf.dispose();}
});

test('attachment intent, immutable preparation, deletion redaction, snapshot cap and future format fail closed',async()=>{
  const f=await fixture();try{
    const s=f.service();const input:StaffMutationInput={operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'Attachment',is_internal:true,attachments:[{storageKey:'agent-attachments/staff/file',filename:'file.txt'}]}};
    const p=await s.prepare(input,'attachment');input.data.body='Mutated';assert.equal((await s.admit(p)).status,'spent');
    await assert.rejects(s.commit(p,[{storageKey:'agent-attachments/staff/other',filename:'file.txt',size:4,contentType:'text/plain'}]));
    const result=await s.commit(p,[{storageKey:'agent-attachments/staff/file',filename:'file.txt',size:4,contentType:'text/plain'}]);
    assert.equal(result.article.body,'Attachment');assert.equal(result.article.is_internal,true);assert.equal(result.attachments.length,1);
    await f.db.prepare('DELETE FROM attachments WHERE tenant_id=? AND id=?').bind('a',result.attachments[0].id).run();
    await assert.rejects(s.prepare({...input,data:{...input.data,body:'Attachment'}},'attachment'),(error:any)=>error.status===410);
    const row=await f.db.prepare("SELECT response_snapshot,lifecycle FROM staff_ticket_mutation_receipts WHERE tenant_id='a'").first();assert.deepEqual(row,{response_snapshot:null,lifecycle:'gone'});
    await assert.rejects(s.prepare({operation:'dashboard.ticket.reply',ticketId:'ticket',data:{body:'Markdown',bodyFormat:'markdown-v1'}},'format'),(error:any)=>error.code==='unsupported_article_format');
    const huge=await s.prepare(reply(),'huge');assert.equal((await s.admit(huge)).status,'spent');
    await f.db.prepare("UPDATE tickets SET custom_fields=? WHERE tenant_id='a' AND id='ticket'").bind('x'.repeat(262144)).run();
    const before=await f.counts();await assert.rejects(s.commit(huge));assert.deepEqual(await f.counts(),before);
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
    const p=await s.prepare(reply('Membership sentinel'),'sentinel');assert.equal((await s.admit(p)).status,'spent');
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
    const s=f.service();const p=await s.prepare(reply());const before=await f.counts();
    await assert.rejects(s.commit(p));await assert.rejects(f.service().commit(p));
    await assert.rejects(s.commit(Object.freeze({replay:null})));assert.deepEqual(await f.counts(),before);
    assert.equal((await s.admit(p)).status,'spent');
    const results=await Promise.allSettled([s.commit(p),s.commit(p)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal((await f.counts()).articles,before.articles+1);
    const denied=await s.prepare(reply('No allocation'),'no-allocation');
    await f.db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='a'").run();
    assert.equal((await s.admit(denied)).status,'rejected');
    const after=await f.counts();await assert.rejects(s.commit(denied));assert.deepEqual(await f.counts(),after);
  }finally{await f.mf.dispose();}
});

test('a failed staff batch requires fresh bounded admission, and exhausted admission cannot retain an old commit fence',async()=>{
  const f=await fixture();try{
    const s=f.service();const p=await s.prepare(reply(),'retry');assert.equal((await s.admit(p)).status,'spent');
    const before=await f.counts();f.before(async()=>{throw new Error('Synthetic preparation interruption');});
    await assert.rejects(s.commit(p));await assert.rejects(s.commit(p));assert.deepEqual(await f.counts(),before);
    const retry=await s.prepare(reply(),'retry');assert.equal((await s.admit(retry)).status,'idempotent');
    assert.equal((await s.commit(retry)).replayed,false);
    const exhausted=await s.prepare(reply('Exhaust attempts'),'exhausted');
    assert.equal((await s.admit(exhausted)).status,'spent');assert.equal((await s.admit(exhausted)).status,'idempotent');
    assert.equal((await s.admit(exhausted)).status,'rejected');
    const after=await f.counts();await assert.rejects(s.commit(exhausted));assert.deepEqual(await f.counts(),after);
  }finally{await f.mf.dispose();}
});
