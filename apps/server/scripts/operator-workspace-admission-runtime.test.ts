import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { OPERATOR_WORKSPACE_ENVELOPES } from '../src/budgets/operator-workspace-admission.service';

const root = resolve(import.meta.dirname, '..');
const secret = 'synthetic-workspace-admission-secret-at-least-32-chars';
const dimensions = ['workerRequests','d1RowsRead','d1RowsWritten','r2ClassBOperations','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;

async function token() {
  return new SignJWT({ sub:'workspace-agent',role:'agent',tenant_id:'workspace-tenant',session_version:1,mfa_verified:true })
    .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function fixture(options: { workerLimit?: number; localBeta?: boolean } = {}) {
  const now = Date.now();
  const bundle = await build({ entryPoints:[resolve(import.meta.dirname,'operator-workspace-admission-runtime-entry.ts')],bundle:true,
    format:'esm',platform:'neutral',external:['cloudflare:workers','node:crypto'],write:false });
  const mf = new Miniflare(convertV4MiniflareOptions({workers:[{name:`workspace-proof-${crypto.randomUUID()}`,modules:true,
    compatibilityDate:'2024-04-03',compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
    bindings:{BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',DISABLE_RATE_LIMIT:'true',JWT_SECRET:secret,
      ...(options.localBeta?{ENVIRONMENT:'local',LOCAL_BETA_ENABLED:'true'}:{})},
    d1Databases:{DB:`workspace-${crypto.randomUUID()}`},r2Buckets:{ATTACHMENTS_BUCKET:`workspace-${crypto.randomUUID()}`},
    durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'},unsafeEphemeralDurableObjects:true,
  }]}));
  try {
    const db=await mf.getD1Database('DB');
    for(const file of readdirSync(join(root,'migrations')).filter(name=>name.endsWith('.sql')).sort())
      await db.batch(splitSql(readFileSync(join(root,'migrations',file),'utf8')).map(sql=>db.prepare(sql)));
    const limitFor=(dimension:typeof dimensions[number])=>dimension==='workerRequests'?(options.workerLimit??10_000_000):10_000_000;
    const limits=Object.fromEntries(dimensions.map(d=>[d,limitFor(d)]));
    const policy={schemaVersion:1,policyId:'workspace-policy',revision:1,deploymentId:'workspace-deployment',mode:'conservative',
      catalogueVersion:'synthetic-workspace',maxGrantLifetimeMs:60_000,budgets:dimensions.map(d=>({dimension:d,limit:limitFor(d),
        allocationId:`workspace-${d}`,recoveryPercent:20,provenance:'owner-allocation',window:{kind:'interval',id:'workspace-window',startsAt:now-1000,endsAt:now+60_000}}))};
    const restriction={schemaVersion:1,tenantId:'workspace-tenant',ownerPolicyId:'workspace-policy',ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]};
    const seed=[
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('workspace-deployment',1,'active',?)").bind(now),
      db.prepare("INSERT INTO budget_owner_policies VALUES ('workspace-deployment','workspace-policy',1,1,'workspace-coordinator',64,30000,?)").bind(JSON.stringify(policy)),
      db.prepare("INSERT INTO budget_tenant_allocations VALUES ('workspace-deployment','workspace-tenant','workspace-policy',1,1,'workspace-namespace',?,'active')").bind(JSON.stringify(restriction)),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('workspace-tenant','workspace-agent','agent@example.test','agent',1,1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,session_version,mfa_enabled) VALUES ('workspace-tenant','other-agent','other@example.test','agent',1,1)"),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('workspace-tenant','workspace-group','Workspace')"),
      db.prepare("INSERT INTO groups (tenant_id,id,name) VALUES ('workspace-tenant','hidden-group','Hidden')"),
      db.prepare("INSERT INTO user_groups VALUES ('workspace-tenant','workspace-agent','workspace-group')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('workspace-tenant','draft-ticket','Draft','customer@example.test','workspace-group','dashboard')"),
    ];
    if(options.localBeta) seed.push(
      db.prepare("INSERT INTO local_beta_runs(run_id,ticket_limit,mutation_limit,recovery_reserve,upload_limit) VALUES ('workspace-run',100,1000,100,100)"),
      db.prepare("INSERT INTO local_beta_tenants VALUES ('workspace-run','workspace-tenant')"),
      db.prepare("INSERT INTO local_beta_tenants VALUES ('workspace-run','workspace-other')"),
      db.prepare("INSERT INTO local_beta_invitations VALUES ('workspace-run','workspace-tenant','staff','workspace-agent')"),
      db.prepare("INSERT INTO local_beta_policy(singleton,run_id,revision,state) VALUES (1,'workspace-run',1,'running')"),
      db.prepare("INSERT INTO local_beta_operator_receipts(revision,action,run_id,prior_run_id,prior_tickets,prior_mutations,prior_upload_attempts) VALUES (1,'initialize','workspace-run',NULL,0,0,0)"),
    );
    await db.batch(seed);
    const bucket=await mf.getR2Bucket('ATTACHMENTS_BUCKET') as any;
    await bucket.put('workspace-tenant/agent-attachments/workspace-agent/file.txt','synthetic attachment',{httpMetadata:{contentType:'text/plain'}});
    return {mf,db,staff:await token()};
  } catch(error) { await mf.dispose(); throw error; }
}

