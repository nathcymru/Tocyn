import { ticketQueuePredicate } from '../src/repositories/ticket-queue-predicate';
import { TicketListScanRepository } from '../src/repositories/ticket-list-scan.repository';
import { ticketListEnvelope } from '../src/budgets/http-ticket-list-admission.service';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSql } from './split-sql';
import { createVerifiedTenantScope } from '../src/auth/scope';
import { createRepositories } from '../src/repositories';

test('queue predicates keep tenant-scoped snoozes out of actionable lists and reuse saved filters', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'ticket-queue-runtime', modules: true,
    script: 'export default { fetch() { return new Response("queue fixture") } }',
    d1Databases: { DB: 'e81c085e-9a9d-44da-8fc0-1922b659adbf' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const migrationDir = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrationDir, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('queue-a','agent','a@example.invalid','admin',1)"),
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('queue-b','agent','b@example.invalid','admin',1)"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-a','open','Open','open','high','a@example.invalid','dashboard')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-a','snoozed','Snoozed','open','high','a@example.invalid','dashboard')"),
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-a','resolved','Resolved','resolved','high','a@example.invalid','dashboard')"),
      // Same local ticket ID proves the predicate is tenant-qualified.
      db.prepare("INSERT INTO tickets (tenant_id,id,subject,status,priority,customer_email,source) VALUES ('queue-b','snoozed','Other tenant','open','high','b@example.invalid','dashboard')"),
    ]);
    await db.batch([
      db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id='queue-a' AND ticket_id='snoozed'"),
      db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id='queue-b' AND ticket_id='snoozed'"),
    ]);
    const reposA = createRepositories(createVerifiedTenantScope('queue-a', 'agent', ['admin'], 1), db);
    const reposB = createRepositories(createVerifiedTenantScope('queue-b', 'agent', ['admin'], 1), db);

    const actionable = await reposA.queues.list({ queue: 'actionable', page: 1, limit: 100 });
    assert.deepEqual(actionable.items.map(item => [item.ticket.id, item.inclusionReason]), [['open', 'actionable']]);
    assert.equal(actionable.total, await reposA.queues.count({ queue: 'actionable' }), 'count and list use the same predicate');

    const snoozed = await reposA.queues.list({ queue: 'snoozed' });
    assert.deepEqual(snoozed.items.map(item => [item.ticket.id, item.inclusionReason]), [['snoozed', 'snoozed']]);
    assert.equal(await reposB.queues.count({ queue: 'snoozed' }), 1, 'other tenant has its own same-ID ticket');
    assert.equal(await reposA.queues.count({ queue: 'snoozed' }), 1, 'tenant A never counts tenant B');

    const saved = await reposA.ticketFilters.create({ name: 'High priority', conditions: [{ field: 'priority', operator: 'equals', value: 'high' }] });
    const narrowed = await reposA.queues.list({ queue: 'actionable', filterId: saved.id });
    assert.deepEqual(narrowed.items.map(item => item.ticket.id), ['open'], 'saved filters refine, rather than replace, queue predicates');

    assert.deepEqual(await reposA.supportStates.resurfaceDue('2098-12-31T23:59:59.999Z'), []);
    assert.deepEqual(await reposA.supportStates.resurfaceDue('2099-01-01T00:00:00.000Z'), ['snoozed']);
    assert.deepEqual(await reposA.supportStates.resurfaceDue('2100-01-01T00:00:00.000Z'), [], 'due retry is idempotent');
    assert.deepEqual((await reposA.queues.list({ queue: 'snoozed' })).items, []);
    assert.deepEqual((await reposA.queues.list({ queue: 'actionable' })).items.map(item => item.ticket.id).sort(), ['open', 'snoozed']);
  } finally {
    await mf.dispose();
  }
});

test('queue list and count retain the ticket-list query cap', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'ticket-queue-query-bound', modules: true,
    script: 'export default { fetch() { return new Response("queue fixture") } }',
    d1Databases: { DB: '3285bd3f-141e-42ca-a1ca-fbbf91923669' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const migrationDir = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrationDir, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users (tenant_id,id,email,role,mfa_enabled) VALUES ('queue-cap','agent','cap@example.invalid','admin',1)"),
      ...Array.from({ length: 101 }, (_, index) => db.prepare(`INSERT INTO tickets (tenant_id,id,subject,status,customer_email,source)
        VALUES ('queue-cap','ticket-${index}','Synthetic','open','cap@example.invalid','dashboard')`)),
    ]);
    const repos = createRepositories(createVerifiedTenantScope('queue-cap', 'agent', ['admin'], 1), db);
    const page = await repos.queues.list({ queue: 'actionable', page: 1, limit: 10_000 });
    assert.equal(page.limit, 100);
    assert.equal(page.items.length, 100);
    assert.equal(await repos.queues.count({ queue: 'actionable' }), 101);
  } finally {
    await mf.dispose();
  }
});

