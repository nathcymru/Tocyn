import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import { LocalBetaAdmissionRepository } from '../local-beta-admission.repository';
import { LocalBetaOperator } from '../../../scripts/local-beta-operator';
import { createVerifiedTenantScope } from '../../auth/scope';
import { validateBetaInitialization } from '../../types/local-beta';

function fixture() {
  const sqlite=new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const name of readdirSync(join(__dirname,'../../../migrations')).filter(n=>n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(__dirname,'../../../migrations',name),'utf8'));
  for (const tenant of ['a','b']) sqlite.prepare("INSERT INTO users(tenant_id,id,email,role) VALUES (?,'customer',?,'customer')").run(tenant,tenant+'@example.invalid');
  const db = {
    prepare(sql:string) {
      const statement = (args:unknown[]=[]): any => ({
        bind: (...values:unknown[])=>statement(values),
        first: async()=>sqlite.prepare(sql).get(...args) ?? null,
        all: async()=>({results:sqlite.prepare(sql).all(...args)}),
        run: async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}}),
        execute: ()=>sqlite.prepare(sql).run(...args),
      });
      return statement();
    },
    async batch(statements:any[]) { return sqlite.transaction(()=>statements.map(s=>s.execute()))(); },
  } as unknown as D1Database;
  const operator=new LocalBetaOperator(sqlite);
  const input={runId:'run-1',tenants:['a','b'],invitations:['a','b'].map(tenantId=>({tenantId,kind:'customer' as const,id:'customer'})),limits:{ticketLimit:2,mutationLimit:4,recoveryReserve:2,uploadLimit:2}};
  const repo=(tenant='a',id='customer')=>new LocalBetaAdmissionRepository(db,createVerifiedTenantScope(tenant,id,['customer'],1),{kind:'customer',id});
  return {sqlite,db,operator,input,repo};
}

