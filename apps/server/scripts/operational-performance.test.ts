import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureOperations } from './operational-performance';
test('records reproducible nearest-rank latency and distinct failure counts without error details', async () => {
  let clock=0; let count=0;
  const result=await measureOperations({samples:4,concurrency:1,expectedStatus:200,now:()=>clock,run:async()=>{
    count++;clock+=count;
    if(count===3)throw new Error('synthetic-secret');
    return {status:count===2?500:200};
  }});
  assert.deepEqual(result.latencyMs,{min:1,p50:2,p95:4,p99:4,max:4});
  assert.equal(result.elapsedMs,10);assert.equal(result.expectedResponses,2);
  assert.equal(result.unexpectedResponses,1);assert.equal(result.transportFailures,1);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);
});
test('never exceeds configured concurrency and completes each requested operation once', async()=>{
  let active=0;let peak=0;let completed=0;
  const result=await measureOperations({samples:17,concurrency:3,expectedStatus:403,run:async()=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;completed++;return {status:403};
  }});
  assert.equal(peak,3);assert.equal(completed,17);assert.equal(result.expectedResponses,17);
});
test('rejects invalid bounds before performing a request',async()=>{
  let called=false;
  for(const values of [{samples:0,concurrency:1},{samples:1001,concurrency:1},{samples:10,concurrency:9},{samples:1,concurrency:2}]) {
    await assert.rejects(measureOperations({...values,expectedStatus:200,run:async()=>{called=true;return {status:200};}}),/bounds/);
  }
  assert.equal(called,false);
});

test('drains in-flight requests and stops scheduling when the clock fails',async()=>{
  const times=[0,1,2,0,3]; let calls=0; let settled=false;
  const finishes:Array<()=>void>=[];
  const measured=measureOperations({samples:10,concurrency:2,expectedStatus:200,now:()=>times.shift()!,run:()=>{
    calls++;return new Promise(resolve=>finishes.push(()=>resolve({status:200})));
  }});
  const observed=measured.then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  assert.equal(calls,2);finishes[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.equal(calls,2);
  finishes[1]();const error=await observed;
  assert.match(error.message,/Invalid measurement clock/);assert.equal(calls,2);
});
test('rejects a nonfinite starting clock before creating operations',async()=>{
  let calls=0;
  await assert.rejects(measureOperations({samples:1,concurrency:1,expectedStatus:200,now:()=>NaN,run:async()=>{calls++;return {status:200};}}),/Invalid measurement clock/);
  assert.equal(calls,0);
});