test('Drafts queue keeps actor, tenant, current membership and local expiry in one bounded list/count predicate', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'draft-queue-runtime', modules: true,
    script: 'export default { fetch() { return new Response("draft queue fixture") } }',
    d1Databases: { DB: '732644f3-ea82-477e-ab63-7a442ad74faf' },
  }] }));
  try {
    const db = await mf.getD1Database('DB');
    const migrationDir = join(import.meta.dirname, '..', 'migrations');
    for (const file of readdirSync(migrationDir).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(splitSql(readFileSync(join(migrationDir, file), 'utf8')).map(sql => db.prepare(sql)));
    }
    await db.batch([
      db.prepare("INSERT INTO users(tenant_id,id,email,role,mfa_enabled) VALUES('draft-a','alice','alice-a@example.invalid','agent',1),('draft-a','bob','bob@example.invalid','admin',1),('draft-b','alice','alice-b@example.invalid','admin',1)"),
      db.prepare("INSERT INTO groups(tenant_id,id,name) VALUES('draft-a','visible','Visible'),('draft-a','hidden','Hidden')"),
      db.prepare("INSERT INTO user_groups(tenant_id,user_id,group_id) VALUES('draft-a','alice','visible')"),
    ]);
    const ids = ['active','legacy','expired','boundary','hidden','other-only','foreign-only','snoozed'];
    for (const tenant of ['draft-a','draft-b']) {
      await db.batch(ids.map(id => db.prepare(`INSERT INTO tickets(tenant_id,id,subject,status,priority,customer_email,source,group_id)
        VALUES(?,?,?,'open',?,'synthetic@example.invalid','fixture',?)`).bind(tenant,id,`Synthetic ${id}`,id==='legacy'?'low':'high',tenant==='draft-a'&&(id==='active'||id==='hidden')?id==='active'?'visible':'hidden':null)));
    }
    const cutoff='2026-09-13T12:00:00.000Z';
    const draft=(tenant:string,actor:string,id:string,expiry:string|null,updated='2026-09-13T11:00:00.000Z')=>db.prepare(`INSERT INTO operator_drafts
      (tenant_id,user_id,ticket_id,generation,revision,mode,body,attachments,base_conversation_revision,updated_at,expires_at)
      VALUES(?,?,?, ?,1,'internal','Synthetic private draft','[]',0,?,?)`).bind(tenant,actor,id,crypto.randomUUID(),updated,expiry);
    await db.batch([
      ...['active','hidden','snoozed'].map(id=>draft('draft-a','alice',id,'2026-09-14T12:00:00.000Z')),
      draft('draft-a','alice','legacy',null,'2026-09-12T12:00:00.000Z'),
      draft('draft-a','alice','expired',null,'2026-09-10T12:00:00.000Z'),
      draft('draft-a','alice','boundary',cutoff),
      draft('draft-a','bob','other-only','2026-09-14T12:00:00.000Z'),
      draft('draft-b','alice','foreign-only','2026-09-14T12:00:00.000Z'),
      db.prepare("UPDATE ticket_support_state SET snoozed_until='2099-01-01T00:00:00.000Z' WHERE tenant_id='draft-a' AND ticket_id='snoozed'"),
    ]);
    const scope=createVerifiedTenantScope('draft-a','alice',['agent'],1);
    const repos=createRepositories(scope,db);
    const options={queue:'drafts' as const,viewer:{role:'agent' as const,actorId:'alice'},draftNotExpiredAt:cutoff};
    const page=await repos.queues.list({...options,limit:2});
    assert.equal(page.total,3);
    const next=await repos.queues.list({...options,limit:2,page:2});
    assert.deepEqual([...page.items,...next.items].map(item=>item.ticket.id).sort(),['active','legacy','snoozed']);
    assert.ok([...page.items,...next.items].every(item=>item.inclusionReason==='drafts'&&!('body' in item.ticket)));
    assert.equal(await repos.queues.count(options),3);
    assert.equal(await repos.queues.count({...options,draftNotExpiredAt:undefined}),5,'without explicit local policy no default48hour expiry is imposed');
    const filter=await repos.ticketFilters.create({name:'High',conditions:[{field:'priority',operator:'equals',value:'high'}]});
    const filtered=await repos.queues.list({...options,filterId:filter.id});
    assert.deepEqual(filtered.items.map(item=>item.ticket.id).sort(),['active','snoozed']);
    assert.equal(filtered.total,await repos.queues.count({...options,filterId:filter.id}));
    assert.equal(await createRepositories(createVerifiedTenantScope('draft-a','bob',['admin'],1),db).queues.count({queue:'drafts',viewer:{role:'admin',actorId:'bob'},draftNotExpiredAt:cutoff}),1);
    assert.equal(await createRepositories(createVerifiedTenantScope('draft-b','alice',['admin'],1),db).queues.count({queue:'drafts',viewer:{role:'admin',actorId:'alice'},draftNotExpiredAt:cutoff}),1);
    await assert.rejects(repos.queues.list({queue:'drafts'}),/current operator/);
    await assert.rejects(repos.queues.list({...options,viewer:{role:'admin',actorId:'bob'}}),/current operator/);
    for(const role of ['customer','api-key','system']) {
      await assert.rejects(createRepositories(createVerifiedTenantScope('draft-a','alice',[role],1),db).queues.list({...options,viewer:{role:'admin',actorId:'alice'}}),/current operator/);
    }
    await db.prepare("DELETE FROM user_groups WHERE tenant_id='draft-a' AND user_id='alice' AND group_id='visible'").run();
    assert.deepEqual((await repos.queues.list(options)).items.map(item=>item.ticket.id).sort(),['legacy','snoozed']);

    const predicate=ticketQueuePredicate('drafts','tickets',{actorId:'alice',notExpiredAt:cutoff});
    const plan=await db.prepare(`EXPLAIN QUERY PLAN SELECT tickets.id FROM tickets WHERE tickets.tenant_id=? AND ${predicate.sql}`).bind('draft-a',...predicate.values).all<{detail:string}>();
    assert.ok(plan.results.some((row:{detail:string})=>/SEARCH queue_draft(?: EXISTS)? USING INDEX sqlite_autoindex_operator_drafts_1/.test(row.detail)),JSON.stringify(plan.results));
    // Many other operators' drafts cannot multiply an exact tenant/user/ticket PK lookup.
    await db.batch(Array.from({length:24},(_,index)=>db.prepare("INSERT INTO users(tenant_id,id,email,role,mfa_enabled) VALUES('draft-a',?,?,'agent',1)").bind(`other-${index}`,`other-${index}@example.invalid`)));
    await db.batch(Array.from({length:24},(_,index)=>ids.map(id=>draft('draft-a',`other-${index}`,id,'2026-09-14T12:00:00.000Z'))).flat());
    const snapshot=await new TicketListScanRepository(db,scope).snapshot(filter.id);
    const envelope=ticketListEnvelope(snapshot,{groupRestricted:true,queue:'drafts'});
    const baseline=ticketListEnvelope(snapshot,{groupRestricted:true});
    assert.equal(envelope!.d1RowsRead!-baseline!.d1RowsRead!,4*snapshot.ticketRows);
    let actualReads=0;
    let batches=0;
    const observed=new Proxy(db,{get(target,property){
      if(property==='batch') return async (statements:Parameters<typeof db.batch>[0])=>{
        const results=await target.batch(statements);batches++;
        actualReads+=results.reduce((sum:number,result:{meta:{rows_read?:number}})=>sum+(result.meta.rows_read??0),0);return results;
      };
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    }});
    const measured=await createRepositories(scope,observed).queues.list({...options,filterId:filter.id,scanFence:snapshot});
    assert.deepEqual(measured.items.map(item=>item.ticket.id),['snoozed']);
    assert.equal(measured.total,1);
    assert.equal(batches,1,'admitted assertion/count/page share a native transaction');
    assert.ok(actualReads>0&&actualReads<=envelope!.d1RowsRead!);
    t.diagnostic(`draft PK lookup uses index; ${snapshot.ticketRows} candidates,192 unrelated actor drafts, ${actualReads} native batch reads, ${envelope!.d1RowsRead} full-list allowance`);

  } finally { await mf.dispose(); }
});
