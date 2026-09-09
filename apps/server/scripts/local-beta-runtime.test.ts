import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalFixtureBootstrap } from './local-tenant-fixture';
import { openLocalBetaState } from './local-beta-state';
import { LocalBetaOperator } from './local-beta-operator';

const serverRoot=resolve(import.meta.dirname,'..');
const wrangler=resolve(serverRoot,'../../node_modules/wrangler/bin/wrangler.js');
const origin='http://localhost:8787';

/** Separate real local Worker test: never fallback to another port, remote D1 or production bindings. */
test('real local Wrangler observes operator revisions on warm connections and retains stop/counters across restart',async t=>{
  const probe=createServer();await new Promise<void>((ok,fail)=>{probe.once('error',fail);probe.listen(8787,'127.0.0.1',ok);});await new Promise<void>(ok=>probe.close(()=>ok()));
  const directory=mkdtempSync(join(tmpdir(),'tocyn-beta-runtime-'));
  const state=join(directory,'state'),configFile=join(directory,'wrangler.json');
  const env:NodeJS.ProcessEnv={...process.env,WRANGLER_SEND_METRICS:'false'};
  for(const key of Object.keys(env))if(/^(CLOUDFLARE_|CF_API_|RESEND_)/.test(key))delete env[key];
  let worker:ChildProcess|undefined;let log:number|undefined;
  const stop=async()=>{
    if(worker?.pid&&worker.exitCode===null){worker.kill('SIGTERM');await once(worker,'exit');}
    worker=undefined;
  };
  const setup=(args:string[])=>{
    const result=spawnSync(process.execPath,[wrangler,...args,'--config',configFile],{cwd:directory,env,encoding:'utf8',maxBuffer:10*1024*1024});
    assert.equal(result.status,0,'Local Wrangler setup must complete; raw logs stay private');
  };
  const request=async(path:string,options:RequestInit={})=>fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(5000)});
  const start=async()=>{
    worker=spawn(process.execPath,[wrangler,'dev','--local','--ip','127.0.0.1','--port','8787','--persist-to',state,'--config',configFile],{cwd:directory,env,stdio:['ignore',log!,log!]});
    for(let attempt=0;attempt<100;attempt++){
      try{const res=await request('/health');await res.body?.cancel();if(res.status===200)return;}catch{/* Local startup only. */}
      await new Promise(ok=>setTimeout(ok,100));
    }
    assert.fail('Local Worker failed to become healthy; raw logs are not disclosed');
  };
  const cli=(command:string,revision?:number,policyFile?:string)=>spawnSync(process.execPath,['--import','tsx',join(serverRoot,'scripts/run-local-beta-operator.ts'),command,'--local','--persist-to',state,...(revision===undefined?[]:['--expected-revision',String(revision)]),...(policyFile?['--policy',policyFile]:[])],{cwd:serverRoot,env,encoding:'utf8'});
  try{
    const config=JSON.parse(readFileSync(join(serverRoot,'wrangler.local.json'),'utf8'));
    config.main=join(serverRoot,'src/local-index.ts');config.vars.LOCAL_BETA_ENABLED='true';config.d1_databases[0].migrations_dir=join(serverRoot,'migrations');
    assert.ok(config.d1_databases.every((b:{remote:boolean})=>b.remote===false));assert.ok(config.r2_buckets.every((b:{remote:boolean})=>b.remote===false));
    assert.equal(config.workflows,undefined);assert.equal(config.ai,undefined);assert.equal(config.vectorize,undefined);
    const serializedConfig=JSON.stringify(config);assert.ok(!/CLOUDFLARE_API_TOKEN|RESEND_API_KEY/.test(serializedConfig));writeFileSync(configFile,serializedConfig,{mode:0o600});
    const secrets={JWT_SECRET:randomBytes(32).toString('hex'),APP_MASTER_KEY:randomBytes(32).toString('hex'),MFA_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
    writeFileSync(join(directory,'.dev.vars'),Object.entries(secrets).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600});
    setup(['d1','migrations','apply','tocyn-local','--local','--persist-to',state]);
    const bootstrap=await createLocalFixtureBootstrap(secrets);const seed=join(directory,'seed.sql');writeFileSync(seed,bootstrap.sql,{mode:0o600});setup(['d1','execute','tocyn-local','--local','--persist-to',state,'--file',seed]);rmSync(seed);
    const db=openLocalBetaState(state);
    const invitations=['fixture-tenant-a','fixture-tenant-b'].flatMap(tenantId=>[{tenantId,kind:'customer' as const,id:'fixture-customer'},{tenantId,kind:'staff' as const,id:'fixture-operator'}]);
    new LocalBetaOperator(db).initialize({runId:'runtime-proof',tenants:['fixture-tenant-a','fixture-tenant-b'],invitations,limits:{ticketLimit:2,mutationLimit:4,recoveryReserve:2,uploadLimit:2}},0);db.close();
    log=openSync(join(directory,'runtime.log'),'w',0o600);await start();
    const customer=bootstrap.credentials.find(c=>c.email==='tocyn-auth-test-a@example.invalid')!;
    const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:customer.email,password:customer.password})});assert.equal(login.status,200);const token=(await login.json() as {token:string}).token;
    const headers={Authorization:`Bearer ${token}`};
    for(let n=0;n<5;n++){const res=await request('/api/auth/me',{headers});assert.equal(res.status,200);await res.body?.cancel();}
    const stopped=cli('stop-writes',1);assert.equal(stopped.status,0,'Operator stop against running worker');
    const stoppedStatus=JSON.parse(stopped.stdout);assert.equal(stoppedStatus.state,'writes_stopped');assert.equal(stoppedStatus.revision,2);
    const afterStop=await request('/api/auth/me',{headers});assert.equal(afterStop.status,200);await afterStop.body?.cancel();
    const diagnostics=await (await request('/__local/beta-diagnostics')).json() as {revision:number}[];
    assert.ok(diagnostics.length>0&&diagnostics.every(e=>e.revision===2),'Warmed Worker connections observe the committed operator revision');
    const malformed=join(directory,'malformed.json');writeFileSync(malformed,'{"synthetic-secret-sentinel-DO-NOT-ECHO": invalid}',{mode:0o600});
    const rejected=cli('new-run',2,malformed);assert.notEqual(rejected.status,0);assert.ok(!(rejected.stdout+rejected.stderr).includes('synthetic-secret-sentinel-DO-NOT-ECHO'));
    assert.notEqual(cli('resume',1).status,0,'Stale revision must fail');
    await stop();await start();
    const status=JSON.parse(cli('status').stdout);assert.equal(status.state,'writes_stopped');assert.equal(status.revision,2);assert.equal(status.mutations,0);
    const postRestart=await request('/api/auth/me',{headers});assert.equal(postRestart.status,200);await postRestart.body?.cancel();
    assert.equal(cli('resume',2).status,0);
    const active=await request('/api/auth/me',{headers});assert.equal(active.status,200);await active.body?.cancel();
    const resumed=JSON.parse(cli('status').stdout);assert.equal(resumed.state,'running');assert.equal(resumed.revision,3);assert.equal(resumed.mutations,0);
    t.diagnostic(JSON.stringify({runtime:'local-wrangler',warmReads:5,operatorRevisionObserved:true,restartRetainedStop:true,staleRevisionDenied:true,malformedPolicyRedacted:true,providerBindings:0,cleanup:'run-owned state removed'}));
  }finally{await stop();if(log!==undefined)closeSync(log);rmSync(directory,{recursive:true,force:true});}
});
