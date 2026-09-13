import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import type { D1Database,D1PreparedStatement } from '@cloudflare/workers-types';
import { createSystemTenantScope } from '../src/auth/scope';
import { InboundEmailLookupRepository } from '../src/repositories/inbound-email-lookup.repository';
import { splitSql } from './split-sql';

test('native indexed inbound lookup bounds with synthetic history',async t=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response()}}',compatibilityDate:'2024-04-03',d1Databases:{DB:'inbound-lookup'}}));
  try {
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    const migrations=resolve(import.meta.dirname,'../migrations');
    for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())await db.batch(splitSql(readFileSync(join(migrations,file),'utf8')).map(sql=>db.prepare(sql)));
    for(const tenant of ['a','b'])await db.batch([
      db.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?,'sender',?,'customer')").bind(tenant,tenant==='a'?'sender@example.invalid':'other@example.invalid'),
      db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_id,customer_email,source) VALUES (?,'target','Unique','sender','sender@example.invalid','email')").bind(tenant),
    ]);
    for(const tenant of ['a','b'])await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2000)
      INSERT INTO tickets(tenant_id,id,subject,customer_email,source)
      SELECT ?,'noise-'||x,'Irrelevant '||x,'synthetic@example.invalid','email' FROM n`).bind(tenant).run();
    // Large irrelevant tenant history and old/same-tenant staff history must not
    // enlarge the bounded customer rate lookup or load article payloads.
    for(const [tenant,senderType,date] of [['b','customer','2026-09-13'],['a','customer','2025-01-01'],['a','agent','2026-09-13']] as const){
      await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2000)
        INSERT INTO articles(tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal,created_at,raw_email_id)
        SELECT ?,?||x,'target','sender',?,'Synthetic body deliberately excluded',0,?,'irrelevant-'||x FROM n`)
        .bind(tenant,`${tenant}-${senderType}-${date}-`,senderType,date).run();
    }
    const observed:{sql:string;values:unknown[];rows:number;results:unknown[]}[]=[];
    function prepared(sql:string,statement:D1PreparedStatement,values:unknown[]=[]):D1PreparedStatement {
      const all=async()=>{const result=await statement.all();observed.push({sql,values,rows:result.meta.rows_read,results:result.results});return result;};
      return {bind:(...args:unknown[])=>prepared(sql,statement.bind(...args),args),all,first:async()=>((await all()).results[0]??null)} as unknown as D1PreparedStatement;
    }
    const instrumented={prepare:(sql:string)=>prepared(sql,db.prepare(sql))} as unknown as D1Database;
    const repo=(tenant='a')=>new InboundEmailLookupRepository(instrumented,createSystemTenantScope({tenantId:tenant,actor:'inbound-email'}));
    await t.test('subject lookup returns only tenant-qualified participant projection',async()=>{
      observed.length=0;assert.deepEqual(await repo().ticket('Unique',[]),{id:'target',customer_id:'sender',customer_email:'sender@example.invalid'});
      assert.equal(observed.length,1);assert.ok(observed[0].rows<=4);assert.deepEqual(Object.keys(observed[0].results[0] as object).sort(),['customer_email','customer_id','id']);
      const plan=await db.prepare('EXPLAIN QUERY PLAN '+observed[0].sql).bind(...observed[0].values).all<{detail:string}>();
      assert.ok(plan.results.some(row=>row.detail.includes('idx_tickets_inbound_subject')));assert.ok(plan.results.every(row=>!row.detail.includes('TEMP B-TREE')));
    });
    await t.test('subject and reference ambiguity stop at two candidates',async()=>{
      await db.batch(['one','two','three'].map(id=>db.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,source) VALUES ('a',?,'Ambiguous','sender@example.invalid','email')").bind(id)));
      observed.length=0;await assert.rejects(repo().ticket('Ambiguous',[]),/Ambiguous inbound subject/);assert.equal(observed[0].results.length,2);assert.ok(observed[0].rows<=4);
      await db.batch(['one','two','three'].map(id=>db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,raw_email_id) VALUES ('a',?,?,'customer','Synthetic','duplicate')").bind('ref-'+id,id)));
      observed.length=0;await assert.rejects(repo().ticket('Missing',['duplicate']),/Ambiguous inbound reference/);assert.equal(observed[1].results.length,2);assert.ok(observed[1].rows<=2);
    });
    await t.test('reference lookup is tenant-qualified and rejects excess references before queries',async()=>{
      await db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_type,body,raw_email_id) VALUES ('b','only-b','target','customer','Synthetic','tenant-b-only')").run();
      observed.length=0;assert.equal(await repo().ticket('Missing',['tenant-b-only']),null);
      assert.deepEqual(await repo('b').ticket('Missing',['tenant-b-only']),{id:'target',customer_id:'sender',customer_email:'sender@example.invalid'});
      observed.length=0;await assert.rejects(repo().ticket('Missing',Array(21).fill('x')),/Invalid inbound lookup/);assert.equal(observed.length,0);
      await assert.rejects(repo().ticket('Missing',['x'.repeat(257)]),/Invalid inbound lookup/);assert.equal(observed.length,0);
      assert.equal(await repo().ticket('Missing',Array.from({length:20},(_,i)=>'absent-'+i)),null);assert.equal(observed.length,21);
      const reference=observed[1];const plan=await db.prepare('EXPLAIN QUERY PLAN '+reference.sql).bind(...reference.values).all<{detail:string}>();
      assert.ok(plan.results.some(row=>row.detail.includes('COVERING INDEX idx_articles_inbound_message')));
    });
    await t.test('rate threshold is twenty-one customer rows, excluding old and staff history',async()=>{
      observed.length=0;assert.equal(await repo().recentSenderLimitReached('sender@example.invalid','2026-09-13T11:00:00.000Z'),false);
      const insert=(id:number)=>db.prepare("INSERT INTO articles(tenant_id,id,ticket_id,sender_id,sender_type,body,created_at) VALUES ('a',?,'target','sender','customer','Synthetic','2026-09-13 12:00:00')").bind('recent-'+id);
      await db.batch(Array.from({length:20},(_,i)=>insert(i)));assert.equal(await repo().recentSenderLimitReached('sender@example.invalid','2026-09-13T11:00:00.000Z'),false);
      await db.batch(Array.from({length:100},(_,i)=>insert(i+20)));observed.length=0;assert.equal(await repo().recentSenderLimitReached('sender@example.invalid','2026-09-13T11:00:00.000Z'),true);
      assert.equal(observed[1].results.length,1);assert.ok(observed[1].rows<=42,JSON.stringify(observed[1]));
      const plan=await db.prepare('EXPLAIN QUERY PLAN '+observed[1].sql).bind(...observed[1].values).all<{detail:string}>();
      assert.ok(plan.results.some(row=>row.detail.includes('INDEX idx_articles_inbound_customer_time')));
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
  } finally {await mf.dispose();}
});
