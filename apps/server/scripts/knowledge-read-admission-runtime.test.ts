import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {SignJWT} from 'jose';
import {splitSql} from './split-sql';
import {knowledgeReadEnvelope} from '../src/budgets/knowledge-read-admission.service';

const root=resolve(import.meta.dirname,'..'),now=Math.floor(Date.now()/1000)*1000;
const secret='synthetic-knowledge-read-secret-at-least-32-chars';
const dimensions=['workerRequests','d1RowsRead','d1RowsWritten','r2StorageBytes','r2ClassAOperations','r2ClassBOperations',
  'workflowExecutions','workflowSteps','workflowStorageBytes','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;

async function fixture(){
  const bundled=await build({entryPoints:[resolve(import.meta.dirname,'knowledge-read-admission-runtime-entry.ts')],bundle:true,
    format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'knowledge-read-proof',modules:true,compatibilityDate:'2024-04-03',
    compatibilityFlags:['nodejs_compat'],script:bundled.outputFiles[0].text,bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',JWT_SECRET:secret},
    d1Databases:{DB:'knowledge-read-d1'},r2Buckets:{ATTACHMENTS_BUCKET:'knowledge-read-r2'},durableObjects:{
      BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO',NOTIFICATION_DO:'NotificationDO'},
    unsafeEphemeralDurableObjects:true}]}));
  try{
    const db=await mf.getD1Database('DB');
    for(const migration of readdirSync(join(root,'migrations')).filter(name=>name.endsWith('.sql')).sort())
      await db.batch(splitSql(readFileSync(join(root,'migrations',migration),'utf8')).map(sql=>db.prepare(sql)));
    const high=Object.fromEntries(dimensions.map(dimension=>[dimension,50_000_000]));
    const owner={schemaVersion:1,policyId:'knowledge-policy',revision:1,deploymentId:'knowledge-deployment',mode:'conservative',
      catalogueVersion:'synthetic-2026-09',maxGrantLifetimeMs:60_000,budgets:dimensions.map(dimension=>({dimension,limit:high[dimension],
        allocationId:`knowledge-${dimension}`,recoveryPercent:20,provenance:'owner-allocation',window:dimension.endsWith('StorageBytes')
          ?{kind:'stock',id:'knowledge-r2-stock'}:{kind:'interval',id:'knowledge-window',startsAt:now-1,endsAt:now+3_600_000}}))};
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('knowledge-deployment',1,'active',?)").bind(now),
      db.prepare(`INSERT INTO budget_owner_policies (deployment_id,policy_id,policy_revision,authority_revision,coordinator_id,max_reservations,authority_max_age_ms,policy_json)
        VALUES ('knowledge-deployment','knowledge-policy',1,1,'knowledge-coordinator',64,30000,?)`).bind(JSON.stringify(owner)),
    ]);
    for(const tenantId of ['knowledge-a','knowledge-b','knowledge-low']){
      const limits=tenantId==='knowledge-low'?Object.fromEntries(dimensions.map(dimension=>[dimension,1])):high;
      const restriction={schemaVersion:1,tenantId,ownerPolicyId:'knowledge-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]};
      await db.batch([
        db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,'knowledge-admin',?,'admin',1,1)")
          .bind(tenantId,`${tenantId}@example.test`),
        db.prepare(`INSERT INTO budget_tenant_allocations (deployment_id,tenant_id,policy_id,policy_revision,authority_revision,reservation_namespace,restriction_json,state)
          VALUES ('knowledge-deployment',?,'knowledge-policy',1,1,?,?,'active')`).bind(tenantId,`knowledge-${tenantId}`,JSON.stringify(restriction)),
      ]);
    }
    const token=async(tenantId:string)=>new SignJWT({tenant_id:tenantId,role:'admin',mfa_verified:true,session_version:1,email:`${tenantId}@example.test`})
      .setProtectedHeader({alg:'HS256'}).setSubject('knowledge-admin').setAudience('app').setIssuedAt(Math.floor(now/1000))
      .setExpirationTime(Math.floor(now/1000)+3600).sign(new TextEncoder().encode(secret));
    return {mf,db,bucket:await mf.getR2Bucket('ATTACHMENTS_BUCKET'),token};
  }catch(error){await mf.dispose();throw error;}
}

