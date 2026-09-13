import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitSql } from './split-sql';

const migrations=resolve(import.meta.dirname,'../migrations');
const migrationName='0070_inbound_email_provenance.sql';

test('native inbound provenance migration preserves canonical evidence and derived history',async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("synthetic")}}',
    compatibilityDate:'2024-04-03',d1Databases:{DB:'inbound-provenance-migration'}}));
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql') && n<migrationName).sort()) {
      await db.batch(splitSql(readFileSync(join(migrations,name),'utf8')).map(sql=>db.prepare(sql)));
    }
    const event=(id:string,sequence:number,article:string|null,visibility='public',actor='customer',provenance='authenticated-customer',source='portal',actorId:string|null='customer',tenant='a')=>
      db.prepare(`INSERT INTO conversation_events(tenant_id,id,ticket_id,article_id,sequence,kind,recorded_at,actor_kind,actor_id,actor_provenance,source,visibility,facts)
        VALUES (?,?,'ticket',?,?,'message.reply','2026-09-13T10:00:00.001Z',?,?,?,?,?,'{"synthetic":true}')`)
        .bind(tenant,id,article,sequence,actor,actorId,provenance,source,visibility);
    await db.batch(['a','b'].flatMap(tenant=>[
      db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?,'customer',?,'customer')").bind(tenant,`customer-${tenant}@example.invalid`),
      db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source) VALUES (?,'ticket','Synthetic','customer','customer@example.invalid','portal')").bind(tenant),
      ...['public','hidden'].map((id,index)=>db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal) VALUES (?,?,'ticket','customer','customer','Synthetic',?)").bind(tenant,id,index)),
      event('public',1,'public','public','customer','authenticated-customer','portal','customer',tenant),
      event('internal',2,'public','internal','staff','mfa-staff','dashboard','customer',tenant),
      event('hidden-article',3,'hidden','public','customer','authenticated-customer','portal','customer',tenant),
      event('missing-article',4,null,'public','api-key','api-key','api',null,tenant),
    ]));
    const events=async()=>(await db.prepare('SELECT * FROM conversation_events ORDER BY tenant_id,id').all()).results;
    const history=async()=>(await db.prepare('SELECT * FROM conversation_public_history ORDER BY tenant_id,event_id').all()).results;
    const schema=async()=>(await db.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE type IN ('index','trigger')
      AND (tbl_name='conversation_events' OR sql LIKE '%conversation_events%' OR sql LIKE '%conversation_public_history%') ORDER BY type,name`).all()).results;
    const beforeEvents=await events(), beforeHistory=await history(), beforeSchema=await schema();
    const statements=()=>splitSql(readFileSync(join(migrations,migrationName),'utf8')).map(sql=>db.prepare(sql));
    await t.test('an interrupted transactional rebuild rolls back all canonical and derived changes',async()=>{
      await assert.rejects(db.batch([...statements(),db.prepare('SELECT * FROM deliberately_missing_migration_table')]), /deliberately_missing_migration_table/);
      assert.deepEqual(await events(),beforeEvents);assert.deepEqual(await history(),beforeHistory);assert.deepEqual(await schema(),beforeSchema);
    });
    await db.batch(statements());
    await t.test('existing rows, eligible history, indexes and triggers survive exactly',async()=>{
      assert.deepEqual(await events(),beforeEvents);assert.deepEqual(await history(),beforeHistory);
      assert.deepEqual(await schema(),beforeSchema);
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
    await t.test('only the exact system gateway actor pairing is accepted',async()=>{
      await event('gateway',5,'public','public','system','gateway-email','email','inbound-email').run();
      await assert.rejects(event('private-system',6,'public','internal','system','gateway-email','email','inbound-email').run());
      for(const kind of ['ticket.assignment_changed','ticket.state_changed']) {
        await assert.rejects(db.prepare("UPDATE conversation_events SET kind=? WHERE tenant_id='a' AND id='gateway'").bind(kind).run());
      }
      await db.prepare("UPDATE conversation_events SET kind='ticket.intake' WHERE tenant_id='a' AND id='gateway'").run();
      await db.prepare("UPDATE conversation_events SET kind='message.reply' WHERE tenant_id='a' AND id='gateway'").run();
      const invalid:[string,string,string,string|null][]=[
        ['system','gateway-email','email',null],['system','gateway-email','email','other-system'],
        ['system','authenticated-customer','email','inbound-email'],['system','gateway-email','portal','inbound-email'],
        ['customer','gateway-email','portal','customer'],['customer','authenticated-customer','email','customer'],
        ['staff','gateway-email','email','inbound-email'],['api-key','api-key','email',null],
      ];
      for(const [actor,provenance,source,id] of invalid) {
        await assert.rejects(event('invalid',6,'public','public',actor,provenance,source,id).run());
      }
      // Old enum combinations remain accepted rather than being silently tightened.
      await event('old-enums',6,'public','public','staff','api-key','widget',null).run();
      assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_events WHERE id='invalid'").first<{n:number}>())!.n,0);
    });
    await t.test('article visibility and deletion retain tenant-qualified projection behavior',async()=>{
      await db.prepare("UPDATE articles SET is_internal=1 WHERE tenant_id='a' AND id='public'").run();
      assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_public_history WHERE tenant_id='a'").first<{n:number}>())!.n,0);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_public_history WHERE tenant_id='b'").first<{n:number}>())!.n,1);
      await db.prepare("UPDATE articles SET is_internal=0 WHERE tenant_id='a' AND id='public'").run();
      assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_public_history WHERE tenant_id='a'").first<{n:number}>())!.n,3);
      await db.prepare("DELETE FROM articles WHERE tenant_id='a' AND id='public'").run();
      assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_public_history WHERE tenant_id='a'").first<{n:number}>())!.n,0);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_events WHERE tenant_id='a' AND article_id='public'").first<{n:number}>())!.n,0);
      assert.equal((await db.prepare("SELECT actor_id FROM conversation_events WHERE tenant_id='a' AND id='gateway'").first<{actor_id:string}>())!.actor_id,'inbound-email');
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
    await t.test('user and API-key deletion preserve original scoped actor redaction',async()=>{
      await db.batch(['a','b'].flatMap(tenant=>[
        db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?,'redacted-staff',?,'agent')").bind(tenant,`staff-${tenant}@example.invalid`),
        db.prepare("INSERT INTO api_keys(tenant_id,id,name,key_hash,prefix,permissions,is_active) VALUES (?,'redacted-key','Synthetic',?,'test','tickets:read',1)").bind(tenant,`synthetic-key-${tenant}`),
        event('staff-redaction',7,null,'internal','staff','mfa-staff','dashboard','redacted-staff',tenant),
        event('key-redaction',8,null,'internal','api-key','api-key','api','redacted-key',tenant),
      ]));
      await db.prepare(`UPDATE conversation_events SET facts='{"before":{"assignedTo":"redacted-staff"},"after":{"assignedTo":"redacted-staff"},"initial":{"assignedTo":"redacted-staff"}}'
        WHERE id='staff-redaction'`).run();
      await db.prepare("DELETE FROM users WHERE tenant_id='a' AND id='redacted-staff'").run();
      await db.prepare("DELETE FROM api_keys WHERE tenant_id='a' AND id='redacted-key'").run();
      assert.deepEqual(await db.prepare("SELECT actor_id,facts FROM conversation_events WHERE tenant_id='a' AND id='staff-redaction'").first(),{
        actor_id:null,facts:'{"before":{"assignedTo":null},"after":{"assignedTo":null},"initial":{"assignedTo":null}}',
      });
      assert.equal((await db.prepare("SELECT actor_id FROM conversation_events WHERE tenant_id='a' AND id='key-redaction'").first<{actor_id:null}>())!.actor_id,null);
      assert.equal((await db.prepare("SELECT actor_id FROM conversation_events WHERE tenant_id='b' AND id='staff-redaction'").first<{actor_id:string}>())!.actor_id,'redacted-staff');
      assert.equal((await db.prepare("SELECT actor_id FROM conversation_events WHERE tenant_id='b' AND id='key-redaction'").first<{actor_id:string}>())!.actor_id,'redacted-key');
      assert.equal((await db.prepare("SELECT actor_id FROM conversation_events WHERE tenant_id='a' AND id='gateway'").first<{actor_id:string}>())!.actor_id,'inbound-email');
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
  } finally {await mf.dispose();}
});
