export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';

let action: 'revoke'|'pause-growth'|undefined;
const measurements: Array<{path:string;rowsRead:number;rowsWritten:number}>=[];

function database(db:any){
  const states=new WeakMap<object,{raw:any;sql:string}>();
  const wrap=(raw:any,sql:string):any=>{const proxy=new Proxy(raw,{get(target,key){
    if(key==='bind')return(...values:any[])=>wrap(target.bind(...values),sql);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});states.set(proxy,{raw,sql});return proxy;};
  return new Proxy(db,{get(target,key){
    if(key==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);
    if(key==='batch')return async(statements:any[])=>{
      const dashboard=statements.some(statement=>states.get(statement)?.sql.includes('budget_mutation_assertion'));
      if(dashboard&&action){const current=action;action=undefined;
        if(current==='revoke')await target.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='summary-a' AND id='summary-actor'").run();
        if(current==='pause-growth')await target.prepare("INSERT INTO ticket_sla_pause_intervals(tenant_id,ticket_id,started_at,reason,support_state_revision) VALUES('summary-a','summary-ticket','2026-09-11T12:00:00.000Z','waiting',1)").run();
      }
      const results=await target.batch(statements.map(statement=>states.get(statement)?.raw??statement));
      const active=(globalThis as any).__summaryMeasurement;
      if(active)for(const result of results){active.rowsRead+=result.meta?.rows_read??0;active.rowsWritten+=result.meta?.rows_written??0;}
      return results;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}

export default {async fetch(request:Request,env:any,ctx:ExecutionContext){
  const path=new URL(request.url).pathname;
  if(path==='/__summary-control'){if(request.method==='POST')action=(await request.json() as any).action;return Response.json({measurements});}
  const active={path,rowsRead:0,rowsWritten:0};(globalThis as any).__summaryMeasurement=active;
  try{return await app.fetch(request,{...env,DB:database(env.DB)},ctx);}finally{measurements.push(active);delete (globalThis as any).__summaryMeasurement;}
}};
