import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { createSystemTenantScope } from '../src/auth/scope';
import { InboundEmailReceiptRepository, type InboundClaim } from '../src/repositories/inbound-email-receipt.repository';
import { TicketMutationReplayRepository, type MutationCandidate } from '../src/repositories/ticket-mutation-replay.repository';
import { OperatorActivityRepository } from '../src/repositories/operator-activity.repository';
import { splitSql } from './split-sql';

const migrations=resolve(import.meta.dirname,'../migrations');
const envelope='b'.repeat(64);
function claim(source:string,tenant='a'):InboundClaim {
  const operationId=`inbound:${source}:1`;
  return {sourceHash:source,envelopeHash:envelope,recipient:`support-${tenant}@example.invalid`,attempt:1,token:crypto.randomUUID(),
    authority:{expiresAt:Date.now()+60_000,purpose:'new-work',operationId,operationFingerprint:envelope,
      snapshot:{deployment_id:'canonical-inbound',tenant_id:tenant,authority_revision:1,policy_id:'policy',policy_revision:1,
        reservation_namespace:`namespace-${tenant}`,restriction_json:'{}',coordinator_id:'coordinator',max_reservations:64,
        authority_max_age_ms:60_000,policy_json:'{}'},
      grant:{tenantId:tenant,aggregateId:'aggregate',reservationId:crypto.randomUUID(),holderId:crypto.randomUUID(),operationId,
        operationFingerprint:envelope,operationEnvelope:{d1RowsRead:8192,d1RowsWritten:64}}}};
}
function candidate(id:string,receipt:InboundClaim,email:string,existingTicket?:string):MutationCandidate {
  const now=new Date().toISOString();
  return {ticketId:existingTicket??`ticket-${id}`,articleId:`article-${id}`,audit:{kind:'system',id:'inbound-email',source:'email'},attachments:[],
    ...(existingTicket?{}:{ticket:{subject:'Synthetic inbound',status:'open' as const,priority:'normal' as const,customer_email:email,
      source:'email' as const,source_email:receipt.recipient,intake_received_at:now,intake_processed_at:now}}),
    article:{sender_type:'customer',body:'Synthetic inbound body',body_format:'plain',is_internal:false,intake_source:'email',received_at:now,processed_at:now}};
}

