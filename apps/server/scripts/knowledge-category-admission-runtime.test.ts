import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import {splitSql} from './split-sql';

const root=resolve(import.meta.dirname,'..'),now=Date.now(),secret='knowledge-category-runtime-secret-32-characters';
async function apply(db:any){for(const file of readdirSync(join(root,'migrations')).filter(file=>file.endsWith('.sql')).sort())
  await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));}
function ownerPolicy(){const limit=20_000_000,limits={workerRequests:limit,d1RowsRead:limit,d1RowsWritten:limit,doRequests:limit,doRowsRead:limit,doRowsWritten:limit,logEvents:limit};
  return{schemaVersion:1,policyId:'category-policy',revision:1,deploymentId:'category-deployment',mode:'conservative',catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,
    budgets:Object.entries(limits).map(([dimension,value])=>({dimension,limit:value,allocationId:`category-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',
      window:{kind:'interval',id:'category-window',startsAt:now-60_000,endsAt:now+3_600_000}}))};}
async function token(tenant:string,version=1){return new SignJWT({sub:'staff',role:'admin',tenant_id:tenant,session_version:version,mfa_verified:true})
  .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));}

async function fixture(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/knowledge-category-admission-runtime-entry.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'knowledge-category-admission',modules:true,compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',ENVIRONMENT:'local',JWT_SECRET:secret},d1Databases:{DB:'category-d1'},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},unsafeEphemeralDurableObjects:true}]}));
  const db=await mf.getD1Database('DB');await apply(db);const owner=ownerPolicy(),limits=Object.fromEntries(owner.budgets.map((item:any)=>[item.dimension,item.limit]));
  const allocation=(tenant:string,tenantLimits=limits)=>JSON.stringify({schemaVersion:1,tenantId:tenant,ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,mode:'conservative',limits:tenantLimits,disabledFeatures:[]});
  await db.batch([
    db.prepare("INSERT INTO budget_deployment_authority VALUES('category-deployment',1,'active',?)").bind(now),
    db.prepare(`INSERT INTO budget_owner_policies(deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
      VALUES('category-deployment','category-policy',1,1,'category-coordinator',64,60000,?)`).bind(JSON.stringify(owner)),
    ...['category-a','category-b'].flatMap(tenant=>[
      db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES(?,'staff',?,'admin',1,1)").bind(tenant,`${tenant}@example.test`),
      db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
        VALUES('category-deployment',?,'category-policy',1,1,?,?,'active')`).bind(tenant,`category-${tenant}`,allocation(tenant)),
    ]),
    db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES('category-low','staff','low@example.test','admin',1,1)"),
    db.prepare(`INSERT INTO budget_tenant_allocations(deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
      VALUES('category-deployment','category-low','category-policy',1,1,'category-low',?,'active')`).bind(allocation('category-low',{...limits,d1RowsRead:1})),
  ]);
  const request=async(tenant:string,path:string,method='GET',body?:unknown,key?:string)=>mf.dispatchFetch(`http://runtime.test/api/knowledge${path}`,{method,
    headers:{authorization:`Bearer ${await token(tenant)}`,...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{mf,db,request};
}

test('native handler preserves complete category lists, tenant isolation and replay',async t=>{const f=await fixture();try{
  const ids=Array.from({length:240},(_,i)=>`category-${i.toString().padStart(3,'0')}`);
  for(let offset=0;offset<ids.length;offset+=60)await f.db.batch(ids.slice(offset,offset+60).map((id,i)=>f.db.prepare(
    `INSERT INTO knowledge_categories(tenant_id,id,name,created_at) VALUES('category-a',?,?,?)`).bind(id,`Label ${offset+i}`,new Date(now+offset+i).toISOString())));
  await f.db.prepare("INSERT INTO knowledge_categories(tenant_id,id,name) VALUES('category-b','foreign','Foreign')").run();
  const list=await f.request('category-a','/categories');assert.equal(list.status,200,await list.clone().text());const rows=await list.json() as any[];
  assert.equal(rows.length,240);assert.ok(!rows.some(row=>row.id==='foreign'));
  const create=await f.request('category-a','/categories','POST',{name:'Owned label',parent_id:null},'create-key');assert.equal(create.status,200,await create.clone().text());
  const id=(await create.json() as any).id;const replay=await f.request('category-a','/categories','POST',{name:'Owned label',parent_id:null},'create-key');
  assert.equal(replay.status,200);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.equal((await replay.json() as any).id,id);
  const collision=await f.request('category-a','/categories','POST',{name:'Different label',parent_id:null},'create-key');assert.equal(collision.status,409);await collision.body?.cancel();
  const remove=await f.request('category-a',`/categories/${id}`,'DELETE',undefined,'delete-key');assert.equal(remove.status,200);assert.deepEqual(await remove.json(),{success:true});
  const removeReplay=await f.request('category-a',`/categories/${id}`,'DELETE',undefined,'delete-key');assert.equal(removeReplay.status,200);assert.equal(removeReplay.headers.get('Idempotency-Replayed'),'true');
  const operations=await f.db.prepare("SELECT count(*) count FROM budget_grant_operations WHERE tenant_id='category-a'").first<{count:number}>();assert.equal(operations?.count,3);
  const control=await (await f.mf.dispatchFetch('http://runtime.test/__category-control')).json() as any;
  const metric=control.attempts.find((item:any)=>item.path.endsWith('/categories')&&item.method==='GET');
  assert.equal(metric.categoryRowsLoaded,240);assert.ok(metric.d1RowsRead<10_000);t.diagnostic(`native complete category rows=${rows.length}, D1 rows_read=${metric.d1RowsRead}`);
  const admitted=await f.db.prepare("SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id='category-a' ORDER BY committed_at,rowid").all<{operation_envelope_json:string}>();
  const canonical=control.attempts.filter((item:any)=>item.path.includes('/api/knowledge/categories')&&item.d1RowsWritten>0);
  assert.equal(admitted.results.length,canonical.length);
  admitted.results.forEach((row:{operation_envelope_json:string},index:number)=>{const envelope=JSON.parse(row.operation_envelope_json);assert.ok(canonical[index].d1RowsRead<=envelope.d1RowsRead);
    assert.ok(canonical[index].d1RowsWritten<=envelope.d1RowsWritten);});
  t.diagnostic(`native admitted category attempts reads/writes=${canonical.map((item:any)=>`${item.d1RowsRead}/${item.d1RowsWritten}`).join(',')}`);
}finally{await f.mf.dispose();}});

for(const action of ['session','role','mfa','authority','population-growth'] as const)test(`native ${action} change after reservation fails before category effects`,async()=>{const f=await fixture();try{
  await f.db.prepare("INSERT INTO knowledge_categories(tenant_id,id,name) VALUES('category-a','stable','Stable')").run();
  await f.mf.dispatchFetch('http://runtime.test/__category-control',{method:'POST',body:JSON.stringify({beforeCanonical:action})});
  const response=await f.request('category-a','/categories');assert.equal(response.status,503,await response.clone().text());
  const linked=await f.db.prepare("SELECT count(*) count FROM budget_grant_operations").first<{count:number}>();assert.equal(linked?.count,0);
}finally{await f.mf.dispose();}});

test('native exhausted admission has no list load or mutation and empty tenants remain valid',async()=>{const f=await fixture();try{
  const empty=await f.request('category-a','/categories');assert.equal(empty.status,200);assert.deepEqual(await empty.json(),[]);
  await f.db.prepare("INSERT INTO knowledge_categories(tenant_id,id,name) VALUES('category-low','denied','Must remain')").run();
  const denied=await f.request('category-low','/categories');assert.equal(denied.status,429);await denied.body?.cancel();
  const deniedCreate=await f.request('category-low','/categories','POST',{name:'No write'},'denied-create');assert.equal(deniedCreate.status,429);await deniedCreate.body?.cancel();
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_categories WHERE tenant_id='category-low'").first<{count:number}>())?.count,1);
  const control=await (await f.mf.dispatchFetch('http://runtime.test/__category-control')).json() as any;
  const metric=control.attempts.filter((item:any)=>item.path.endsWith('/categories')&&item.method==='GET').at(-1);
  assert.equal(metric.categoryRowsLoaded,0);
}finally{await f.mf.dispose();}});

test('native revoked current identity is denied before an invalid request body is loaded',async()=>{const f=await fixture();try{
  await f.db.prepare("UPDATE users SET session_version=2 WHERE tenant_id='category-a' AND id='staff'").run();
  const response=await f.mf.dispatchFetch('http://runtime.test/api/knowledge/categories',{method:'POST',headers:{authorization:`Bearer ${await token('category-a')}`,
    'content-type':'application/json','idempotency-key':'denied-body'},body:'{not-valid-json'});
  assert.equal(response.status,401,await response.clone().text());
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_category_mutation_receipts").first<{count:number}>())?.count,0);
}finally{await f.mf.dispose();}});

test('native lost commit acknowledgement recovers the immutable create receipt',async()=>{const f=await fixture();try{
  await f.mf.dispatchFetch('http://runtime.test/__category-control',{method:'POST',body:JSON.stringify({loseNextCanonicalAck:true})});
  const response=await f.request('category-a','/categories','POST',{name:'Recovered category',parent_id:null},'recover-create');
  assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('Idempotency-Replayed'),'true');
  const body=await response.json() as {id:string};
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_categories WHERE tenant_id='category-a' AND id=? AND name='Recovered category'").bind(body.id).first<{count:number}>())?.count,1);
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_category_mutation_receipts WHERE tenant_id='category-a' AND key_hash IS NOT NULL").first<{count:number}>())?.count,1);
}finally{await f.mf.dispose();}});

test('native stale category population rejects a create without its partial write',async()=>{const f=await fixture();try{
  await f.mf.dispatchFetch('http://runtime.test/__category-control',{method:'POST',body:JSON.stringify({beforeCanonical:'population-growth'})});
  const response=await f.request('category-a','/categories','POST',{name:'Must not commit',parent_id:null},'stale-create');
  assert.equal(response.status,503,await response.clone().text());
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_categories WHERE tenant_id='category-a' AND name='Must not commit'").first<{count:number}>())?.count,0);
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_categories WHERE tenant_id='category-a' AND id='race'").first<{count:number}>())?.count,1);
}finally{await f.mf.dispose();}});

test('native bounded expired-receipt cleanup stays inside the mutation write envelope',async t=>{const f=await fixture();try{
  await f.db.batch(Array.from({length:32},(_,index)=>f.db.prepare(`INSERT INTO knowledge_category_mutation_receipts
    (tenant_id,principal_id,operation,key_hash,payload_hash,response_status,response_snapshot,expires_at)
    VALUES('category-a','staff','knowledge.category.create',?,? ,200,'{"id":"expired"}',unixepoch()-1)`).bind(`expired-${index}`,`payload-${index}`)));
  const response=await f.request('category-a','/categories','POST',{name:'After cleanup',parent_id:null},'cleanup-create');assert.equal(response.status,200,await response.clone().text());
  const operation=await f.db.prepare("SELECT operation_envelope_json FROM budget_grant_operations WHERE tenant_id='category-a' LIMIT 1").first<{operation_envelope_json:string}>();
  const control=await (await f.mf.dispatchFetch('http://runtime.test/__category-control')).json() as any,metric=control.attempts.at(-1),envelope=JSON.parse(operation!.operation_envelope_json);
  assert.ok(metric.d1RowsWritten<=envelope.d1RowsWritten);assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_category_mutation_receipts WHERE tenant_id='category-a' AND expires_at<=unixepoch()").first<{count:number}>())?.count,0);
  t.diagnostic(`native max cleanup D1 rows_written=${metric.d1RowsWritten}, admitted=${envelope.d1RowsWritten}`);
}finally{await f.mf.dispose();}});

test('native delete keeps document and child references atomic and tenant-scoped',async()=>{const f=await fixture();try{
  await f.db.batch([
    f.db.prepare("INSERT INTO knowledge_categories(tenant_id,id,name) VALUES('category-a','parent','Parent')"),
    f.db.prepare("INSERT INTO knowledge_categories(tenant_id,id,name,parent_id) VALUES('category-a','child','Child','parent')"),
    f.db.prepare("INSERT INTO knowledge_categories(tenant_id,id,name) VALUES('category-a','article-category','Articles')"),
    f.db.prepare("INSERT INTO knowledge_docs(tenant_id,id,title,file_path,status,category_id) VALUES('category-a','doc','Doc','knowledge/doc','ready','article-category')"),
  ]);
  const childRef=await f.request('category-a','/categories/parent','DELETE',undefined,'child-ref');assert.equal(childRef.status,400,await childRef.clone().text());
  const docRef=await f.request('category-a','/categories/article-category','DELETE',undefined,'doc-ref');assert.equal(docRef.status,400,await docRef.clone().text());
  const foreign=await f.request('category-b','/categories/parent','DELETE',undefined,'foreign-missing');assert.equal(foreign.status,200);assert.deepEqual(await foreign.json(),{success:true});
  assert.equal((await f.db.prepare("SELECT count(*) count FROM knowledge_categories WHERE tenant_id='category-a' AND id IN ('parent','article-category')").first<{count:number}>())?.count,2);
}finally{await f.mf.dispose();}});