function request(f:Awaited<ReturnType<typeof fixture>>,path:string,method='GET',body?:unknown) {
  return f.mf.dispatchFetch(`http://runtime.test${path}`,{method,headers:{authorization:`Bearer ${f.staff}`,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function control(f:Awaited<ReturnType<typeof fixture>>,input?:object) {
  return (await (await f.mf.dispatchFetch('http://runtime.test/__workspace-control',input?{method:'POST',body:JSON.stringify(input)}:undefined)).json()) as {
    workspaceBatches:number;workspaceRowsRead:number;workspaceRowsWritten:number;r2Gets:number;cache:{operations:number};
  };
}
const draft=(expectedRevision=0,expectedGeneration:string|null=null)=>({expectedRevision,expectedGeneration,mode:'public',body:'Synthetic draft',bodyFormat:'plain',
  attachments:[{storageKey:'agent-attachments/workspace-agent/file.txt',filename:'file.txt'}],mentionedUserIds:[]});

test('workspace envelopes include cleanup and the complete ten-reference attachment pass',()=>{
  assert.equal(OPERATOR_WORKSPACE_ENVELOPES['workspace.draft.write'].r2ClassBOperations,10);
  assert.equal(OPERATOR_WORKSPACE_ENVELOPES['workspace.draft.write'].d1RowsWritten,1_024,
    'workspace mutations retain the canonical attempt ceiling');
  assert.ok((OPERATOR_WORKSPACE_ENVELOPES['workspace.drafts.list'].d1RowsWritten??0)>=100);
  assert.ok((OPERATOR_WORKSPACE_ENVELOPES['workspace.draft.read'].d1RowsWritten??0)>=100);
});

test('workspace routes spend independently and preserve exact CAS, rebase and retry results',async()=>{
  const f=await fixture();try{
    let response=await request(f,'/api/workspace/theme-preference');assert.equal(response.status,200,await response.clone().text());
    response=await request(f,'/api/workspace/theme-preference','PUT',{expectedRevision:0,mode:'dark'});assert.equal(response.status,200);
    response=await request(f,'/api/workspace/theme-preference','PUT',{expectedRevision:0,mode:'light'});assert.equal(response.status,409);
    const state={expectedRevision:0,view:'all',sort:'updated_desc',filters:{},listQuery:'',listAnchor:'',selectedTicketId:'draft-ticket',panel:'conversation'};
    response=await request(f,'/api/workspace/state','PUT',state);assert.equal(response.status,200,await response.clone().text());
    response=await request(f,'/api/workspace/state','PUT',state);assert.equal(response.status,409);
    const beforeDraft=await control(f);
    response=await request(f,'/api/workspace/drafts/draft-ticket','PUT',draft());assert.equal(response.status,200,await response.clone().text());
    const saved=await response.json() as {generation:string;revision:number};
    const beforeRetry=await control(f);assert.ok(beforeRetry.workspaceRowsWritten-beforeDraft.workspaceRowsWritten>0);
    assert.ok(beforeRetry.workspaceRowsWritten-beforeDraft.workspaceRowsWritten<=(OPERATOR_WORKSPACE_ENVELOPES['workspace.draft.write'].d1RowsWritten??0),
      'the native write, including the accepted draft indexes, stays inside the canonical attempt ceiling');
    response=await request(f,'/api/workspace/drafts/draft-ticket','PUT',draft());assert.equal(response.status,409);
    const afterRetry=await control(f);assert.equal(afterRetry.r2Gets,beforeRetry.r2Gets+1,'a fresh HTTP retry spends its bounded attachment validation');
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_drafts WHERE tenant_id='workspace-tenant' AND ticket_id='draft-ticket'").first<{n:number}>())?.n,1);
    await f.db.prepare("INSERT INTO conversation_events (tenant_id,id,ticket_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts) VALUES ('workspace-tenant','10000000-0000-4000-8000-000000000001','draft-ticket',1,'message.reply','staff','workspace-agent','mfa-staff','dashboard','public','{}')").run();
    response=await request(f,'/api/workspace/drafts/draft-ticket/rebase','POST',{expectedGeneration:saved.generation,expectedRevision:saved.revision,expectedReviewedConversationRevision:0});assert.equal(response.status,409);
    response=await request(f,'/api/workspace/drafts/draft-ticket/rebase','POST',{expectedGeneration:saved.generation,expectedRevision:saved.revision,expectedReviewedConversationRevision:1});assert.equal(response.status,200);
    const rebased=await response.json() as {generation:string;revision:number};
    response=await request(f,`/api/workspace/drafts/draft-ticket?generation=${rebased.generation}&revision=${saved.revision}`,'DELETE');assert.equal(response.status,409);
    response=await request(f,`/api/workspace/drafts/draft-ticket?generation=${rebased.generation}&revision=${rebased.revision}`,'DELETE');assert.equal(response.status,204);
    const measured=await control(f);assert.equal(measured.cache.operations,11,'every route execution, including CAS conflicts, owns one spend');
  }finally{await f.mf.dispose();}
});

test('capacity rejects before attachment storage and leaves workspace rows unchanged',async()=>{
  const f=await fixture({workerLimit:1});try{
    const response=await request(f,'/api/workspace/drafts/draft-ticket','PUT',draft());
    assert.equal(response.status,429);assert.deepEqual(await response.json(),{code:'budget_exhausted',error:'Configured budget capacity is exhausted'});
    const measured=await control(f);assert.equal(measured.r2Gets,0);assert.equal(measured.workspaceBatches,0);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM operator_drafts').first<{n:number}>())?.n,0);
  }finally{await f.mf.dispose();}
});

for(const change of ['session','role','mfa','membership','policy'] as const)test(`atomic workspace write rejects ${change} change after admission`,async()=>{
  const f=await fixture();try{
    await control(f,{beforeWorkspaceBatch:change});
    const response=await request(f,'/api/workspace/drafts/draft-ticket','PUT',{...draft(),attachments:[]});
    assert.equal(response.status,503,await response.clone().text());
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM operator_drafts').first<{n:number}>())?.n,0);
  }finally{await f.mf.dispose();}
});

test('session loss during attachment validation cannot cross the final atomic fence',async()=>{
  const f=await fixture();try{
    await control(f,{beforeR2Get:'session'});
    const response=await request(f,'/api/workspace/drafts/draft-ticket','PUT',draft());
    assert.equal(response.status,503,await response.clone().text());
    const measured=await control(f);assert.equal(measured.r2Gets,1,'admission precedes the bounded attachment pass');
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM operator_drafts').first<{n:number}>())?.n,0);
  }finally{await f.mf.dispose();}
});

for(const change of ['session','mfa','membership','policy'] as const)test(`final workspace read rejects ${change} change after admission`,async()=>{
  const f=await fixture();try{
    await f.db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at)
      VALUES ('workspace-tenant','workspace-agent','draft-ticket',?,1,'public','private draft','plain','[]','[]',0,NULL)`).bind(crypto.randomUUID()).run();
    await control(f,{beforeWorkspaceBatch:change});
    const path=change==='membership'?'/api/workspace/drafts/draft-ticket'
      : change==='policy'?'/api/workspace/drafts?limit=50':'/api/workspace/theme-preference';
    const response=await request(f,path);
    assert.equal(response.status,503,await response.clone().text());
  }finally{await f.mf.dispose();}
});

async function insertNoise(f:Awaited<ReturnType<typeof fixture>>) {
  const rows:{id:string;group:string;actor:string;expired:boolean}[]=[];
  for(let i=0;i<150;i++)rows.push({id:`a-exp-${String(i).padStart(3,'0')}`,group:'workspace-group',actor:'workspace-agent',expired:true});
  for(let i=0;i<150;i++)rows.push({id:`b-other-${String(i).padStart(3,'0')}`,group:'workspace-group',actor:'other-agent',expired:true});
  for(let i=0;i<120;i++)rows.push({id:`m-hidden-${String(i).padStart(3,'0')}`,group:'hidden-group',actor:'workspace-agent',expired:false});
  for(let i=0;i<55;i++)rows.push({id:`z-visible-${String(i).padStart(3,'0')}`,group:'workspace-group',actor:'workspace-agent',expired:false});
  for(let offset=0;offset<rows.length;offset+=50){
    const chunk=rows.slice(offset,offset+50);
    await f.db.batch(chunk.flatMap(row=>[
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('workspace-tenant',?,?,'customer@example.test',?,'dashboard')").bind(row.id,row.id,row.group),
      f.db.prepare(`INSERT INTO operator_drafts (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at,updated_at)
        VALUES ('workspace-tenant',?,?,?,1,'public','body','plain','[]','[]',0,?,?)`).bind(row.actor,row.id,crypto.randomUUID(),row.expired?'2000-01-01T00:00:00.000Z':'2099-01-01T00:00:00.000Z',row.expired?'2000-01-01T00:00:00.000Z':'2026-09-11T00:00:00.000Z'),
    ]));
  }
}

test('native noisy pages stay full while 48-hour actor cleanup remains bounded to 100 rows',async context=>{
  const f=await fixture({localBeta:true});try{
    await insertNoise(f);
    await control(f,{reset:true});
    let response=await request(f,'/api/workspace/drafts?limit=50');assert.equal(response.status,200,await response.clone().text());
    let page=await response.json() as {items:{ticketId:string}[];next:string|null};assert.equal(page.items.length,50);assert.ok(page.items.every(item=>item.ticketId.startsWith('z-visible-')));assert.ok(page.next);
    let measured=await control(f);const firstMeasured={...measured};assert.ok(measured.workspaceRowsWritten>=100);
    assert.ok(measured.workspaceRowsWritten<=(OPERATOR_WORKSPACE_ENVELOPES['workspace.drafts.list'].d1RowsWritten??0),JSON.stringify(measured));
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_drafts WHERE user_id='workspace-agent' AND expires_at<='2000-01-02'").first<{n:number}>())?.n,50);
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_drafts WHERE user_id='other-agent' AND expires_at<='2000-01-02'").first<{n:number}>())?.n,150);
    await control(f,{reset:true});
    response=await request(f,`/api/workspace/drafts?limit=50&after=${page.next}`);assert.equal(response.status,200);
    page=await response.json() as typeof page;assert.equal(page.items.length,5);assert.equal(page.next,null);
    measured=await control(f);assert.ok(measured.workspaceRowsWritten<=(OPERATOR_WORKSPACE_ENVELOPES['workspace.drafts.list'].d1RowsWritten??0),JSON.stringify(measured));
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_drafts WHERE user_id='workspace-agent' AND expires_at<='2000-01-02'").first<{n:number}>())?.n,0);
    const cleanupPlan=(await f.db.prepare(`EXPLAIN QUERY PLAN SELECT rowid FROM operator_drafts WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'
      AND ((expires_at IS NOT NULL AND expires_at<='2026-09-11T00:00:00.000Z') OR (expires_at IS NULL AND updated_at<='2026-09-09T00:00:00.000Z')) ORDER BY expires_at LIMIT 100`).all<{detail:string}>()).results;
    const pagePlan=(await f.db.prepare("EXPLAIN QUERY PLAN SELECT ticket_id FROM operator_drafts WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent' AND ticket_id>'' ORDER BY ticket_id LIMIT 51").all<{detail:string}>()).results;
    assert.match((cleanupPlan as {detail:string}[]).map(row=>row.detail).join('\n'),/idx_operator_drafts_actor_expiry|idx_operator_drafts_actor_ticket/);
    assert.match((pagePlan as {detail:string}[]).map(row=>row.detail).join('\n'),/idx_operator_drafts_actor_ticket/);
    context.diagnostic(JSON.stringify({fixture:'native-d1-workspace-noise',firstPage:firstMeasured,secondPage:measured,
      seeded:{actorExpired:150,otherActorExpired:150,hidden:120,visible:55}}));
  }finally{await f.mf.dispose();}
});
