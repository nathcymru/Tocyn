import { request as httpRequest } from 'node:http';
import { createRepositories } from '../src/repositories';
import { createSystemTenantScope } from '../src/auth/scope';
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
const port=(()=>{const value=process.env.TOCYN_RUNTIME_TEST_PORT;if(value===undefined)return 8787;if(!/^\d+$/.test(value))throw new Error('TOCYN_RUNTIME_TEST_PORT must be numeric');const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1024||parsed>65535)throw new Error('TOCYN_RUNTIME_TEST_PORT must be between 1024 and 65535');return parsed;})();
const origin='http://localhost:8787';

/** Separate real local Worker test: never fallback to another port, remote D1 or production bindings. */
test('real local Wrangler observes operator revisions on warm connections and retains stop/counters across restart',async t=>{
  const probe=createServer();await new Promise<void>((ok,fail)=>{probe.once('error',fail);probe.listen(port,'127.0.0.1',ok);});await new Promise<void>(ok=>probe.close(()=>ok()));
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
  // An explicitly selected spare TCP port still tests the canonical logical origin.
  // Node fetch normalizes Host to its URL, so use the HTTP transport only for this override.
  const request=async(path:string,options:RequestInit={}):Promise<Response>=>{
    if(port===8787)return fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(5000)});
    if(options.body!==undefined && typeof options.body!=='string')throw new Error('Unsupported runtime-test request body');
    const headers=new Headers(options.headers);headers.set('Host','localhost:8787');
    return new Promise((resolve,reject)=>{
      const outgoing=httpRequest({hostname:'127.0.0.1',port,path,method:options.method??'GET',headers:Object.fromEntries(headers),signal:AbortSignal.timeout(5000)}, incoming=>{
        const chunks:Buffer[]=[];let bytes=0;
        incoming.on('error',reject);
        incoming.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024){incoming.destroy(new Error('Runtime-test response exceeded limit'));return;}chunks.push(chunk);});
        incoming.on('end',()=>{
          const status=incoming.statusCode??500;
          if(status>=300 && status<400){reject(new Error('Unexpected runtime-test redirect'));return;}
          const responseHeaders=new Headers();for(let i=0;i<incoming.rawHeaders.length;i+=2)responseHeaders.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
          resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers:responseHeaders}));
        });
      });
      outgoing.on('error',reject);outgoing.end(options.body);
    });
  };
  const start=async()=>{
    worker=spawn(process.execPath,[wrangler,'dev','--local','--ip','127.0.0.1','--port',String(port),'--persist-to',state,'--config',configFile],{cwd:directory,env,stdio:['ignore',log!,log!]});
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
    const invitations:{tenantId:string;kind:'customer'|'staff'|'api-key';id:string}[]=['fixture-tenant-a','fixture-tenant-b'].flatMap(tenantId=>[{tenantId,kind:'customer' as const,id:'fixture-customer'},{tenantId,kind:'staff' as const,id:'fixture-operator'}]);
    const keys: {apiKey:string;id:string}[]=[];
    for(const tenantId of ['fixture-tenant-a','fixture-tenant-b']) {
      const adapter={prepare:(sql:string)=>({bind:(...args:unknown[])=>({run:async()=>db.prepare(sql).run(...args)})})} as unknown as D1Database;
      const key=await createRepositories(createSystemTenantScope({tenantId,actor:'local-runtime-operator'}),adapter).apiKeys.create('runtime-beta-key',['tickets:read','tickets:write']);
      keys.push(key);invitations.push({tenantId,kind:'api-key',id:key.id});
    }
    new LocalBetaOperator(db).initialize({runId:'runtime-proof',tenants:['fixture-tenant-a','fixture-tenant-b'],invitations,limits:{ticketLimit:2,mutationLimit:4,recoveryReserve:2,uploadLimit:2}},0);db.close();
    log=openSync(join(directory,'runtime.log'),'w',0o600);await start();
    const customer=bootstrap.credentials.find(c=>c.email==='tocyn-auth-test-a@example.invalid')!;
    const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:customer.email,password:customer.password})});assert.equal(login.status,200);const token=(await login.json() as {token:string}).token;
    const headers={Authorization:`Bearer ${token}`};
    for(let n=0;n<5;n++){const res=await request('/api/auth/me',{headers});assert.equal(res.status,200);await res.body?.cancel();}
    const createTicket=(key:string,retry:string)=>request('/api/v1/tickets',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':key,'Idempotency-Key':retry},body:JSON.stringify({subject:'Runtime bounded create',body:'Synthetic runtime message',customer_email:customer.email})});
    const accepted=await createTicket(keys[0].apiKey,'runtime-first');assert.equal(accepted.status,201);const acceptedBody=await accepted.json() as {id:string};
    const lastSlot=await Promise.all([createTicket(keys[0].apiKey,'runtime-a-last'),createTicket(keys[1].apiKey,'runtime-b-last')]);
    assert.deepEqual(lastSlot.map(r=>r.status).sort(),[201,429]);for(const r of lastSlot)await r.body?.cancel();
    assert.equal(JSON.parse(cli('status').stdout).mutations,2,'Direct operator reader observes Worker counter commits');
    const reply=(retry:string)=>request(`/api/v1/tickets/${acceptedBody.id}/articles`,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':keys[0].apiKey,'Idempotency-Key':retry},body:JSON.stringify({body:'Runtime bounded recovery reply'})});
    // Dispatch live mutation traffic before the operator changes policy. D1 decides their serialized order.
    const inFlight=[reply('runtime-before-stop-a'),reply('runtime-before-stop-b')];
    const stopped=cli('stop-writes',1);assert.equal(stopped.status,0,'Operator stop against running worker');
    const traffic=await Promise.all(inFlight);
    assert.ok(traffic.every(r=>r.status===201||r.status===503));for(const r of traffic)await r.body?.cancel();
    const stoppedCounts=JSON.parse(cli('status').stdout);
    assert.equal(stoppedCounts.mutations,2+traffic.filter(r=>r.status===201).length);
    const stoppedNew=await reply('runtime-after-stop');assert.equal(stoppedNew.status,503);await stoppedNew.body?.cancel();
    const storedReplay=await createTicket(keys[0].apiKey,'runtime-first');assert.equal(storedReplay.status,201);assert.equal(storedReplay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await storedReplay.json(),acceptedBody);
    const stoppedStatus=JSON.parse(stopped.stdout);assert.equal(stoppedStatus.state,'writes_stopped');assert.equal(stoppedStatus.revision,2);
    const afterStop=await request('/api/auth/me',{headers});assert.equal(afterStop.status,200);await afterStop.body?.cancel();
    const diagnostics=await (await request('/__local/beta-diagnostics')).json() as {revision:number}[];
    assert.ok(diagnostics.length>0&&diagnostics.every(e=>e.revision===2),'Warmed Worker connections observe the committed operator revision');
    const malformed=join(directory,'malformed.json');writeFileSync(malformed,'{"synthetic-secret-sentinel-DO-NOT-ECHO": invalid}',{mode:0o600});
    const rejected=cli('new-run',2,malformed);assert.notEqual(rejected.status,0);assert.ok(!(rejected.stdout+rejected.stderr).includes('synthetic-secret-sentinel-DO-NOT-ECHO'));
    assert.notEqual(cli('resume',1).status,0,'Stale revision must fail');
    await stop();await start();
    const status=JSON.parse(cli('status').stdout);assert.equal(status.state,'writes_stopped');assert.equal(status.revision,2);assert.equal(status.mutations,stoppedCounts.mutations);
    const postRestart=await request('/api/auth/me',{headers});assert.equal(postRestart.status,200);await postRestart.body?.cancel();
    assert.equal(cli('resume',2).status,0);
    const active=await request('/api/auth/me',{headers});assert.equal(active.status,200);await active.body?.cancel();
    const resumed=JSON.parse(cli('status').stdout);assert.equal(resumed.state,'running');assert.equal(resumed.revision,3);assert.equal(resumed.mutations,stoppedCounts.mutations);
    assert.ok(resumed.mutations<=4);
    if(resumed.mutations<4) {
      while(JSON.parse(cli('status').stdout).mutations<3) {const r=await reply('runtime-fill-reserve');assert.equal(r.status,201);await r.body?.cancel();}
      const finalRace=await Promise.all([reply('runtime-same-final'),reply('runtime-same-final')]);
      assert.deepEqual(finalRace.map(r=>r.status),[201,201]);assert.deepEqual(await finalRace[0].json(),await finalRace[1].json());
      assert.equal(JSON.parse(cli('status').stdout).mutations,4);
    }
    const exhausted=await reply('runtime-exhausted');assert.equal(exhausted.status,429);await exhausted.body?.cancel();
    t.diagnostic(JSON.stringify({runtime:'local-wrangler',warmReads:5,operatorRevisionObserved:true,restartRetainedStop:true,staleRevisionDenied:true,malformedPolicyRedacted:true,providerBindings:0,mutationCeiling:4,concurrentStopPreservedAccepted:true,cleanup:'run-owned state removed'}));
  }finally{await stop();if(log!==undefined)closeSync(log);rmSync(directory,{recursive:true,force:true});}
});
