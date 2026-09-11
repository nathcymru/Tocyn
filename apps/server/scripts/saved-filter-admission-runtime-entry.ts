export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';

type Metric={path:string;method:string;d1RowsRead:number;d1RowsWritten:number;d1Calls:number;maxBatchRead:number;maxBatchWritten:number;
  preAdmissionConditionLoads:number};
const attempts:Metric[]=[];
let pauseCanonical=false,releaseCanonical:(()=>void)|undefined;
let beforeCanonical:''|'session'|'capability'|'authority'|'population-growth'|'target-update'='';

function instrumentDatabase(db:any,metric:Metric):any {
  const statements=new WeakMap<object,{raw:any;sql:string}>();
  const add=(meta:any)=>{metric.d1Calls++;const read=meta?.rows_read??0,written=meta?.rows_written??0;
    metric.d1RowsRead+=read;metric.d1RowsWritten+=written;metric.maxBatchRead=Math.max(metric.maxBatchRead,read);metric.maxBatchWritten=Math.max(metric.maxBatchWritten,written);};
  const loadsConditions=(sql:string)=>{const normalized=sql.replace(/\s+/g,' ');
    return /SELECT (?:f\.\*|\*) FROM ticket_filters/i.test(normalized)||/SELECT [^;]*conditions[^;]* FROM ticket_filters/i.test(normalized);};
  const before=(sql:string)=>{if(loadsConditions(sql))metric.preAdmissionConditionLoads++;};
  const wrap=(raw:any,sql:string):any=>{const proxy=new Proxy(raw,{get(target,property){
    if(property==='bind')return(...values:any[])=>wrap(target.bind(...values),sql);
    if(property==='first')return async(column?:string)=>{before(sql);const result=await target.all();add(result.meta);const row=result.results?.[0]??null;return column&&row?row[column]:row;};
    if(property==='all')return async()=>{before(sql);const result=await target.all();add(result.meta);return result;};
    if(property==='run')return async()=>{const result=await target.run();add(result.meta);return result;};
    if(property==='raw')return async(options?:any)=>{before(sql);const result=await target.all();add(result.meta);const keys=result.results?.[0]?Object.keys(result.results[0]):[];
      const rows=(result.results??[]).map((row:any)=>keys.map(key=>row[key]));return options?.columnNames?[keys,...rows]:rows;};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});statements.set(proxy,{raw,sql});return proxy;};
  return new Proxy(db,{get(target,property){
    if(property==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);
    if(property==='batch')return async(batch:any[])=>{
      const canonical=batch.some(statement=>statements.get(statement)?.sql.includes('INSERT INTO budget_mutation_assertion'));
      if(canonical&&pauseCanonical){pauseCanonical=false;let released=false;releaseCanonical=()=>{released=true;};
        for(let tick=0;tick<400&&!released;tick++)await new Promise(resolve=>setTimeout(resolve,10));releaseCanonical=undefined;
        if(!released)throw new Error('Synthetic canonical pause timed out');}
      const action=canonical?beforeCanonical:'';if(canonical)beforeCanonical='';
      if(action==='session')await target.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='runtime-tenant' AND id='admin'").run();
      if(action==='capability')await target.prepare("UPDATE deployment_capability_ceiling SET revision=revision+1,enabled=0 WHERE capability='filters.manage'").run();
      if(action==='authority')await target.prepare("UPDATE budget_deployment_authority SET state='revoked'").run();
      if(action==='population-growth')await target.prepare(`INSERT INTO ticket_filters(tenant_id,id,name,conditions,is_system)
        VALUES('runtime-tenant','filter_race_growth','Concurrent growth','[]',0)`).run();
      if(action==='target-update')await target.prepare(`UPDATE ticket_filters SET name='Concurrent edit' WHERE tenant_id='runtime-tenant' AND id='filter_mutable'`).run();
      const result=await target.batch(batch.map(statement=>statements.get(statement)?.raw??statement));
      const read=result.reduce((sum:number,item:any)=>sum+(item.meta?.rows_read??0),0),written=result.reduce((sum:number,item:any)=>sum+(item.meta?.rows_written??0),0);
      metric.d1Calls++;metric.d1RowsRead+=read;metric.d1RowsWritten+=written;metric.maxBatchRead=Math.max(metric.maxBatchRead,read);metric.maxBatchWritten=Math.max(metric.maxBatchWritten,written);
      return result;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
}

export default {async fetch(request:Request,env:any,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/__filter-control'){
    if(request.method==='POST'){const control=await request.json() as {pauseCanonical?:boolean;releaseCanonical?:boolean;beforeCanonical?:typeof beforeCanonical;discard?:boolean};
      if(control.pauseCanonical)pauseCanonical=true;if(control.releaseCanonical)releaseCanonical?.();if(control.beforeCanonical)beforeCanonical=control.beforeCanonical;
      if(control.discard)apiTicketBudgetCache.discardForTrustedRuntime();}
    return Response.json({attempts,canonicalPaused:!!releaseCanonical});
  }
  const metric:Metric={path:url.pathname,method:request.method,d1RowsRead:0,d1RowsWritten:0,d1Calls:0,maxBatchRead:0,maxBatchWritten:0,
    preAdmissionConditionLoads:0};
  try{return await app.fetch(request,{...env,DB:instrumentDatabase(env.DB,metric)},ctx);}finally{attempts.push(metric);}
}};
