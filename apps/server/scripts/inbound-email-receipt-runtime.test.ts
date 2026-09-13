import { TenantAttachmentStorage } from '../src/storage/adapters';
import { writeInboundAttachments } from '../src/services/email/inbound-attachments';
import { TicketMutationReplayRepository, type MutationCandidate } from '../src/repositories/ticket-mutation-replay.repository';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createSystemTenantScope } from '../src/auth/scope';
import { InboundEmailReceiptRepository, MAX_INBOUND_RECEIPTS_PER_TENANT, type InboundClaim } from '../src/repositories/inbound-email-receipt.repository';
import { splitSql } from './split-sql';

const root = resolve(import.meta.dirname,'..');
const source = 'a'.repeat(64), envelope = 'b'.repeat(64);

function claim(tenant: string, key = source, attempt = 1): InboundClaim {
  const operationId = `inbound:${key}:${attempt}`;
  return { sourceHash:key,envelopeHash:envelope,recipient:`support-${tenant}@example.invalid`,attempt,token:crypto.randomUUID(),
    authority:{expiresAt:Date.now()+60_000,purpose:attempt===1?'new-work':'recovery',operationId,operationFingerprint:envelope,
      snapshot:{deployment_id:'inbound-test',tenant_id:tenant,authority_revision:1,policy_id:'policy',policy_revision:1,
        reservation_namespace:`namespace-${tenant}`,restriction_json:'{}',coordinator_id:'coordinator',max_reservations:64,
        authority_max_age_ms:60_000,policy_json:'{}'},
      grant:{tenantId:tenant,aggregateId:'aggregate',reservationId:crypto.randomUUID(),holderId:crypto.randomUUID(),
        operationId,operationFingerprint:envelope,operationEnvelope:{d1RowsRead:8192,d1RowsWritten:64}},
    } };
}