test('native inbound canonical composition with synthetic grant authority',async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("synthetic")}}',
    compatibilityDate:'2024-04-03',d1Databases:{DB:'inbound-canonical-tests'}}));
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrations,name),'utf8')).map(sql=>db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO budget_deployment_authority VALUES ('canonical-inbound',1,'active',0)"),
      db.prepare("INSERT INTO budget_owner_policies VALUES ('canonical-inbound','policy',1,1,'coordinator',64,60000,'{}')"),
      ...['a','b'].flatMap(tenant=>[
        db.prepare("INSERT INTO budget_tenant_allocations VALUES ('canonical-inbound',?,'policy',1,1,?,'{}','active')").bind(tenant,`namespace-${tenant}`),
        db.prepare('INSERT INTO support_emails(tenant_id,id,email_address,normalized_email) VALUES (?,?,?,?)')
          .bind(tenant,'mailbox',`support-${tenant}@example.invalid`,`support-${tenant}@example.invalid`),
      ]),
    ]);
    const scope=(tenant='a')=>createSystemTenantScope({tenantId:tenant,actor:'inbound-email'});
    const receipts=(tenant='a')=>new InboundEmailReceiptRepository(db,scope(tenant));
    const canonical=(tenant='a')=>new TicketMutationReplayRepository(db,scope(tenant),undefined,undefined,new OperatorActivityRepository(scope(tenant),db));
    const prepare=async(receipt:InboundClaim,tenant='a')=>{
      const r=receipts(tenant);await r.begin(receipt);await r.prepare(receipt,envelope);await r.planArtifacts(receipt,[]);
    };
    const snapshot=async()=>{
      const result:Record<string,unknown>={};
      for(const table of ['users','tickets','articles','attachments','conversation_events','sla_policies','ticket_sla_clocks','ticket_sla_events','operator_activities','ticket_support_state','support_state_events']) {
        result[table]=(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
      }
      return result;
    };
    await t.test('terminal receipt failure rolls back customer, ticket, article, audit and SLA, then a clean retry succeeds',async()=>{
      const receipt=claim('1'.repeat(64));await prepare(receipt);
      const input=candidate('rollback',receipt,'rollback@example.invalid');const before=await snapshot();
      await db.prepare(`CREATE TRIGGER synthetic_receipt_abort BEFORE UPDATE OF state ON inbound_email_receipts
        WHEN NEW.state='committed' AND NEW.source_hash='${receipt.sourceHash}' BEGIN SELECT RAISE(ABORT,'synthetic terminal receipt failure'); END`).run();
      await assert.rejects(canonical().commitInbound(receipt,input,'rollback@example.invalid'),/synthetic terminal receipt failure/);
      assert.deepEqual(await snapshot(),before);
      assert.equal((await receipts().find(receipt.sourceHash))?.state,'processing');
      await db.prepare('DROP TRIGGER synthetic_receipt_abort').run();
      await canonical().commitInbound(receipt,input,'rollback@example.invalid');
      assert.equal((await receipts().find(receipt.sourceHash))?.state,'committed');
    });
    await t.test('concurrent distinct sources resolve one normalized customer and retain both canonical intakes',async()=>{
      const a=claim('2'.repeat(64)),b=claim('3'.repeat(64));await prepare(a);await prepare(b);
      const email='shared@example.invalid';
      await Promise.all([canonical().commitInbound(a,candidate('one',a,email),email),canonical().commitInbound(b,candidate('two',b,email),email)]);
      const users=(await db.prepare("SELECT id FROM users WHERE tenant_id='a' AND email=?").bind(email).all<{id:string}>()).results;
      assert.equal(users.length,1);
      const tickets=(await db.prepare("SELECT customer_id FROM tickets WHERE tenant_id='a' AND customer_email=? ORDER BY id").bind(email).all<{customer_id:string}>()).results;
      assert.deepEqual(tickets.map(row=>row.customer_id),[users[0].id,users[0].id]);
      const articles=(await db.prepare("SELECT sender_id FROM articles WHERE tenant_id='a' AND id IN ('article-one','article-two') ORDER BY id").all<{sender_id:string}>()).results;
      assert.deepEqual(articles.map(row=>row.sender_id),[users[0].id,users[0].id]);
      assert.equal((await receipts().find(a.sourceHash))?.state,'committed');assert.equal((await receipts().find(b.sourceHash))?.state,'committed');
    });
    await t.test('existing-ticket sender mismatch and cross-tenant ticket identity fail without effects',async()=>{
      for(const tenant of ['a','b']) {
        const receipt=claim((tenant==='a'?'4':'5').repeat(64),tenant);await prepare(receipt,tenant);
        const email=tenant==='a'?'stranger@example.invalid':'shared@example.invalid';const before=await snapshot();
        await assert.rejects(canonical(tenant).commitInbound(receipt,candidate(`denied-${tenant}`,receipt,email,'ticket-one'),email));
        assert.deepEqual(await snapshot(),before);assert.equal((await receipts(tenant).find(receipt.sourceHash))?.state,'processing');
      }
    });
    await t.test('public gateway reply resurfaces snoozed work and records one durable assigned-operator activity',async()=>{
      await db.batch([
        db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES ('a','operator','operator@example.invalid','agent')"),
        db.prepare("UPDATE tickets SET assigned_to='operator' WHERE tenant_id='a' AND id='ticket-one'"),
        db.prepare("UPDATE ticket_support_state SET snoozed_until='2030-01-01T00:00:00.000Z' WHERE tenant_id='a' AND ticket_id='ticket-one'"),
      ]);
      const receipt=claim('6'.repeat(64));await prepare(receipt);const input=candidate('reply',receipt,'shared@example.invalid','ticket-one');
      await canonical().commitInbound(receipt,input,'shared@example.invalid');
      const event=await db.prepare("SELECT id,actor_kind,actor_id,actor_provenance,source,visibility,kind FROM conversation_events WHERE tenant_id='a' AND article_id='article-reply'").first<{id:string}>();
      assert.ok(event);assert.deepEqual(event,{id:event.id,actor_kind:'system',actor_id:'inbound-email',actor_provenance:'gateway-email',source:'email',visibility:'public',kind:'message.reply'});
      assert.deepEqual(await db.prepare("SELECT snoozed_until,resurface_reason FROM ticket_support_state WHERE tenant_id='a' AND ticket_id='ticket-one'").first(),{snoozed_until:null,resurface_reason:'customer_reply'});
      const activities=(await db.prepare("SELECT recipient_user_id,kind,source_id,producer_kind FROM operator_activities WHERE tenant_id='a' AND ticket_id='ticket-one'").all()).results;
      assert.deepEqual(activities,[{recipient_user_id:'operator',kind:'customer_reply',source_id:`conversation:${event.id}`,producer_kind:'system'}]);
      const after=await snapshot();await assert.rejects(canonical().commitInbound(receipt,input,'shared@example.invalid'));
      assert.deepEqual(await snapshot(),after,'a repeated committed attempt cannot duplicate activity, audit, SLA or resurfacing');
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
  } finally {await mf.dispose();}
});
