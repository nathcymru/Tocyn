import assert from 'node:assert/strict';
import test from 'node:test';
import { withTwoTenantFixture } from './local-tenant-fixture';
import { initializeLocalBetaFixture } from './local-beta-fixture';

test('capacity HTTP contracts fence configuration and all admitted assignment surfaces',async()=>{
 await withTwoTenantFixture(async f=>{
  const tenantId=f.principals.operatorA.tenantId;
  const agent=await f.createAgentSession(tenantId);
  const ownerId=crypto.randomUUID();
  await f.db.prepare("INSERT INTO users(tenant_id,id,email,role,session_version,mfa_enabled) VALUES (?,?,'capacity-owner@example.test','agent',1,1)").bind(tenantId,ownerId).run();
  const challenge=(await (await f.login('operatorA')).json<{token:string}>()).token;
  const token=(await (await f.request('/api/auth/mfa/verify',{method:'POST',token:challenge,body:{code:f.currentMfaCode('operatorA')}})).json<{token:string}>()).token;
  const key=await f.createScopedApiKey('operatorA',['tickets:read','tickets:write']);
  await initializeLocalBetaFixture(f,{runId:'capacity-http',tenants:[tenantId,f.principals.operatorB.tenantId],
   invitations:[...Object.values(f.principals).map(p=>({tenantId:p.tenantId,id:p.localId,kind:p.role==='customer'?'customer' as const:'staff' as const})),
    {tenantId,id:agent.id,kind:'staff'},{tenantId,id:key.id,kind:'api-key'}],limits:{ticketLimit:20,mutationLimit:100,recoveryReserve:10,uploadLimit:5}});
  await f.enableCombinedTicketAdmission();
  const path=`/api/operators/${ownerId}/capacity`;
  assert.equal((await f.request(`/api/operators/${agent.id}/capacity`,{token:agent.token})).status,200);
  assert.equal((await f.request(`/api/operators/${f.principals.operatorA.localId}/capacity`,{token:agent.token})).status,403);
  assert.equal((await f.request(path,{token:agent.token,method:'PUT',body:{expectedRevision:0,availability:'available',assignmentCeiling:1}})).status,403);
  const configure=async(revision:number,ceiling:number,availability='available')=>f.request(path,{token,method:'PUT',body:{expectedRevision:revision,availability,assignmentCeiling:ceiling}});
  assert.equal((await configure(Number.MAX_SAFE_INTEGER,1)).status,400);
  assert.equal((await configure(0,1)).status,200);
  const assignments=await Promise.all([
   f.request('/api/tickets/fixture-ticket/responsible-owner',{method:'PATCH',token,idempotencyKey:'capacity-staff',body:{ownerId,expectedOwnerId:null}}),
   f.request('/api/v1/tickets',{method:'POST',apiKey:key.apiKey,idempotencyKey:'capacity-api',body:{subject:'Synthetic race',customer_email:f.principals.customerA.email,assigned_to:ownerId}}),
  ]);
  assert.equal(assignments.filter(r=>r.status===200||r.status===201).length,1,JSON.stringify(await Promise.all(assignments.map(async r=>({status:r.status,code:(await r.clone().json<{code?:string}>()).code})))));
  const count=await f.db.prepare("SELECT count(*) AS n FROM tickets WHERE tenant_id=? AND assigned_to=? AND status IN('open','pending')").bind(tenantId,ownerId).first<{n:number}>();
  assert.equal(count?.n,1);
  assert.equal((await configure(1,0,'unavailable')).status,200);
  await f.db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source) VALUES (?,'capacity-unassigned','Synthetic','unassigned@example.test','dashboard')").bind(tenantId).run();
  assert.notEqual((await f.request('/api/v1/tickets/capacity-unassigned',{method:'PATCH',apiKey:key.apiKey,idempotencyKey:'capacity-api-normal-update',body:{assigned_to:ownerId}})).status,200);
  const before=(await f.db.prepare('SELECT count(*) AS n FROM tickets WHERE tenant_id=?').bind(tenantId).first<{n:number}>())!.n;
  assert.notEqual((await f.request('/api/tickets',{method:'POST',token,idempotencyKey:'capacity-staff-create',body:{subject:'Denied',customer_email:f.principals.customerA.email,body:'Synthetic',assigned_to:ownerId}})).status,201);
  assert.notEqual((await f.request('/api/v1/tickets/fixture-ticket',{method:'PATCH',apiKey:key.apiKey,idempotencyKey:'capacity-api-update',body:{assigned_to:ownerId,capacityOverride:{reason:'Must not be accepted'}}})).status,200);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM tickets WHERE tenant_id=?').bind(tenantId).first<{n:number}>())?.n,before);
  const own=await f.request(path,{token});assert.equal(own.status,200);
  assert.equal((await own.json<{currentWork:number}>()).currentWork,1);
 });
});
