import assert from 'node:assert/strict';
import test from 'node:test';
import {withTwoTenantFixture,type LocalTenantFixture} from './local-tenant-fixture';
import {guardedFixture,betaCounters} from './local-beta-fixture';

function create(f:LocalTenantFixture,key:string,retry:string,subject:string,ip:string) {
  return f.request('/api/v1/tickets',{method:'POST',apiKey:key,idempotencyKey:retry,body:{subject,body:'Synthetic accepted message',customer_email:f.principals.customerA.email},ip:f.rateLimitIdentity+ip});
}
async function effects(f:LocalTenantFixture) {
  const counts:Record<string,number>={};
  for(const table of ['tickets','articles','attachments','conversation_events','ticket_mutation_receipts'])counts[table]=(await f.db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{n:number}>())!.n;
  return {counts,counters:await betaCounters(f)};
}
async function staffToken(f:LocalTenantFixture) {
  const challenge=await (await f.login('operatorA')).json<{token:string}>();
  const verified=await f.request('/api/auth/mfa/verify',{method:'POST',token:challenge.token,body:{code:f.currentMfaCode('operatorA')}});assert.equal(verified.status,200);
  return (await verified.json<{token:string}>()).token;
}

test('integrated beta: concurrent cross-tenant last-slot creates and same-key recovery never overcharge',async t=>{
  await withTwoTenantFixture(async f=>{
    const keys=await guardedFixture(f);
    assert.equal((await create(f,keys.a.apiKey,'first','First accepted','-first')).status,201);
    const race=await Promise.all([create(f,keys.a.apiKey,'a-last','A candidate','-a'),create(f,keys.b.apiKey,'b-last','B candidate','-b')]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,429]);
    assert.deepEqual(await betaCounters(f),{tickets:2,mutations:2,upload_attempts:0});
    t.diagnostic(JSON.stringify({tenants:2,lastSlotContenders:2,committedAtLastSlot:1,ceilingExceeded:false}));
  });
  await withTwoTenantFixture(async f=>{
    const keys=await guardedFixture(f,{ticketLimit:1,mutationLimit:2,recoveryReserve:1,uploadLimit:2});
    const race=await Promise.all([create(f,keys.a.apiKey,'same-last','One logical mutation','-one'),create(f,keys.a.apiKey,'same-last','One logical mutation','-two')]);
    assert.deepEqual(race.map(r=>r.status),[201,201]);
    assert.deepEqual(race.map(r=>r.headers.get('Idempotency-Replayed')).sort(),['false','true']);
    assert.deepEqual(await race[0].json(),await race[1].json());
    assert.deepEqual(await betaCounters(f),{tickets:1,mutations:1,upload_attempts:0});
    assert.equal((await create(f,keys.a.apiKey,'same-last','Conflicting payload','-conflict')).status,409);
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    const replay=await create(f,keys.a.apiKey,'same-last','One logical mutation','-stopped');assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');
    await f.db.prepare("DELETE FROM local_beta_invitations WHERE principal_kind='api-key' AND principal_id=?").bind(keys.a.id).run();
    assert.equal((await create(f,keys.a.apiKey,'same-last','One logical mutation','-revoked')).status,403);
    assert.deepEqual(await betaCounters(f),{tickets:1,mutations:1,upload_attempts:0});
  });
});

test('integrated beta: injected batch failures retain no counter, mutation, audit or receipt; fresh retry is safe',async t=>{
  await withTwoTenantFixture(async f=>{
    const keys=await guardedFixture(f);
    const before=await effects(f);
    for(const table of ['local_beta_assertion','tickets','articles','conversation_events','ticket_mutation_receipts']){
      await f.db.prepare(`CREATE TRIGGER beta_synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic batch failure'); END`).run();
      const response=await create(f,keys.a.apiKey,'retry-after-failure','Only after recovery','-failure-'+table);
      assert.equal(response.status,503,table);await response.body?.cancel();
      assert.deepEqual(await effects(f),before,table);
      await f.db.prepare('DROP TRIGGER beta_synthetic_failure').run();
    }
    assert.equal((await create(f,keys.a.apiKey,'retry-after-failure','Only after recovery','-recovered')).status,201);
    assert.deepEqual(await betaCounters(f),{tickets:1,mutations:1,upload_attempts:0});
    t.diagnostic(JSON.stringify({injectedFailureStages:5,partialCounters:0,partialMutations:0,partialEvents:0,recoveredCommit:1}));
  });
});

