/** Private host tooling. Never imported into application bundles. */
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { runFundedLocalSnoozeStep } from '../src/auth/automation-composition';
type Result = Awaited<ReturnType<typeof runFundedLocalSnoozeStep>>;
type Purpose = 'new-work' | 'recovery';
type Row = { tenantId: string; status: 'ready' | 'running' | 'recovery' | 'paused';
  purpose: Purpose; generation: number; outcome: 'none' | 'no-snoozes' | 'empty' | 'resurfaced';
  reason: 'none' | 'unknown' | 'admission-rejected' | 'marker-unavailable' };
type Scheduler = { set: (callback: () => void, milliseconds: number) => unknown; clear: (handle: unknown) => void };
const scheduler: Scheduler = { set: (callback,ms) => setTimeout(callback,ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const identity = (value: string) => value.length>0 && new TextEncoder().encode(value).byteLength<=160 && !/[\u0000-\u001f\u007f]/.test(value);

export async function createLocalSnoozeController(input: { tenantIds: readonly string[]; markerPath: string;
  mode: 'fresh' | 'restart'; invoke: (tenantId: string,purpose: Purpose) => Promise<Result>; scheduler?: Scheduler }) {
  const tenantIds=Object.freeze([...input.tenantIds]);
  if(!tenantIds.length || !tenantIds.every(identity) || new Set(tenantIds).size!==tenantIds.length) throw new Error('Invalid trusted catalogue');
  let rows: Row[]=tenantIds.map(tenantId=>({tenantId,status:'ready',purpose:'new-work',generation:0,outcome:'none',reason:'none'}));
  let usable=true;
  try {
    const metadata=await stat(input.markerPath);
    if(metadata.size>1024+tenantIds.length*512)throw new Error('Marker exceeds bound');
    const marker=JSON.parse(await readFile(input.markerPath,'utf8')) as {version:number;rows:Row[]};
    if(input.mode==='fresh' || marker.version!==1 || !Array.isArray(marker.rows) || marker.rows.length!==tenantIds.length
      || marker.rows.some((row,index)=>!row || row.tenantId!==tenantIds[index]
        || !['ready','running','recovery','paused'].includes(row.status) || !['new-work','recovery'].includes(row.purpose)
        || !Number.isSafeInteger(row.generation) || row.generation<0
        || !['none','no-snoozes','empty','resurfaced'].includes(row.outcome)
        || !['none','unknown','admission-rejected','marker-unavailable'].includes(row.reason)))throw new Error('Invalid marker');
    rows=marker.rows.map(row=>({...row,status:row.status==='paused' || row.status==='running' && row.purpose==='recovery'?'paused':'recovery',purpose:'recovery'}));
  } catch(error) {
    if(!(input.mode==='fresh' && (error as NodeJS.ErrnoException).code==='ENOENT')) {
      usable=false;rows=rows.map(row=>({...row,status:'paused',reason:'marker-unavailable'}));
    }
  }
  const timers=input.scheduler??scheduler;
  let stopped=false,started=false,timer:unknown,flight:Promise<void>|undefined;
  const persist=async()=>{
    if(!usable)throw new Error('Marker unavailable; repair explicitly before resume');
    const temporary=`${input.markerPath}.tmp`;
    await writeFile(temporary,JSON.stringify({version:1,rows}),{mode:0o600});
    await rename(temporary,input.markerPath);
  };
  const pauseForMarker=()=>{usable=false;rows=rows.map(row=>({...row,status:'paused',reason:'marker-unavailable'}));};
  const tick=():Promise<void>=>{
    if(stopped)return Promise.resolve();
    if(flight)return flight;
    if(timer!==undefined){timers.clear(timer);timer=undefined;}
    const run=async()=>{
      for(const row of rows){
        if(stopped || row.status==='paused')continue;
        const purpose:Purpose=row.status==='recovery'?'recovery':'new-work';
        row.status='running';row.purpose=purpose;
        try{await persist();}catch{pauseForMarker();break;}
        if(stopped)break;
        let result:Result;
        try{
          result=await input.invoke(row.tenantId,purpose);
          if(!result || (result.status==='complete'
            ? !Number.isSafeInteger(result.generation) || result.generation<0 || !['no-snoozes','empty','resurfaced'].includes(result.outcome)
            : !['recovery-needed','paused'].includes(result.status) || !['unknown','admission-rejected'].includes(result.reason)))throw new Error('Invalid private due result');
        }catch{result={status:purpose==='recovery'?'paused':'recovery-needed',reason:'unknown'};}
        if(result.status==='complete'){
          row.status='ready';row.generation=result.generation;row.outcome=result.outcome;row.reason='none';
        }else{row.status=result.status==='recovery-needed' && purpose==='new-work'?'recovery':'paused';row.reason=result.reason;}
        try{await persist();}catch{pauseForMarker();break;}
      }
    };
    flight=run().finally(()=>{flight=undefined;if(started&&!stopped)timer=timers.set(()=>{void tick();},60000);});
    return flight;
  };
  return {
    async start(){if(started||stopped)return;started=true;await tick();},
    // Host-only explicit tick is useful for deterministic timer evidence.
    tick,
    snapshot:()=>structuredClone(rows),
    async resume(tenantId:string){
      if(flight||stopped||!usable)throw new Error('Cannot resume current controller');
      const row=rows.find(candidate=>candidate.tenantId===tenantId);if(!row)throw new Error('Tenant outside catalogue');
      if(timer!==undefined){timers.clear(timer);timer=undefined;}
      row.status='recovery';row.purpose='recovery';row.reason='none';
      flight=persist().catch(error=>{pauseForMarker();throw error;}).finally(()=>{flight=undefined;if(started&&!stopped)timer=timers.set(()=>{void tick();},60000);});
      await flight;
    },
    async dispose(){stopped=true;if(timer!==undefined)timers.clear(timer);await flight;},
  };
}
