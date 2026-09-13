import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { Env } from '../src/bindings';
import type { TenantRequestDeps } from '../src/middleware/tenant.middleware';
import type { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
import type { InboundIdentity } from '../src/services/email/inbound-identity';
import { createSystemTenantScope } from '../src/auth/scope';
import { BudgetAuthorityRepository } from '../src/repositories/budget-authority.repository';
import { InboundEmailReceiptRepository, type InboundClaim } from '../src/repositories/inbound-email-receipt.repository';
import { admitInboundAttempt, settleInboundAttempt } from '../src/budgets/inbound-admission.service';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import { splitSql } from './split-sql';

const root=resolve(import.meta.dirname,'..');
// Test policy only: this is not the complete inbound composition envelope.
const business={workerRequests:1,d1RowsRead:8192,d1RowsWritten:256,logEvents:136};
function identity(tenant:string,source:string):InboundIdentity {
  return {from:'sender@example.invalid',to:`support-${tenant}@example.invalid`,subject:'Synthetic',messageId:'<synthetic@example.invalid>',rawSize:1,
    sourceHash:source,envelopeHash:'a'.repeat(64)};
}

test('inbound adapter uses real DO reservations and durable receipt grant links',async t=>{
  const bundled=await build({entryPoints:[resolve(import.meta.dirname,'budget-coordinator-do-runtime-entry.ts')],bundle:true,
    format:'esm',platform:'neutral',external:['cloudflare:workers'],write:false});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2024-04-03',
    d1Databases:{DB:'inbound-real-admission'},durableObjects:{BUDGET_COORDINATOR_DO:'BudgetCoordinatorDO',BUDGET_GRANT_HOLDER_DO:'BudgetGrantHolderDO'},unsafeEphemeralDurableObjects:true}));
  apiTicketBudgetCache.discardForTrustedRuntime();
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const name of readdirSync(join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root,'migrations',name),'utf8')).map(sql=>db.prepare(sql)));
    }
    const dimensions=['workerRequests','d1RowsRead','d1RowsWritten','doRequests','doRowsRead','doRowsWritten','logEvents'] as const;
    const owner={schemaVersion:1,policyId:'inbound-owner',revision:1,deploymentId:'inbound-runtime',mode:'conservative',catalogueVersion:'synthetic',maxGrantLifetimeMs:60_000,
      budgets:dimensions.map(dimension=>({dimension,allocationId:`inbound-${dimension}`,limit:200_000_000,recoveryPercent:20,provenance:'owner-allocation',
        window:{kind:'interval',id:'inbound-window',startsAt:Date.now()-1_000,endsAt:Date.now()+3_600_000}}))};
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('inbound-runtime',1,'active',?)").bind(Date.now()),
      db.prepare("INSERT INTO budget_owner_policies VALUES ('inbound-runtime','inbound-owner',1,1,'inbound-owner-coordinator',64,60000,?)").bind(JSON.stringify(owner)),
      ...['a','b','empty'].flatMap(tenant=>{
        const limits=Object.fromEntries(owner.budgets.map(b=>[b.dimension,tenant==='empty'&&b.dimension==='workerRequests'?0:b.limit]));
        const restriction={schemaVersion:1,tenantId:tenant,ownerPolicyId:owner.policyId,ownerPolicyRevision:1,revision:1,mode:'conservative',limits,disabledFeatures:[]};
        return [db.prepare("INSERT INTO budget_tenant_allocations VALUES ('inbound-runtime',?,'inbound-owner',1,1,?,?,'active')").bind(tenant,`inbound-${tenant}`,JSON.stringify(restriction)),
          db.prepare('INSERT INTO support_emails(tenant_id,id,email_address,normalized_email) VALUES (?,?,?,?)').bind(tenant,'mailbox',`support-${tenant}@example.invalid`,`support-${tenant}@example.invalid`)];
      }),
      db.prepare('CREATE TABLE synthetic_inbound_admission_effects(tenant_id TEXT,id TEXT,PRIMARY KEY(tenant_id,id))'),
    ]);
    const namespace=await mf.getDurableObjectNamespace('BUDGET_COORDINATOR_DO') as unknown as DurableObjectNamespace;
    const scope=(tenant:string)=>createSystemTenantScope({tenantId:tenant,actor:'inbound-email'});
    const deps=(tenant:string)=>({scope:scope(tenant),repositories:{budgetAuthority:new BudgetAuthorityRepository(db,scope(tenant))}} as unknown as TenantRequestDeps);
    const env={BUDGET_ADMISSION_POLICY:'ticket-mutations-v1',BUDGET_COORDINATOR_DO:namespace} as Env;
    const admit=(tenant:string,source:string,attempt=1)=>admitInboundAttempt({env,deps:deps(tenant),identity:identity(tenant,source),attempt,business,now:Date.now});
    const repo=(tenant:string)=>new InboundEmailReceiptRepository(db,scope(tenant));
    const requireAdmission=async(tenant:string,source:string,attempt=1)=>{
      const admission=await admit(tenant,source,attempt);assert.equal(admission.status,'admitted',JSON.stringify(admission));
      if(admission.status!=='admitted')throw new Error('Admission denied');
      return {sourceHash:source,envelopeHash:'a'.repeat(64),recipient:identity(tenant,source).to,attempt,token:crypto.randomUUID(),authority:admission.authority} satisfies InboundClaim;
    };
    const coordinator=(receipt:InboundClaim)=>namespace.get(namespace.idFromName(receipt.authority.grant!.aggregateId)) as unknown as BudgetCoordinatorDO;
    const grants=async(receipt:InboundClaim)=>(await coordinator(receipt).inspectForTrustedRuntime()).tenantStates.flatMap(tenant=>tenant.grants);
    const ready=async(tenant:string,receipt:InboundClaim)=>{await repo(tenant).begin(receipt);await repo(tenant).prepare(receipt,'b'.repeat(64));await repo(tenant).planArtifacts(receipt,[]);};
    const effectCount=async()=>(await db.prepare('SELECT count(*) AS n FROM synthetic_inbound_admission_effects').first<{n:number}>())!.n;
    const original=await requireAdmission('a','1'.repeat(64));
    await t.test('real reservation links to its receipt and exact operation replay adds no charge or effects',async()=>{
      const before=await grants(original);assert.ok(before.some(g=>g.reservationId===original.authority.grant!.reservationId&&g.accounted.workerRequests!>0));
      await ready('a',original);
      const link=await db.prepare('SELECT reservation_id,holder_id,operation_id FROM inbound_email_attempts WHERE tenant_id=? AND source_hash=?').bind('a',original.sourceHash).first();
      assert.deepEqual(link,{reservation_id:original.authority.grant!.reservationId,holder_id:original.authority.grant!.holderId,operation_id:original.authority.operationId});
      const replay=await requireAdmission('a',original.sourceHash);
      assert.equal(replay.authority.grant!.reservationId,original.authority.grant!.reservationId);
      assert.equal(replay.authority.operationId,original.authority.operationId);assert.deepEqual(await grants(original),before);
      await repo('a').finish(original,'committed',[db.prepare("INSERT INTO synthetic_inbound_admission_effects VALUES ('a','once')")]);
      await assert.rejects(repo('a').begin(replay));assert.equal(await effectCount(),1);
      settleInboundAttempt(original.authority,'committed',Date.now());settleInboundAttempt(replay.authority,'committed',Date.now());
      assert.deepEqual(await grants(original),before,'local settlement is not central release evidence');
    });
    await t.test('identical synthetic source hashes in different tenants have independent actual grants and receipts',async()=>{
      const other=await requireAdmission('b',original.sourceHash);assert.notEqual(other.authority.grant!.reservationId,original.authority.grant!.reservationId);
      await ready('b',other);await repo('b').finish(other,'committed',[db.prepare("INSERT INTO synthetic_inbound_admission_effects VALUES ('b','once')")]);
      assert.equal((await repo('a').find(original.sourceHash))?.state,'committed');assert.equal((await repo('b').find(original.sourceHash))?.state,'committed');
      assert.equal(await effectCount(),2);settleInboundAttempt(other.authority,'committed',Date.now());
    });
    await t.test('unknown settlement keeps original liability while recovery attempts use bounded recovery authority',async()=>{
      const uncertain=await requireAdmission('a','2'.repeat(64));await ready('a',uncertain);await repo('a').finish(uncertain,'uncertain');
      const before=await grants(uncertain);settleInboundAttempt(uncertain.authority,'unknown',Date.now());
      assert.deepEqual(await grants(uncertain),before,'unknown allocation is never refunded');
      // Advance only the durable attempt lease; the real original DO reservation remains held.
      await db.prepare('UPDATE inbound_email_attempts SET expires_at=0 WHERE tenant_id=? AND source_hash=?').bind('a',uncertain.sourceHash).run();
      for(const attempt of [2,3]) {
        const recovered=await requireAdmission('a',uncertain.sourceHash,attempt);assert.equal(recovered.authority.purpose,'recovery');
        assert.notEqual(recovered.authority.grant!.reservationId,uncertain.authority.grant!.reservationId);
        await ready('a',recovered);
        const current=await grants(recovered);const recovery=current.find(g=>g.reservationId===recovered.authority.grant!.reservationId);
        assert.equal(recovery?.purpose,'recovery');assert.ok(recovery!.accounted.workerRequests!>0);
        assert.deepEqual(current.find(g=>g.reservationId===uncertain.authority.grant!.reservationId),before.find(g=>g.reservationId===uncertain.authority.grant!.reservationId));
        await repo('a').finish(recovered,'uncertain');settleInboundAttempt(recovered.authority,'unknown',Date.now());
        await db.prepare('UPDATE inbound_email_attempts SET expires_at=0 WHERE tenant_id=? AND source_hash=? AND attempt=?').bind('a',uncertain.sourceHash,attempt).run();
      }
      const final=await grants(uncertain);assert.deepEqual(await admit('a',uncertain.sourceHash,4),{status:'rejected',reason:'unavailable'});
      assert.deepEqual(await grants(uncertain),final);
      assert.equal((await db.prepare('SELECT count(*) AS n FROM inbound_email_attempts WHERE tenant_id=? AND source_hash=?').bind('a',uncertain.sourceHash).first<{n:number}>())!.n,3);
    });
    await t.test('exhausted allocation and a revoked warm tenant deny before receipt or canonical effects',async()=>{
      const before=await effectCount();
      assert.deepEqual(await admit('empty','3'.repeat(64)),{status:'rejected',reason:'exhausted'});
      assert.equal(await repo('empty').find('3'.repeat(64)),null);
      await db.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id='b'").run();
      assert.deepEqual(await admit('b','4'.repeat(64)),{status:'rejected',reason:'unavailable'});
      assert.equal(await repo('b').find('4'.repeat(64)),null);assert.equal(await effectCount(),before);
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
  } finally {apiTicketBudgetCache.discardForTrustedRuntime();await mf.dispose();}
});
