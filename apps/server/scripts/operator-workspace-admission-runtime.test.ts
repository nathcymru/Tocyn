import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { OPERATOR_WORKSPACE_ENVELOPES, operatorWorkspaceEnvelope } from '../src/budgets/operator-workspace-admission.service';

const root = resolve(import.meta.dirname, '..');
const secret = 'synthetic-workspace-admission-secret-at-least-32-chars';
const dimensions = ['workerRequests','d1RowsRead','d1RowsWritten','r2ClassBOperations','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;

async function token() {
  return new SignJWT({ sub:'workspace-agent',role:'agent',tenant_id:'workspace-tenant',session_version:1,mfa_verified:true })
    .setProtectedHeader({alg:'HS256'}).setAudience('app').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

async function fixture(options: { workerLimit?: number; d1ReadLimit?: number; localBeta?: boolean } = {}) {
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
    const limitFor=(dimension:typeof dimensions[number])=>dimension==='workerRequests'?(options.workerLimit??10_000_000)
      :dimension==='d1RowsRead'?(options.d1ReadLimit??10_000_000):10_000_000;
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
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('workspace-tenant','population-race','Race','customer@example.test','workspace-group','dashboard')"),
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

test('population migration backfills historical drafts and maintains later deletion',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:`workspace-migration-${crypto.randomUUID()}`,modules:true,
    compatibilityDate:'2024-04-03',script:'export default {fetch(){return new Response("migration")}}',d1Databases:{DB:`workspace-migration-${crypto.randomUUID()}`}}]}));
  try{
    const db=await mf.getD1Database('DB');const migrations=join(root,'migrations');
    for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')&&name<'0054_').sort())
      await db.batch(splitSql(readFileSync(join(migrations,file),'utf8')).map(sql=>db.prepare(sql)));
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role) VALUES ('legacy-tenant','legacy-agent','legacy@example.test','agent')"),
      ...[0,1,2].map(index=>db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,source) VALUES ('legacy-tenant',?,'Legacy','customer@example.test','dashboard')").bind(`legacy-${index}`)),
      ...[0,1,2].map(index=>db.prepare(`INSERT INTO operator_drafts
        (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision)
        VALUES ('legacy-tenant','legacy-agent',?,'00000000-0000-4000-a000-000000000001',1,'public','body','plain','[]','[]',0)`).bind(`legacy-${index}`)),
    ]);
    await db.batch(splitSql(readFileSync(join(migrations,'0054_operator_workspace_admission_indexes.sql'),'utf8')).map(sql=>db.prepare(sql)));
    assert.equal((await db.prepare("SELECT draft_count FROM operator_draft_actor_population WHERE tenant_id='legacy-tenant' AND user_id='legacy-agent'").first<{draft_count:number}>())?.draft_count,3);
    await db.prepare("DELETE FROM operator_drafts WHERE tenant_id='legacy-tenant' AND user_id='legacy-agent' AND ticket_id='legacy-0'").run();
    assert.equal((await db.prepare("SELECT draft_count FROM operator_draft_actor_population WHERE tenant_id='legacy-tenant' AND user_id='legacy-agent'").first<{draft_count:number}>())?.draft_count,2);
  }finally{await mf.dispose();}
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
    assert.equal((await f.db.prepare("SELECT count(*) AS n FROM operator_draft_actor_population WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'").first<{n:number}>())?.n,0,'the atomic delete removes the zero population row');
    const measured=await control(f);assert.equal(measured.cache.operations,11,'every route execution, including CAS conflicts, owns one spend');
  }finally{await f.mf.dispose();}
});

