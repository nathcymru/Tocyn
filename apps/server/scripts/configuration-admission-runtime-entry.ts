export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';

type Metric={path:string;method:string;d1RowsRead:number;d1RowsWritten:number;d1Calls:number;maxBatchRead:number;maxBatchWritten:number;
  preAdmissionBodyLoads:number};
const attempts:Metric[]=[];
let beforeCanonical:''|'session'|'mfa'|'capability'|'authority'|'population-growth'|'target-update'|'grant-collision'|'closure'='';
let failCanonicalAck=false;

function instrumentDatabase(db:any,metric:Metric):any{
  const statements=new WeakMap<object,{raw:any;sql:string;values:any[]}>();
  const add=(meta:any)=>{metric.d1Calls++;const read=meta?.rows_read??0,written=meta?.rows_written??0;
    metric.d1RowsRead+=read;metric.d1RowsWritten+=written;metric.maxBatchRead=Math.max(metric.maxBatchRead,read);metric.maxBatchWritten=Math.max(metric.maxBatchWritten,written);};
  const loadsBody=(sql:string)=>{const normalized=sql.replace(/\s+/g,' ');
    return /SELECT (?:a\.\*|\*) FROM automation_rules/i.test(normalized)||
      /SELECT [^;]*(?:conditions|action_config)[^;]* FROM automation_rules/i.test(normalized);};
  const before=(sql:string)=>{if(loadsBody(sql))metric.preAdmissionBodyLoads++;};
  const wrap=(raw:any,sql:string,values:any[]=[]):any=>{const proxy=new Proxy(raw,{get(target,property){
    if(property==='bind')return(...bound:any[])=>wrap(target.bind(...bound),sql,bound);
    if(property==='first')return async(column?:string)=>{before(sql);const result=await target.all();add(result.meta);const row=result.results?.[0]??null;return column&&row?row[column]:row;};
    if(property==='all')return async()=>{before(sql);const result=await target.all();add(result.meta);return result;};
    if(property==='run')return async()=>{const result=await target.run();add(result.meta);return result;};
    if(property==='raw')return async(options?:any)=>{before(sql);const result=await target.all();add(result.meta);const keys=result.results?.[0]?Object.keys(result.results[0]):[];
      const rows=(result.results??[]).map((row:any)=>keys.map(key=>row[key]));return options?.columnNames?[keys,...rows]:rows;};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});statements.set(proxy,{raw,sql,values});return proxy;};
  return new Proxy(db,{get(target,property){
    if(property==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);
    if(property==='batch')return async(batch:any[])=>{
      const records=batch.map(statement=>statements.get(statement));
      const canonical=records.some(record=>record?.sql.includes('INSERT INTO budget_mutation_assertion'));
      const action=canonical?beforeCanonical:'';if(canonical)beforeCanonical='';
      if(action==='session')await target.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='runtime-tenant' AND id='admin'").run();
      if(action==='mfa')await target.prepare("UPDATE users SET mfa_enabled=0 WHERE tenant_id='runtime-tenant' AND id='admin'").run();
      if(action==='capability')await target.prepare("UPDATE deployment_capability_ceiling SET revision=revision+1,enabled=0 WHERE capability='automations.manage'").run();
      if(action==='authority')await target.prepare("UPDATE budget_deployment_authority SET state='revoked'").run();
      if(action==='population-growth')await target.prepare(`INSERT INTO automation_rules(tenant_id,id,name,event_type,conditions,action_type,action_config,is_active)
        VALUES('runtime-tenant','automation_race_growth','Concurrent growth','ticket.created','[]','webhook','{}',1)`).run();
      if(action==='target-update')await target.prepare(`UPDATE automation_rules SET name='Concurrent edit'
        WHERE tenant_id='runtime-tenant' AND id='automation_mutable'`).run();
      if(action==='grant-collision'){
        const operation=records.find(record=>record?.sql.includes('INSERT INTO budget_grant_operations'));
        if(operation)await target.prepare(`INSERT INTO budget_grant_operations
          (tenant_id,reservation_id,holder_id,operation_id,aggregate_id,operation_fingerprint,operation_envelope_json)
          VALUES(?,?,?,?,?,'synthetic-collision','{}')`).bind(operation.values[0],operation.values[1],operation.values[2],operation.values[3],operation.values[4]).run();
      }
      if(action==='closure'){
        const operation=records.find(record=>record?.sql.includes('INSERT INTO budget_grant_operations'));
        if(operation)await target.prepare(`INSERT INTO budget_grant_closures
          (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
          VALUES(?,?,?,?,?, 'synthetic-closed',1,'{}','{}')`).bind(operation.values[0],operation.values[1],operation.values[2],operation.values[4],crypto.randomUUID()).run();
      }
      const result=await target.batch(records.map(record=>record?.raw));
      const read=result.reduce((sum:number,item:any)=>sum+(item.meta?.rows_read??0),0),written=result.reduce((sum:number,item:any)=>sum+(item.meta?.rows_written??0),0);
      metric.d1Calls++;metric.d1RowsRead+=read;metric.d1RowsWritten+=written;metric.maxBatchRead=Math.max(metric.maxBatchRead,read);metric.maxBatchWritten=Math.max(metric.maxBatchWritten,written);
      if(canonical&&failCanonicalAck){failCanonicalAck=false;throw new Error('Synthetic lost canonical response');}
      return result;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
}

export default{async fetch(request:Request,env:any,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/__configuration-control'){
    if(request.method==='POST'){const control=await request.json() as {beforeCanonical?:typeof beforeCanonical;failCanonicalAck?:boolean;discard?:boolean};
      if(control.beforeCanonical)beforeCanonical=control.beforeCanonical;if(control.failCanonicalAck)failCanonicalAck=true;
      if(control.discard)apiTicketBudgetCache.discardForTrustedRuntime();}
    return Response.json({attempts});
  }
  const metric:Metric={path:url.pathname,method:request.method,d1RowsRead:0,d1RowsWritten:0,d1Calls:0,maxBatchRead:0,maxBatchWritten:0,preAdmissionBodyLoads:0};
  try{return await app.fetch(request,{...env,DB:instrumentDatabase(env.DB,metric)},ctx);}finally{attempts.push(metric);}
}};