test('integrated beta: recovery reserve, material/no-op PATCH, stop/resume and accepted reads',async()=>{
  await withTwoTenantFixture(async f=>{
    const keys=await guardedFixture(f,{ticketLimit:1,mutationLimit:3,recoveryReserve:2,uploadLimit:2});
    const token=await staffToken(f);
    const accepted=await create(f,keys.a.apiKey,'accepted','Preserve conversation','-create');assert.equal(accepted.status,201);
    const ticket=await accepted.json<{id:string}>();
    assert.equal((await create(f,keys.a.apiKey,'blocked','No new intake','-blocked')).status,429);
    const patch=()=>f.request('/api/tickets/'+ticket.id,{method:'PATCH',token,body:{status:'pending'}});
    assert.equal((await patch()).status,200);assert.deepEqual(await betaCounters(f),{tickets:1,mutations:2,upload_attempts:0});
    assert.equal((await patch()).status,200);assert.deepEqual(await betaCounters(f),{tickets:1,mutations:2,upload_attempts:0});
    await f.db.prepare("UPDATE local_beta_policy SET state='intake_stopped',revision=revision+1 WHERE singleton=1").run();
    const reply=await f.request('/api/tickets/'+ticket.id+'/articles',{method:'POST',token,body:{body:'Accepted-work recovery reply',is_internal:false},ip:f.rateLimitIdentity+'-recovery'});assert.equal(reply.status,201);
    assert.deepEqual(await betaCounters(f),{tickets:1,mutations:3,upload_attempts:0});
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    assert.equal((await patch()).status,200,'Stopped no-op neither charges nor modifies accepted work');
    const stopped=await f.request('/api/tickets/'+ticket.id,{method:'PATCH',token,body:{status:'closed'}});assert.equal(stopped.status,503);
    assert.equal((await f.request('/api/tickets/'+ticket.id,{token})).status,200);
    f.restartLocalRuntime();
    assert.equal((await f.request('/api/v1/tickets/'+ticket.id,{apiKey:keys.a.apiKey})).status,200);
    await f.db.prepare("UPDATE local_beta_policy SET state='running',revision=revision+1 WHERE singleton=1").run();
    assert.equal((await f.request('/api/tickets/'+ticket.id,{method:'PATCH',token,body:{status:'closed'}})).status,429,'Resume does not reset an exhausted mutation counter');
    assert.deepEqual(await betaCounters(f),{tickets:1,mutations:3,upload_attempts:0});
  });
});

test('integrated beta: stopped and exhausted uploads make zero R2 calls; uncertain attempts never delete accepted objects',async()=>{
  await withTwoTenantFixture(async f=>{
    await guardedFixture(f);
    const token=await staffToken(f);
    const upload=()=>{const form=new FormData();form.append('file',new Blob(['synthetic safe attachment'],{type:'text/plain'}),'safe.txt');return f.request('/api/attachments/upload',{method:'POST',token,rawBody:form,contentType:null});};
    const accepted=await upload();assert.equal(accepted.status,200);const key=(await accepted.json<{key:string}>()).key;
    const reply=await f.request('/api/tickets/fixture-ticket/articles',{method:'POST',token,body:{body:'Preserve this attachment',attachments:[{filename:'safe.txt',storageKey:key}]},ip:f.rateLimitIdentity+'-attach'});assert.equal(reply.status,201);
    const saved=await effects(f);
    f.r2.failNextPut(true);assert.equal((await upload()).status,500);
    assert.equal((await betaCounters(f))!.upload_attempts,2);
    const before=f.r2.operationCounts();assert.equal((await upload()).status,429);assert.deepEqual(f.r2.operationCounts(),before);
    assert.equal(before.delete,0,'Ambiguous put failure must never delete a potentially accepted object');
    const persisted=await f.db.prepare("SELECT id FROM attachments WHERE tenant_id=? AND r2_key=?").bind(f.principals.operatorA.tenantId,key).first<{id:string}>();assert.ok(persisted);
    assert.equal((await f.request('/api/attachments/'+persisted.id+'/download',{token})).status,200);
    assert.deepEqual((await effects(f)).counts,saved.counts);
    await f.db.prepare("UPDATE local_beta_policy SET state='writes_stopped',revision=revision+1 WHERE singleton=1").run();
    const after=f.r2.operationCounts();assert.equal((await upload()).status,503);assert.deepEqual(f.r2.operationCounts(),after);
  });
});