test('state read retry keeps two authority assertions and the successful clear inside four writes',async context=>{
  const f=await fixture();try{
    await f.db.prepare(`INSERT INTO operator_workspace_state
      (tenant_id,user_id,revision,view_key,sort_key,filters,list_query,list_anchor,selected_ticket_id,panel)
      VALUES ('workspace-tenant','workspace-agent',1,'all','updated_desc','{}','','','hidden-ticket','conversation')`).run();
    await f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('workspace-tenant','hidden-ticket','Hidden','customer@example.test','hidden-group','dashboard')").run();
    await control(f,{reset:true,beforeStateClear:true});
    const response=await request(f,'/api/workspace/state');assert.equal(response.status,200,await response.clone().text());
    const state=await response.json() as {revision:number;selectedTicketId:string|null};
    assert.deepEqual({revision:state.revision,selectedTicketId:state.selectedTicketId},{revision:3,selectedTicketId:null});
    const measured=await control(f);assert.equal(measured.workspaceBatches,4,'read, lost clear, retry read and successful clear are all fenced');
    assert.ok(measured.workspaceRowsWritten>0 && measured.workspaceRowsWritten<=(OPERATOR_WORKSPACE_ENVELOPES['workspace.state.read'].d1RowsWritten??0),JSON.stringify(measured));
    context.diagnostic(JSON.stringify({fixture:'native-d1-state-read-cas-retry',measured}));
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

test('final workspace list rejects population growth beyond its admitted dynamic reservation',async()=>{
  const f=await fixture();try{
    await control(f,{beforeWorkspaceBatch:'population'});
    const response=await request(f,'/api/workspace/drafts?limit=50');assert.equal(response.status,503,await response.clone().text());
    assert.equal((await f.db.prepare("SELECT draft_count FROM operator_draft_actor_population WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'").first<{draft_count:number}>())?.draft_count,1);
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

async function insertAllMissOverflow(f:Awaited<ReturnType<typeof fixture>>, total:number) {
  for(let base=0;base<total;base+=500){
    const last=Math.min(499,total-base-1);
    await f.db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<?)
      INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source)
      SELECT 'workspace-tenant',printf('overflow-%04d',?+n),'Overflow','customer@example.test',
        CASE WHEN (?+n)%2=0 THEN 'hidden-group' ELSE 'workspace-group' END,'dashboard' FROM seq`).bind(last,base,base).run();
  }
  await f.db.prepare(`INSERT INTO operator_drafts
    (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at,updated_at)
    SELECT tenant_id,'workspace-agent',id,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
      1,'public','body','plain','[]','[]',0,CASE WHEN CAST(substr(id,-1) AS INTEGER)%2=0 THEN '2099-01-01T00:00:00.000Z' ELSE '2000-01-01T00:00:00.000Z' END,
      '2026-09-11T00:00:00.000Z' FROM tickets WHERE tenant_id='workspace-tenant' AND id LIKE 'overflow-%'`).run();
}

test('dynamic list reservation rejects before workspace work when population cost exceeds policy',async()=>{
  const f=await fixture({d1ReadLimit:5_000});try{
    await insertAllMissOverflow(f,400);await control(f,{reset:true});
    const response=await request(f,'/api/workspace/drafts?limit=50');assert.equal(response.status,429,await response.clone().text());
    assert.deepEqual(await response.json(),{code:'budget_exhausted',error:'Configured budget capacity is exhausted'});
    const measured=await control(f);assert.equal(measured.workspaceBatches,0);assert.ok((operatorWorkspaceEnvelope('workspace.drafts.list',400).d1RowsRead??0)>5_000);
  }finally{await f.mf.dispose();}
});

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

test('more than 2,560 all-miss drafts return the complete visible result inside dynamic admission',async context=>{
  const f=await fixture({localBeta:true});try{
    const seeded=2_801;await insertAllMissOverflow(f,seeded);
    await f.db.batch([
      f.db.prepare("INSERT INTO tickets (tenant_id,id,subject,customer_email,group_id,source) VALUES ('workspace-tenant','zz-visible-overflow','Visible','customer@example.test','workspace-group','dashboard')"),
      f.db.prepare(`INSERT INTO operator_drafts
        (tenant_id,user_id,ticket_id,generation,revision,mode,body,body_format,attachments,mentioned_user_ids,base_conversation_revision,expires_at,updated_at)
        VALUES ('workspace-tenant','workspace-agent','zz-visible-overflow','00000000-0000-4000-a000-000000000099',1,'public','body','plain','[]','[]',0,'2099-01-01T00:00:00.000Z','2026-09-11T00:00:00.000Z')`),
    ]);
    assert.equal((await f.db.prepare("SELECT draft_count FROM operator_draft_actor_population WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'").first<{draft_count:number}>())?.draft_count,seeded+1);
    await control(f,{reset:true});
    const response=await request(f,'/api/workspace/drafts?limit=50');assert.equal(response.status,200,await response.clone().text());
    const page=await response.json() as {items:{ticketId:string}[];next:string|null};assert.deepEqual(page.items.map(item=>item.ticketId),['zz-visible-overflow']);assert.equal(page.next,null);
    const measured=await control(f);assert.equal(measured.workspaceBatches,2,'bounded cleanup and the complete dynamically admitted list each run once');
    const admitted=operatorWorkspaceEnvelope('workspace.drafts.list',seeded+1);
    assert.ok(measured.workspaceRowsRead<=(admitted.d1RowsRead??0),JSON.stringify({measured,admitted}));
    assert.ok(measured.workspaceRowsWritten<=(OPERATOR_WORKSPACE_ENVELOPES['workspace.drafts.list'].d1RowsWritten??0),JSON.stringify(measured));
    assert.equal((await f.db.prepare("SELECT draft_count FROM operator_draft_actor_population WHERE tenant_id='workspace-tenant' AND user_id='workspace-agent'").first<{draft_count:number}>())?.draft_count,seeded+1-100);
    assert.ok(seeded+1-100>2_560);
    context.diagnostic(JSON.stringify({fixture:'native-d1-workspace-all-miss-dynamic',seeded:seeded+1,afterCleanup:seeded+1-100,admitted,measured}));
  }finally{await f.mf.dispose();}
});