test('native D1 inbound receipt claims and mutation fences',async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("synthetic")}}',
    compatibilityDate:'2024-04-03',d1Databases:{DB:'inbound-receipt-tests'},r2Buckets:{ATTACHMENTS:'inbound-artifact-tests'}}));
  try {
    const db = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(join(root,'migrations')).filter(name=>name.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(root,'migrations',name),'utf8')).map(sql=>db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('inbound-test',1,'active',0)"),
      db.prepare("INSERT INTO budget_owner_policies VALUES ('inbound-test','policy',1,1,'coordinator',64,60000,'{}')"),
      ...['a','b'].flatMap(tenant=>[
        db.prepare("INSERT INTO budget_tenant_allocations VALUES ('inbound-test',?,'policy',1,1,?,'{}','active')").bind(tenant,`namespace-${tenant}`),
        db.prepare('INSERT INTO support_emails(tenant_id,id,email_address,normalized_email) VALUES (?,?,?,?)')
          .bind(tenant,'mailbox',`support-${tenant}@example.invalid`,`support-${tenant}@example.invalid`),
      ]),
      db.prepare('CREATE TABLE synthetic_inbound_effects(tenant_id TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(tenant_id,id))'),
    ]);
    const repository = (tenant='a',actor='inbound-email') => new InboundEmailReceiptRepository(db,createSystemTenantScope({tenantId:tenant,actor}));
    const count = async(table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{n:number}>())!.n;

    await t.test('one race winner links one grant and commits effects once',async()=>{
      const a = claim('a'), b = claim('a');
      const raced = await Promise.allSettled([repository().begin(a),repository().begin(b)]);
      assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(await count('inbound_email_receipts'),1);
      assert.equal(await count('inbound_email_attempts'),1);
      assert.equal(await count('budget_grant_operations'),1,'losing grant link rolls back');
      const winner = raced[0].status==='fulfilled'?a:b;
      const effect = db.prepare("INSERT INTO synthetic_inbound_effects VALUES ('a','once')");
      await assert.rejects(repository().finish(winner,'committed',[effect]),'unprepared message cannot commit');
      await repository().prepare(winner,envelope);
      await repository().planArtifacts(winner,[]);
      await repository().finish(winner,'committed',[effect]);
      await assert.rejects(repository().finish(winner,'committed',[effect]));
      await assert.rejects(repository().begin(claim('a')));
      assert.equal(await count('synthetic_inbound_effects'),1);
      assert.equal((await repository().find(source))?.state,'committed');
    });

    await t.test('durable attachment manifest fences uncertain writes and stale acknowledgements',async()=>{
      const original=claim('a','9'.repeat(64));
      await repository().begin(original);
      await assert.rejects(repository().planArtifacts(original,[]),'raw must be prepared first');
      await repository().prepare(original,envelope);
      await assert.rejects(repository().planArtifacts(original,Array.from({length:11},()=>({contentHash:envelope,byteSize:1}))));
      const [artifact]=await repository().planArtifacts(original,[{contentHash:envelope,byteSize:7}]);
      await assert.rejects(repository().planArtifacts(original,[]),'manifest cannot be replaced');
      await assert.rejects(repository().finish(original,'committed'),'unacknowledged object cannot commit');
      await assert.rejects(repository().confirmArtifact(original,{...artifact,byteSize:8}));
      await db.prepare('UPDATE inbound_email_attempts SET expires_at=0 WHERE source_hash=?').bind(original.sourceHash).run();
      const recovery=claim('a',original.sourceHash,2);
      await repository().begin(recovery);
      await repository().prepare(recovery,envelope);
      const [replacement]=await repository().planArtifacts(recovery,[{contentHash:envelope,byteSize:7}]);
      assert.notEqual(artifact.objectId,replacement.objectId,'late writes cannot overwrite recovery objects');
      await assert.rejects(repository().confirmArtifact(original,artifact));
      await repository().confirmArtifact(recovery,replacement);
      await repository().finish(recovery,'committed');
      const history=await db.prepare('SELECT state FROM inbound_email_artifacts WHERE tenant_id=? AND source_hash=? ORDER BY attempt')
        .bind('a',original.sourceHash).all<{state:string}>();
      assert.deepEqual(history.results.map(row=>row.state),['planned','stored'],'uncertain artifact remains auditable');
    });

    await t.test('inbound canonical intake commits customer, article, audit and SLA once with its receipt',async()=>{
      const current=claim('a','8'.repeat(64));
      await repository().begin(current);await repository().prepare(current,envelope);await repository().planArtifacts(current,[]);
      const now=new Date().toISOString();
      const candidate:MutationCandidate={ticketId:'inbound-ticket',articleId:'inbound-article',audit:{kind:'system',id:'inbound-email',source:'email'},attachments:[],
        ticket:{subject:'Synthetic inbound',status:'open',priority:'normal',customer_email:'new@example.invalid',source:'email',source_email:current.recipient,intake_received_at:now,intake_processed_at:now},
        article:{sender_type:'customer',body:'Synthetic content',body_format:'plain',is_internal:false,intake_source:'email',received_at:now,processed_at:now}};
      const canonical=new TicketMutationReplayRepository(db,createSystemTenantScope({tenantId:'a',actor:'inbound-email'}));
      await canonical.commitInbound(current,candidate,'new@example.invalid');
      await assert.rejects(canonical.commitInbound(current,candidate,'new@example.invalid'));
      const ticket=await db.prepare("SELECT customer_id FROM tickets WHERE tenant_id='a' AND id='inbound-ticket'").first<{customer_id:string}>();
      assert.ok(ticket?.customer_id);
      assert.equal((await db.prepare("SELECT sender_id FROM articles WHERE tenant_id='a' AND id='inbound-article'").first<{sender_id:string}>())?.sender_id,ticket.customer_id);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM users WHERE tenant_id='a' AND email='new@example.invalid'").first<{n:number}>())?.n,1);
      assert.deepEqual(await db.prepare("SELECT actor_kind,actor_id,actor_provenance,source FROM conversation_events WHERE tenant_id='a' AND ticket_id='inbound-ticket'").first(),
        {actor_kind:'system',actor_id:'inbound-email',actor_provenance:'gateway-email',source:'email'});
      assert.ok(await db.prepare("SELECT 1 AS present FROM ticket_sla_clocks WHERE tenant_id='a' AND ticket_id='inbound-ticket'").first());
      assert.equal((await repository().find(current.sourceHash))?.state,'committed');
    });

    await t.test('real R2 lost-response writes remain recorded and recovery uses a different key',async()=>{
      const first=claim('a','7'.repeat(64));
      const scope=createSystemTenantScope({tenantId:'a',actor:'inbound-email'});
      const bucket=await mf.getR2Bucket('ATTACHMENTS') as unknown as R2Bucket;
      const storage=new TenantAttachmentStorage(scope,bucket as unknown as ConstructorParameters<typeof TenantAttachmentStorage>[1]);
      const put=storage.putAttachment.bind(storage);
      let interrupted=true;
      storage.putAttachment=async(...args)=>{const result=await put(...args);if(interrupted)throw new Error('Synthetic lost R2 response');return result;};
      const attachments=[{filename:'synthetic.txt',contentType:'text/plain',content:new Uint8Array([1,2,3])}];
      await repository().begin(first);await repository().prepare(first,envelope);
      await assert.rejects(writeInboundAttachments({storage,receipts:repository(),claim:first,attachments}),/lost R2 response/);
      const old=await db.prepare('SELECT object_id,state FROM inbound_email_artifacts WHERE tenant_id=? AND source_hash=? AND attempt=1')
        .bind('a',first.sourceHash).first<{object_id:string;state:string}>();
      assert.equal(old?.state,'planned');assert.ok(await storage.getAttachment(old!.object_id),'provider accepted object despite lost response');
      await assert.rejects(repository().finish(first,'committed'));
      await repository().finish(first,'uncertain');
      await db.prepare('UPDATE inbound_email_attempts SET expires_at=0 WHERE tenant_id=? AND source_hash=? AND attempt=1').bind('a',first.sourceHash).run();
      const second=claim('a',first.sourceHash,2);interrupted=false;
      await repository().begin(second);await repository().prepare(second,envelope);
      const [stored]=await writeInboundAttachments({storage,receipts:repository(),claim:second,attachments});
      assert.notEqual(stored.storageKey,old!.object_id);
      assert.ok(await storage.getAttachment(stored.storageKey));
      assert.ok(await storage.getAttachment(old!.object_id),'uncertain object is retained, never silently refunded or deleted');
      await repository().finish(second,'committed');
      assert.equal((await bucket.list()).objects.length,2);
      assert.equal((await repository().find(first.sourceHash))?.state,'committed');
    });

    await t.test('colliding source identifiers remain tenant isolated',async()=>{
      const b = claim('b');
      await repository('b').begin(b);
      assert.equal((await repository('b').find(source))?.state,'processing');
      assert.equal((await repository().find(source))?.state,'committed');
      await assert.rejects(repository().finish(b,'committed'));
      await repository('b').finish(b,'rejected');
      await assert.rejects(repository('b').begin(claim('b',source,2)));
    });

    await t.test('failed mutation batch preserves processing receipt and rolls back effects',async()=>{
      const c = claim('a','c'.repeat(64));
      await repository().begin(c);
      await repository().prepare(c,envelope);
      await repository().planArtifacts(c,[]);
      await assert.rejects(repository().finish(c,'committed',[
        db.prepare("INSERT INTO synthetic_inbound_effects VALUES ('a','rollback')"),
        db.prepare("INSERT INTO synthetic_inbound_effects VALUES ('a','once')"),
      ]));
      assert.equal((await repository().find(c.sourceHash))?.state,'processing');
      assert.equal(await count('synthetic_inbound_effects'),1);
      await repository().finish(c,'uncertain');
      assert.equal((await repository().find(c.sourceHash))?.state,'uncertain');
    });

    await t.test('expired attempt recovery fences old worker and preserves charged history',async()=>{
      const key = 'd'.repeat(64), old = claim('a',key);
      await repository().begin(old);
      await repository().prepare(old,envelope);
      await repository().planArtifacts(old,[]);
      await assert.rejects(repository().begin(claim('a',key,2)),'live attempt cannot be taken over');
      await db.prepare('UPDATE inbound_email_attempts SET expires_at=0 WHERE tenant_id=? AND source_hash=?').bind('a',key).run();
      const recovered = claim('a',key,2);
      await repository().begin(recovered);
      await assert.rejects(repository().finish(recovered,'committed'),'each recovery must verify its own raw content');
      await assert.rejects(repository().prepare(recovered,'f'.repeat(64)),'recovery cannot substitute different content');
      await repository().prepare(recovered,envelope);
      await repository().planArtifacts(recovered,[]);
      await assert.rejects(repository().finish(old,'committed',[db.prepare("INSERT INTO synthetic_inbound_effects VALUES ('a','stale')")]));
      await repository().finish(recovered,'committed');
      const attempts = (await db.prepare('SELECT attempt,state FROM inbound_email_attempts WHERE tenant_id=? AND source_hash=? ORDER BY attempt')
        .bind('a',key).all()).results;
      assert.deepEqual(attempts,[{attempt:1,state:'uncertain'},{attempt:2,state:'committed'}]);
      assert.equal(await count('synthetic_inbound_effects'),1);
      await assert.rejects(repository().begin(claim('a',key,3)),'terminal receipt cannot recover');
      await assert.rejects(repository().begin(claim('a',key,4)),'recovery is bounded');
    });

    await t.test('revoked policy and moved mailbox deny atomically',async()=>{
      const c = claim('a','e'.repeat(64));
      await repository().begin(c);
      await repository().prepare(c,envelope);
      await repository().planArtifacts(c,[]);
      await db.prepare("UPDATE budget_deployment_authority SET state='revoked' WHERE deployment_id='inbound-test'").run();
      await assert.rejects(repository().finish(c,'committed',[db.prepare("INSERT INTO synthetic_inbound_effects VALUES ('a','revoked')")]));
      await assert.rejects(repository().begin(claim('a','f'.repeat(64))));
      assert.equal(await repository().find('f'.repeat(64)),null);
      await db.prepare("UPDATE budget_deployment_authority SET state='active' WHERE deployment_id='inbound-test'").run();
      await db.prepare("UPDATE support_emails SET normalized_email='moved@example.invalid' WHERE tenant_id='a' AND id='mailbox'").run();
      await assert.rejects(repository().finish(c,'committed'));
      assert.equal((await repository().find(c.sourceHash))?.state,'processing');
      assert.equal(await count('synthetic_inbound_effects'),1);
    });

    await t.test('wrong system actor and forged operation identity are rejected before writes',async()=>{
      const c = claim('b','f'.repeat(64));
      await assert.rejects(repository('b','scheduled-retention').begin(c));
      await assert.rejects(repository('b').begin({...c,authority:{...c.authority,operationId:'wrong'}}));
      assert.equal(await repository('b').find(c.sourceHash),null);
    });

    await t.test('terminal receipt population cannot grow beyond the bounded tenant cap',async()=>{
      for (let offset=1;offset<MAX_INBOUND_RECEIPTS_PER_TENANT;offset+=100) {
        await db.batch(Array.from({length:Math.min(100,MAX_INBOUND_RECEIPTS_PER_TENANT-offset)},(_,index)=>
          db.prepare(`INSERT INTO inbound_email_receipts
            (tenant_id,source_hash,envelope_hash,recipient,current_attempt,state) VALUES ('b',?,?,'support-b@example.invalid',1,'rejected')`)
            .bind((offset+index).toString(16).padStart(64,'0'),envelope)));
      }
      const before = await count('budget_grant_operations');
      await assert.rejects(repository('b').begin(claim('b','9'.repeat(64))));
      assert.equal(await repository('b').find('9'.repeat(64)),null);
      assert.equal(await count('budget_grant_operations'),before);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM inbound_email_receipts WHERE tenant_id='b'").first<{n:number}>())!.n,MAX_INBOUND_RECEIPTS_PER_TENANT);
    });
  } finally { await mf.dispose(); }
});