describe('Local beta durable authority',()=>{
  it('requires exactly two tenants, explicit principals and finite integer limits',()=>{
    const f=fixture(); try {
      for (const tenants of [[],['a'],['a','a'],['a','b','c']]) expect(()=>validateBetaInitialization({...f.input,tenants})).toThrow();
      for (const mutationLimit of [0,-1,1,1.5,NaN,1001]) expect(()=>validateBetaInitialization({...f.input,limits:{...f.input.limits,mutationLimit}})).toThrow();
      expect(()=>f.operator.initialize({...f.input,invitations:[{tenantId:'a',kind:'customer',id:'unknown'}]},0)).toThrow();
      expect(f.operator.status()).toBeUndefined();
    } finally {f.sqlite.close();}
  });
  it('assertion fails on missing policy, unknown tenant/principal and conflict-update revocation; every batch rolls back',async()=>{
    const f=fixture();try {
      await expect(f.db.batch([...f.repo().statements('create')])).rejects.toThrow(/CHECK/);
      await expect(f.repo().authorize()).rejects.toMatchObject({code:'beta_admission_unavailable'});
      f.operator.initialize(f.input,0);
      for (const repo of [f.repo('c'),f.repo('a','unknown')]) {
        await expect(f.db.batch([...repo.statements('create')])).rejects.toThrow(/CHECK/);
        await expect(repo.authorize()).rejects.toMatchObject({code:'beta_not_invited'});
      }
      await f.db.batch([...f.repo().statements('create')]);
      f.sqlite.prepare("DELETE FROM local_beta_invitations WHERE tenant_id='a'").run();
      await expect(f.db.batch([...f.repo().statements('conversation')])).rejects.toThrow(/CHECK/);
      expect(f.operator.status()).toMatchObject({tickets:1,mutations:1});
      expect(f.sqlite.prepare('SELECT count(*) AS n FROM local_beta_assertion').get()).toEqual({n:1});
    }finally{f.sqlite.close();}
  });
  it('serializes cross-tenant last slots, reserves accepted work, and rolls back counters on later failure',async()=>{
    const f=fixture();try{
      f.operator.initialize(f.input,0);
      const attempts=await Promise.allSettled(Array.from({length:10},(_,i)=>f.db.batch([...f.repo(i%2?'a':'b').statements('create')])));
      expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(2);
      await expect(f.repo().authorize('create')).rejects.toMatchObject({code:'beta_mutation_limit'});
      const failure=f.db.prepare("INSERT INTO local_beta_assertion(singleton,accepted) VALUES(2,1)");
      await expect(f.db.batch([...f.repo().statements('conversation'),failure])).rejects.toThrow();
      expect(f.operator.status()).toMatchObject({tickets:2,mutations:2});
      await f.db.batch([...f.repo().statements('conversation')]);
      await f.db.batch([...f.repo('b').statements('conversation')]);
      await expect(f.db.batch([...f.repo().statements('conversation')])).rejects.toThrow(/CHECK/);
      expect(f.operator.status()).toMatchObject({tickets:2,mutations:4});
    }finally{f.sqlite.close();}
  });
  it('stop/resume is revision checked, durable across fresh objects, preserves counters and historical runs',async()=>{
    const f=fixture();try{
      f.operator.initialize(f.input,0);
      await f.db.batch([...f.repo().statements('create')]);
      f.operator.change('stop-intake',1);
      await expect(f.repo().authorize('create')).rejects.toMatchObject({code:'beta_intake_stopped'});
      await expect(f.repo().chargeUploadAttempt()).rejects.toMatchObject({code:'beta_intake_stopped'});
      await f.db.batch([...f.repo().statements('conversation')]);
      f.operator.change('stop-writes',2);
      await expect(f.repo().authorize('conversation')).rejects.toMatchObject({code:'beta_intake_stopped'});
      await expect(f.repo().authorize()).resolves.toMatchObject({mutations:2});
      expect(()=>f.operator.change('resume',2)).toThrow(/revision/);
      const restarted=new LocalBetaOperator(f.sqlite);
      expect(restarted.status()).toMatchObject({state:'writes_stopped',mutations:2});
      restarted.change('resume',3);
      expect(restarted.status()).toMatchObject({state:'running',mutations:2});
      restarted.initialize({...f.input,runId:'run-2'},4);
      expect(f.sqlite.prepare("SELECT mutations FROM local_beta_runs WHERE run_id='run-1'").get()).toEqual({mutations:2});
      expect(f.sqlite.prepare('SELECT prior_mutations FROM local_beta_operator_receipts WHERE revision=5').get()).toEqual({prior_mutations:2});
      expect(restarted.status()).toMatchObject({mutations:0,revision:5});
    }finally{f.sqlite.close();}
  });
  it('upload attempts persist without refund and stay independent of conversation counts',async()=>{
    const f=fixture();try{
      f.operator.initialize(f.input,0);
      await f.repo().chargeUploadAttempt(); await f.repo('b').chargeUploadAttempt();
      await expect(f.repo().chargeUploadAttempt()).rejects.toMatchObject({code:'beta_upload_limit'});
      expect(f.operator.status()).toMatchObject({upload_attempts:2,mutations:0,tickets:0});
    }finally{f.sqlite.close();}
  });
  it('fixed PATCH guards charge material transitions only and recheck live session authority in the batch',async()=>{
    const f=fixture();try{
      f.operator.initialize(f.input,0);
      f.sqlite.prepare("INSERT INTO tickets(tenant_id,id,subject,customer_email,status,source) VALUES ('a','ticket','Safe','a@example.invalid','open','fixture')").run();
      await f.db.batch([...f.repo().ticketChangeStatements('ticket',{status:'open'})]);
      expect(f.operator.status()).toMatchObject({mutations:0});
      await f.db.batch([...f.repo().ticketChangeStatements('ticket',{status:'pending'}),f.db.prepare("UPDATE tickets SET status='pending' WHERE tenant_id='a' AND id='ticket'")]);
      expect(f.operator.status()).toMatchObject({mutations:1});
      f.operator.change('stop-writes',1);
      await f.db.batch([...f.repo().ticketChangeStatements('ticket',{status:'pending'})]);
      expect(f.operator.status()).toMatchObject({mutations:1});
      await expect(f.db.batch([...f.repo().ticketChangeStatements('ticket',{status:'closed'})])).rejects.toThrow(/CHECK/);
      f.operator.change('resume',2);
      const credential={sessionVersion:0,expiresAt:Math.floor(Date.now()/1000)+1000};
      const guarded=new LocalBetaAdmissionRepository(f.db,createVerifiedTenantScope('a','customer',['customer'],1),{kind:'customer',id:'customer'},credential);
      const prepared=guarded.statements('conversation');
      f.sqlite.prepare("UPDATE users SET session_version=1 WHERE tenant_id='a' AND id='customer'").run();
      await expect(f.db.batch([...prepared])).rejects.toThrow(/CHECK/);
      expect(f.operator.status()).toMatchObject({mutations:1});
    }finally{f.sqlite.close();}
  });

});