async function request(f:Awaited<ReturnType<typeof fixture>>,tenantId:string,path:string){
  return f.mf.dispatchFetch(`http://runtime.test/api/knowledge${path}`,{headers:{Authorization:`Bearer ${await f.token(tenantId)}`}});
}
async function control(f:Awaited<ReturnType<typeof fixture>>,value?:Record<string,string>){
  const response=await f.mf.dispatchFetch('http://runtime.test/__knowledge-read-control',value
    ?{method:'POST',body:JSON.stringify(value)}:undefined);
  return response.json() as Promise<{r2Gets:number;r2Bytes:number;knowledgeRowsRead:number;knowledgeBusinessRows:number}>;
}
async function insertDocument(db:any,tenantId:string,id:string,title:string,filePath=`knowledge/${id}/body.md`){
  await db.prepare(`INSERT INTO knowledge_docs (tenant_id,id,title,file_path,status,tier) VALUES (?,?,?,?,'pending','answer')`)
    .bind(tenantId,id,title,filePath).run();
}

test('complete knowledge list and detail retain large tenant history with dynamic native D1 accounting and isolation',async t=>{
  const f=await fixture();try{
    for(let offset=0;offset<1_200;offset+=100)await f.db.batch(Array.from({length:100},(_,index)=>f.db.prepare(
      `INSERT INTO knowledge_docs (tenant_id,id,title,file_path,status,tier) VALUES (?,?,?,?, 'pending','answer')`)
      .bind('knowledge-a',`doc-${String(offset+index).padStart(4,'0')}`,`retained title ${'x'.repeat(180)}`,`knowledge/doc-${offset+index}/body.md`)));
    await insertDocument(f.db,'knowledge-a','shared','Tenant A');
    await insertDocument(f.db,'knowledge-b','shared','Tenant B');
    await insertDocument(f.db,'knowledge-b','foreign-only','Foreign');
    const counter=await f.db.prepare(`SELECT document_rows,projection_bytes,revision FROM knowledge_read_scan_counters WHERE tenant_id='knowledge-a'`)
      .first<{document_rows:number;projection_bytes:number;revision:number}>();assert.ok(counter);
    const envelope=knowledgeReadEnvelope('knowledge.article.list',{documentRows:counter.document_rows,projectionBytes:counter.projection_bytes,revision:counter.revision});
    const list=await request(f,'knowledge-a','/articles');assert.equal(list.status,200,await list.clone().text());
    const rows=await list.json() as {id:string}[];assert.equal(rows.length,1_201);assert.equal(rows.filter(row=>row.id==='shared').length,1);
    const measured=await control(f);assert.ok(measured.knowledgeRowsRead>0&&measured.knowledgeRowsRead<=envelope!.d1RowsRead!,
      `${measured.knowledgeRowsRead} <= ${envelope!.d1RowsRead}`);
    const detail=await request(f,'knowledge-a','/articles/shared');assert.equal(detail.status,200);assert.equal((await detail.json() as {title:string}).title,'Tenant A');
    assert.equal((await request(f,'knowledge-a','/articles/foreign-only')).status,404);
    t.diagnostic(`native complete list rows=${rows.length}, D1 rows_read=${measured.knowledgeRowsRead}, admitted=${envelope!.d1RowsRead}`);
  }finally{await f.mf.dispose();}
});

