import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import {splitSql} from './split-sql';
import {KNOWLEDGE_DELETE_HTTP_ENVELOPE,KNOWLEDGE_DELETE_STEP_ENVELOPE} from '../src/budgets/knowledge-delete-admission.service';

const root=resolve(import.meta.dirname,'..'),now=Math.floor(Date.now()/1000)*1000,secret='synthetic-knowledge-delete-secret-32-chars';
const dimensions=['workerRequests','d1RowsRead','d1RowsWritten','r2StorageBytes','r2ClassAOperations','r2ClassBOperations','workflowExecutions',
  'workflowSteps','workflowStorageBytes','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;
async function fixture(){const bundled=await build({entryPoints:[resolve(import.meta.dirname,'knowledge-delete-admission-runtime-entry.ts')],bundle:true,
  format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'knowledge-delete-proof',modules:true,compatibilityDate:'2024-04-03',
    compatibilityFlags:['nodejs_compat'],script:bundled.outputFiles[0].text,bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',JWT_SECRET:secret},
    d1Databases:{DB:'knowledge-delete-d1'},r2Buckets:{ATTACHMENTS_BUCKET:'knowledge-delete-r2'},durableObjects:{
      BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  try{const db=await mf.getD1Database('DB');for(const migration of readdirSync(join(root,'migrations')).filter(name=>name.endsWith('.sql')).sort())
    await db.batch(splitSql(readFileSync(join(root,'migrations',migration),'utf8')).map(sql=>db.prepare(sql)));
    const high=Object.fromEntries(dimensions.map(d=>[d,50_000_000]));const owner={schemaVersion:1,policyId:'delete-policy',revision:1,
      deploymentId:'delete-deployment',mode:'conservative',catalogueVersion:'synthetic-delete',maxGrantLifetimeMs:60_000,
      budgets:dimensions.map(d=>({dimension:d,limit:high[d],allocationId:`delete-${d}`,recoveryPercent:20,provenance:'owner-allocation',
        window:d.endsWith('StorageBytes')?{kind:'stock',id:`delete-${d}-stock`}:{kind:'interval',id:'delete-window',startsAt:now-1,endsAt:now+3_600_000}}))};
    await db.batch([db.prepare("INSERT INTO budget_deployment_authority VALUES ('delete-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('delete-deployment','delete-policy',1,1,'delete-coordinator',64,30000,?)`).bind(JSON.stringify(owner))]);
    for(const tenantId of ['delete-a','delete-b','delete-low']){const limits=tenantId==='delete-low'?Object.fromEntries(dimensions.map(d=>[d,1])):high;
      const restriction={schemaVersion:1,tenantId,ownerPolicyId:'delete-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]};
      await db.batch([db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'delete-admin',?,'admin',1,1)").bind(tenantId,`${tenantId}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('delete-deployment',?,'delete-policy',1,1,?,?,'active')`).bind(tenantId,`delete-${tenantId}`,JSON.stringify(restriction))]);}
    const token=async(tenantId:string)=>new SignJWT({tenant_id:tenantId,role:'admin',mfa_verified:true,session_version:1,email:`${tenantId}@example.test`})
      .setProtectedHeader({alg:'HS256'}).setSubject('delete-admin').setAudience('app').setIssuedAt(Math.floor(now/1000)).setExpirationTime(Math.floor(now/1000)+3600)
      .sign(new TextEncoder().encode(secret));return {mf,db,bucket:await mf.getR2Bucket('ATTACHMENTS_BUCKET') as unknown as R2Bucket,token};
  }catch(error){await mf.dispose();throw error;}}
async function remove(f:Awaited<ReturnType<typeof fixture>>,tenantId:string,id:string){return f.mf.dispatchFetch(`http://runtime.test/api/knowledge/articles/${id}`,
  {method:'DELETE',headers:{Authorization:`Bearer ${await f.token(tenantId)}`}});}
type Control=Readonly<{beforeRevoke?:'session'|'policy';beforeEffect?:'closure';failR2Once?:boolean;failVectorOnce?:boolean;reset?:boolean}>;
async function control(f:Awaited<ReturnType<typeof fixture>>,change?:Control|'session'|'policy'){
  const body=typeof change==='string'?{beforeRevoke:change}:change;
  return f.mf.dispatchFetch('http://runtime.test/__knowledge-delete-control',body?{method:'POST',body:JSON.stringify(body)}:undefined)
    .then(r=>r.json() as Promise<{r2Deletes:number;vectorDeleteCalls:number;vectorIds:number;d1Reads:number;d1Writes:number}>);}
async function step(f:Awaited<ReturnType<typeof fixture>>,documentId:string,token:string,purpose:'new-work'|'recovery'='new-work'){
  return f.mf.dispatchFetch('http://runtime.test/__knowledge-delete-step',{method:'POST',body:JSON.stringify({tenantId:'delete-a',documentId,deleteToken:token,purpose})})
    .then(r=>r.json() as Promise<{outcome:'next'|'complete'|'blocked'}>);}
async function doc(db:any,tenant:string,id:string,path:string,status='published',chunks=0){await db.prepare(`INSERT INTO knowledge_docs
  (tenant_id,id,title,file_path,status,chunk_count,tier) VALUES (?,?,?, ?,?,?,'answer')`).bind(tenant,id,`${tenant} title`,path,status,chunks).run();}

test('admitted DELETE preserves success/missing/isolation and current authority fencing',async t=>{const f=await fixture();try{
  await doc(f.db,'delete-a','shared','knowledge/shared/a');await doc(f.db,'delete-b','shared','knowledge/shared/b');
  await control(f,{reset:true});
  let response=await remove(f,'delete-a','shared');assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{success:true});
  const httpMeasured=await control(f);assert.ok(httpMeasured.d1Writes<=(KNOWLEDGE_DELETE_HTTP_ENVELOPE.d1RowsWritten??0));
  t.diagnostic(`admitted HTTP DELETE observed D1 rows_written=${httpMeasured.d1Writes} within envelope=${KNOWLEDGE_DELETE_HTTP_ENVELOPE.d1RowsWritten}`);
  assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_docs WHERE tenant_id='delete-a' AND id='shared'").first(),null);
  assert.ok(await f.db.prepare("SELECT delete_token FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='shared'").first());
  assert.ok(await f.db.prepare("SELECT 1 FROM knowledge_docs WHERE tenant_id='delete-b' AND id='shared'").first());
  response=await remove(f,'delete-a','missing');assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true});
  for(const change of ['session','policy'] as const){await doc(f.db,'delete-a',change,`knowledge/${change}`,'pending');await control(f,change);
    response=await remove(f,'delete-a',change);assert.equal(response.status,503,await response.clone().text());
    assert.ok(await f.db.prepare("SELECT 1 FROM knowledge_docs WHERE tenant_id='delete-a' AND id=?").bind(change).first());
    assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id=?").bind(change).first(),null);
    await f.db.prepare("UPDATE users SET session_version=1 WHERE tenant_id='delete-a' AND id='delete-admin'").run();}
  await doc(f.db,'delete-low','low','knowledge/low','pending');response=await remove(f,'delete-low','low');assert.equal(response.status,429);
  assert.ok(await f.db.prepare("SELECT 1 FROM knowledge_docs WHERE tenant_id='delete-low' AND id='low'").first());assert.equal((await control(f)).r2Deletes,0);
}finally{await f.mf.dispose();}});

test('bounded recovery removes document R2/vector/derived artefacts and preserves colliding article history',async t=>{const f=await fixture();try{
  const id='collision',paths=['knowledge/collision/body/versions/1','knowledge/collision/body/versions/2'];await doc(f.db,'delete-a',id,paths[1]);
  for(let version=1;version<=2;version++){await f.db.prepare(`INSERT INTO knowledge_index_versions
    (tenant_id,document_id,source_kind,version,file_path,tier,state,chunk_count,source_bytes) VALUES ('delete-a',?,'document',?,?,'answer','indexed',?,1)`)
    .bind(id,version,paths[version-1],version===1?120:85).run();await f.db.prepare(`INSERT INTO knowledge_index_jobs
      (tenant_id,document_id,version,next_chunk_index,state) VALUES ('delete-a',?,?,?,'complete')`).bind(id,version,version===1?120:85).run();
    const count=version===1?120:85;for(let offset=0;offset<count;offset+=100)await f.db.batch(Array.from({length:Math.min(100,count-offset)},(_,i)=>f.db.prepare(`INSERT INTO knowledge_index_chunks
      (tenant_id,document_id,version,chunk_index,chunk_text,state,vector_id) VALUES ('delete-a',?,?,?,'private text','indexed',?)`)
      .bind(id,version,offset+i,`doc_${id}_v${version}_${offset+i}`)));await f.bucket.put(`delete-a/${paths[version-1]}`,`source-${version}`);}
  await f.db.prepare(`INSERT INTO knowledge_index_cleanup_jobs VALUES ('delete-a',?,'document',2,'pending',0)`).bind(id).run();
  await f.db.prepare(`INSERT INTO knowledge_index_versions
    (tenant_id,document_id,source_kind,version,file_path,tier,state,chunk_count,source_bytes) VALUES ('delete-a',?,'article',3,'article/collision/versions/3','answer','indexed',1,1)`).bind(id).run();
  await f.db.prepare(`INSERT INTO knowledge_index_chunks
    (tenant_id,document_id,version,chunk_index,chunk_text,state,vector_id) VALUES ('delete-a',?,3,0,'article text','indexed','qa_collision_v3_0')`).bind(id).run();
  await f.bucket.put('delete-a/article/collision/versions/3','article');
  const response=await remove(f,'delete-a',id);assert.equal(response.status,200,await response.clone().text());
  const job=await f.db.prepare("SELECT delete_token FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id=?").bind(id).first<{delete_token:string}>();assert.ok(job);
  let turns=0,outcome:'next'|'complete'|'blocked'='next',r2Deletes=0,vectorDeleteCalls=0,vectorIds=0,maxD1Writes=0;
  while(outcome!=='complete'&&turns++<40){await control(f,{reset:true});outcome=(await step(f,id,job!.delete_token)).outcome;assert.notEqual(outcome,'blocked');
    const turn=await control(f);r2Deletes+=turn.r2Deletes;vectorDeleteCalls+=turn.vectorDeleteCalls;vectorIds+=turn.vectorIds;maxD1Writes=Math.max(maxD1Writes,turn.d1Writes);
    assert.ok(turn.d1Writes<=(KNOWLEDGE_DELETE_STEP_ENVELOPE.d1RowsWritten??0));}
  assert.equal(outcome,'complete');assert.ok(turns>5&&turns<40);
  for(const path of paths)assert.equal(await f.bucket.get(`delete-a/${path}`),null);assert.ok(await f.bucket.get('delete-a/article/collision/versions/3'));
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_index_versions WHERE tenant_id='delete-a' AND document_id=? AND source_kind='document'").bind(id).first<{count:number}>())?.count,0);
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_index_chunks WHERE tenant_id='delete-a' AND document_id=? AND version<3").bind(id).first<{count:number}>())?.count,0);
  assert.deepEqual(await f.db.prepare("SELECT source_kind,version FROM knowledge_index_versions WHERE tenant_id='delete-a' AND document_id=?").bind(id).first(),{source_kind:'article',version:3});
  assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id='delete-a' AND document_id=?").bind(id).first(),null);
  assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id=?").bind(id).first(),null);
  assert.equal(r2Deletes,2);assert.equal(vectorIds,205);assert.equal(vectorDeleteCalls,3);
  t.diagnostic(`bounded turns=${turns}, R2 deletes=${r2Deletes}, vector batches=${vectorDeleteCalls}, vector ids=${vectorIds}, maximum whole-step D1 rows_written=${maxD1Writes}/${KNOWLEDGE_DELETE_STEP_ENVELOPE.d1RowsWritten}`);
}finally{await f.mf.dispose();}});

test('published legacy source without a trustworthy vector manifest remains owned and never guesses 100 ids',async()=>{const f=await fixture();try{
  await doc(f.db,'delete-a','legacy','knowledge/legacy/body','published',0);await f.bucket.put('delete-a/knowledge/legacy/body','legacy');
  assert.equal((await remove(f,'delete-a','legacy')).status,200);const job=await f.db.prepare("SELECT delete_token,state FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='legacy'")
    .first<{delete_token:string;state:string}>();assert.equal(job?.state,'active');
  let outcome:'next'|'complete'|'blocked'='next';for(let turn=0;turn<6&&outcome!=='blocked';turn++)outcome=(await step(f,'legacy',job!.delete_token)).outcome;
  assert.equal(outcome,'blocked');assert.equal(await f.bucket.get('delete-a/knowledge/legacy/body'),null);
  assert.equal((await f.db.prepare("SELECT state FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='legacy'").first<{state:string}>())?.state,'legacy_manifest_required');
  assert.equal((await control(f)).vectorIds,0);assert.ok(await f.db.prepare("SELECT 1 FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='legacy'").first());
}finally{await f.mf.dispose();}});

test('a closed exact grant after claim prevents the provider effect despite its durable operation row',async()=>{const f=await fixture();try{
  await doc(f.db,'delete-a','closed','knowledge/closed/body','pending',0);await f.bucket.put('delete-a/knowledge/closed/body','closed');
  assert.equal((await remove(f,'delete-a','closed')).status,200);const job=await f.db.prepare("SELECT delete_token FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='closed'")
    .first<{delete_token:string}>();assert.ok(job);await control(f,{beforeEffect:'closure'});
  assert.equal((await step(f,'closed',job!.delete_token)).outcome,'blocked');assert.ok(await f.bucket.get('delete-a/knowledge/closed/body'));
  assert.equal((await control(f)).r2Deletes,0);
  assert.ok(await f.db.prepare("SELECT 1 FROM budget_grant_operations WHERE tenant_id='delete-a' AND operation_fingerprint LIKE '%' LIMIT 1").first());
  assert.ok(await f.db.prepare("SELECT 1 FROM budget_grant_closures WHERE tenant_id='delete-a' LIMIT 1").first());
  assert.equal((await f.db.prepare("SELECT state FROM knowledge_delete_work WHERE tenant_id='delete-a' AND document_id='closed'").first<{state:string}>())?.state,'uncertain');
}finally{await f.mf.dispose();}});

test('a lost provider response retains uncertain ownership and a newly charged recovery finishes cleanup',async()=>{const f=await fixture();try{
  await doc(f.db,'delete-a','lost','knowledge/lost/body','pending',0);await f.bucket.put('delete-a/knowledge/lost/body','lost');
  assert.equal((await remove(f,'delete-a','lost')).status,200);const job=await f.db.prepare("SELECT delete_token FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='lost'")
    .first<{delete_token:string}>();assert.ok(job);await control(f,{failR2Once:true});
  assert.equal((await step(f,'lost',job!.delete_token)).outcome,'blocked');assert.ok(await f.bucket.get('delete-a/knowledge/lost/body'));
  assert.equal((await f.db.prepare("SELECT state FROM knowledge_delete_work WHERE tenant_id='delete-a' AND document_id='lost'").first<{state:string}>())?.state,'uncertain');
  const operationsBefore=(await f.db.prepare("SELECT count(*) AS count FROM budget_grant_operations WHERE tenant_id='delete-a'").first<{count:number}>())!.count;
  assert.equal((await step(f,'lost',job!.delete_token,'recovery')).outcome,'next');assert.equal(await f.bucket.get('delete-a/knowledge/lost/body'),null);
  const operationsAfter=(await f.db.prepare("SELECT count(*) AS count FROM budget_grant_operations WHERE tenant_id='delete-a'").first<{count:number}>())!.count;
  assert.equal(operationsAfter,operationsBefore+1);
  let outcome:'next'|'complete'|'blocked'='next';for(let turn=0;turn<12&&outcome!=='complete';turn++)outcome=(await step(f,'lost',job!.delete_token)).outcome;
  assert.equal(outcome,'complete');assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_delete_tombstones WHERE tenant_id='delete-a' AND document_id='lost'").first(),null);
}finally{await f.mf.dispose();}});

test('deletion waits for an admitted source lease, then invalidates the stalled producer before cleanup',async()=>{const f=await fixture();try{
  await doc(f.db,'delete-a','stalled','knowledge/stalled/body/versions/1','pending',0);
  await f.db.batch([
    f.db.prepare(`INSERT INTO knowledge_index_versions
      (tenant_id,document_id,source_kind,version,file_path,tier,state,chunk_count,source_bytes)
      VALUES ('delete-a','stalled','document',1,'knowledge/stalled/body/versions/1','answer','source_pending',0,12)`),
    f.db.prepare(`INSERT INTO knowledge_index_jobs
      (tenant_id,document_id,version,next_chunk_index,state,provider_lease_expires_at)
      VALUES ('delete-a','stalled',1,0,'source_pending',datetime('now','+5 minutes'))`),
  ]);
  assert.equal((await remove(f,'delete-a','stalled')).status,200);const job=await f.db.prepare("SELECT delete_token FROM knowledge_delete_jobs WHERE tenant_id='delete-a' AND document_id='stalled'")
    .first<{delete_token:string}>();assert.ok(job);
  assert.equal((await step(f,'stalled',job!.delete_token)).outcome,'blocked');assert.equal((await control(f)).r2Deletes,0);
  assert.deepEqual(await f.db.prepare("SELECT v.state,j.state AS job_state FROM knowledge_index_versions v JOIN knowledge_index_jobs j USING (tenant_id,document_id,version) WHERE v.tenant_id='delete-a' AND v.document_id='stalled'").first(),
    {state:'withdrawn',job_state:'source_pending'});
  await f.db.prepare("UPDATE knowledge_index_jobs SET provider_lease_expires_at=datetime('now','-1 second') WHERE tenant_id='delete-a' AND document_id='stalled'").run();
  let outcome:'next'|'complete'|'blocked'='next';for(let turn=0;turn<15&&outcome!=='complete';turn++)outcome=(await step(f,'stalled',job!.delete_token,'recovery')).outcome;
  assert.equal(outcome,'complete');assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_index_versions WHERE tenant_id='delete-a' AND document_id='stalled'").first(),null);
  assert.equal(await f.db.prepare("SELECT 1 FROM knowledge_docs WHERE tenant_id='delete-a' AND id='stalled'").first(),null);
}finally{await f.mf.dispose();}});
