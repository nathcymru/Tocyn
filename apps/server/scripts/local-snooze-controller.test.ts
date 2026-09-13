import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalSnoozeController } from './local-snooze-controller';
const timers=()=>({delays:[] as number[],callbacks:[] as (()=>void)[],set(callback:()=>void,ms:number){this.delays.push(ms);this.callbacks.push(callback);return callback;},clear(handle:unknown){this.callbacks=this.callbacks.filter(callback=>callback!==handle);}});
test('private controller serializes flights, schedules after completion and disposes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'due-controller-'));const clock=timers();
 let calls=0,finish!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const hold=new Promise<void>(resolve=>{finish=resolve;});
 const controller=await createLocalSnoozeController({tenantIds:['tenant-a'],markerPath:join(directory,'marker.json'),mode:'fresh',scheduler:clock,
   invoke:async()=>{calls++;entered();await hold;return{status:'complete',generation:1,outcome:'empty'};}});
 try{
  const first=controller.start();const second=controller.tick();await started;assert.equal(calls,1);assert.equal(clock.delays.length,0);
  finish();await Promise.all([first,second]);assert.deepEqual(clock.delays,[60000]);
  await controller.dispose();await controller.tick();assert.equal(calls,1);assert.equal(clock.callbacks.length,0);
 }finally{finish();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
test('unknown gets one recovery and a persisted failure pause survives restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'due-controller-')),path=join(directory,'marker.json');const purposes:string[]=[];
 let controller=await createLocalSnoozeController({tenantIds:['tenant-a'],markerPath:path,mode:'fresh',scheduler:timers(),
   invoke:async(_tenant,purpose)=>{purposes.push(purpose);throw new Error('synthetic lost response');}});
 try{
  await controller.start();assert.equal(controller.snapshot()[0].status,'recovery');await controller.tick();assert.equal(controller.snapshot()[0].status,'paused');
  await controller.dispose();controller=await createLocalSnoozeController({tenantIds:['tenant-a'],markerPath:path,mode:'restart',scheduler:timers(),
    invoke:async(_tenant,purpose)=>{purposes.push(purpose);return{status:'complete',generation:2,outcome:'no-snoozes'};}});
  await controller.start();assert.deepEqual(purposes,['new-work','recovery']);
  await controller.resume('tenant-a');await controller.tick();assert.deepEqual(purposes,['new-work','recovery','recovery']);assert.equal(controller.snapshot()[0].status,'ready');
 }finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
test('unreadable marker pauses without a reset or invocation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'due-controller-')),path=join(directory,'marker.json');await writeFile(path,'invalid');let calls=0;
 const controller=await createLocalSnoozeController({tenantIds:['tenant-a'],markerPath:path,mode:'restart',scheduler:timers(),invoke:async()=>{calls++;return{status:'complete',generation:0,outcome:'no-snoozes'};}});
 try{await controller.start();assert.equal(calls,0);assert.equal(controller.snapshot()[0].status,'paused');await assert.rejects(controller.resume('tenant-a'));}
 finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