test('versioned and legacy content keep the response contract with conservative native R2 byte accounting',async t=>{
  const f=await fixture();try{
    const source='x'.repeat(10*1024*1024),path='knowledge/shared/body.md/versions/1';
    await insertDocument(f.db,'knowledge-a','shared','Large source',path);
    await f.db.prepare(`INSERT INTO knowledge_index_versions
      (tenant_id,document_id,version,file_path,tier,source_kind,state,chunk_count,source_bytes) VALUES ('knowledge-a','shared',1,?,'answer','document','preparing',0,?)`)
      .bind(path,source.length).run();
    await f.bucket.put(`knowledge-a/${path}`,source);
    const response=await request(f,'knowledge-a','/articles/shared/content');assert.equal(response.status,200,await response.clone().text());
    assert.equal((await response.json() as {content:string}).content.length,source.length);
    await insertDocument(f.db,'knowledge-a','legacy','Legacy','knowledge/legacy/body.md');
    await f.bucket.put('knowledge-a/knowledge/legacy/body.md','legacy content');
    const legacy=await request(f,'knowledge-a','/articles/legacy/content');assert.deepEqual(await legacy.json(),{content:'legacy content'});
    const measured=await control(f);assert.equal(measured.r2Gets,2);assert.equal(measured.r2Bytes,source.length+'legacy content'.length);
    t.diagnostic(`native R2 class-B gets=${measured.r2Gets}, returned source bytes=${measured.r2Bytes}`);
  }finally{await f.mf.dispose();}
});

for(const action of ['session','policy'] as const)test(`post-reservation ${action} change is rejected by the actual D1 read fence`,async()=>{
  const f=await fixture();try{
    await insertDocument(f.db,'knowledge-a','shared','Protected');await control(f,{beforeRead:action});
    const response=await request(f,'knowledge-a','/articles/shared');assert.equal(response.status,503,await response.clone().text());
    assert.deepEqual(await response.json(),{code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'});
    assert.equal((await control(f)).r2Gets,0);
  }finally{await f.mf.dispose();}
});

test('counter growth and immutable source changes after reservation fail closed before content is returned',async()=>{
  const f=await fixture();try{
    await insertDocument(f.db,'knowledge-a','shared','Protected','knowledge/shared/body.md/versions/1');
    await f.db.prepare(`INSERT INTO knowledge_index_versions
      (tenant_id,document_id,version,file_path,tier,source_kind,state,chunk_count,source_bytes) VALUES ('knowledge-a','shared',1,'knowledge/shared/body.md/versions/1','answer','document','preparing',0,7)`).run();
    await f.bucket.put('knowledge-a/knowledge/shared/body.md/versions/1','content');
    await control(f,{beforeRead:'growth'});
    assert.equal((await request(f,'knowledge-a','/articles')).status,503);
    await control(f,{beforeRead:'source'});
    assert.equal((await request(f,'knowledge-a','/articles/shared/content')).status,503);
    assert.equal((await control(f)).r2Gets,0);
  }finally{await f.mf.dispose();}
});

for(const action of ['policy','closure'] as const)test(`${action} authority is current immediately before R2`,async()=>{
  const f=await fixture();try{
    await insertDocument(f.db,'knowledge-a','shared','Protected','knowledge/shared/body.md/versions/1');
    await f.db.prepare(`INSERT INTO knowledge_index_versions
      (tenant_id,document_id,version,file_path,tier,source_kind,state,chunk_count,source_bytes) VALUES ('knowledge-a','shared',1,'knowledge/shared/body.md/versions/1','answer','document','preparing',0,7)`).run();
    await f.bucket.put('knowledge-a/knowledge/shared/body.md/versions/1','content');
    await control(f,{afterRead:action});
    assert.equal((await request(f,'knowledge-a','/articles/shared/content')).status,503);
    assert.equal((await control(f)).r2Gets,0);
  }finally{await f.mf.dispose();}
});

test('exhausted content admission has zero R2 effects',async()=>{
  const f=await fixture();try{
    await insertDocument(f.db,'knowledge-low','shared','Protected','knowledge/shared/body.md/versions/1');
    await f.db.prepare(`INSERT INTO knowledge_index_versions
      (tenant_id,document_id,version,file_path,tier,source_kind,state,chunk_count,source_bytes) VALUES ('knowledge-low','shared',1,'knowledge/shared/body.md/versions/1','answer','document','preparing',0,7)`).run();
    await f.bucket.put('knowledge-low/knowledge/shared/body.md/versions/1','content');
    assert.equal((await request(f,'knowledge-low','/articles/shared/content')).status,429);
    assert.equal((await control(f)).r2Gets,0);
  }finally{await f.mf.dispose();}
});
