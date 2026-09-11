export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';
import { LocalAuthCaptureTransport } from '../src/services/email/transport';

type Attempt = { path:string; method:string; d1RowsRead:number; d1RowsWritten:number; d1Calls:number; r2Gets:number };
const attempts:Attempt[]=[];
const capture=new LocalAuthCaptureTransport();
const deliverySettlements:string[]=[];
const settleOperation=apiTicketBudgetCache.settleOperation.bind(apiTicketBudgetCache);
apiTicketBudgetCache.settleOperation=(authority,outcome,now)=>{
  if(authority.operationId.startsWith('ticket-email:'))deliverySettlements.push(outcome);
  return settleOperation(authority,outcome,now);
};
let beforeDelivery:''|'session'|'mfa'|'role'|'policy'|'restriction'|'closure'|'ticket'='';

function instrumentDatabase(db:any,metric:Attempt):any {
  const statements=new WeakMap<object,{raw:any;sql:string;values:any[]}>();
  const add=(meta:any)=>{metric.d1Calls++;metric.d1RowsRead+=meta?.rows_read??0;metric.d1RowsWritten+=meta?.rows_written??0;};
  const wrap=(raw:any,sql:string,values:any[]=[]):any=>{const proxy=new Proxy(raw,{get(target,property){
    if(property==='bind')return(...bound:any[])=>wrap(target.bind(...bound),sql,bound);
    if(property==='first')return async(column?:string)=>{const result=await target.all();add(result.meta);const row=result.results?.[0]??null;return column&&row?row[column]:row;};
    if(property==='all')return async()=>{const result=await target.all();add(result.meta);return result;};
    if(property==='run')return async()=>{const result=await target.run();add(result.meta);return result;};
    if(property==='raw')return async(options?:any)=>{const result=await target.all();add(result.meta);const keys=result.results?.[0]?Object.keys(result.results[0]):[];
      const rows=(result.results??[]).map((row:any)=>keys.map(key=>row[key]));return options?.columnNames?[keys,...rows]:rows;};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});statements.set(proxy,{raw,sql,values});return proxy;};
  return new Proxy(db,{get(target,property){
    if(property==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);
    if(property==='batch')return async(batch:any[])=>{
      const delivery=batch.some(statement=>statements.get(statement)?.sql.includes('tickets t JOIN articles a'));
      if(delivery&&beforeDelivery){const action=beforeDelivery;beforeDelivery='';
        if(action==='session')await target.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='runtime-tenant' AND id='runtime-staff'").run();
        if(action==='mfa')await target.prepare("UPDATE users SET mfa_enabled=0 WHERE tenant_id='runtime-tenant' AND id='runtime-staff'").run();
        if(action==='role')await target.prepare("UPDATE users SET role='customer' WHERE tenant_id='runtime-tenant' AND id='runtime-staff'").run();
        if(action==='policy')await target.prepare("UPDATE budget_deployment_authority SET state='revoked' WHERE deployment_id='runtime-deployment'").run();
        if(action==='restriction')await target.prepare("UPDATE budget_tenant_allocations SET restriction_json=json_set(restriction_json,'$.revision',2) WHERE tenant_id='runtime-tenant'").run();
        if(action==='ticket')await target.prepare("UPDATE tickets SET customer_email='changed@example.invalid' WHERE tenant_id='runtime-tenant' AND id='ticket'").run();
        if(action==='closure'){const operation=batch.map(statement=>statements.get(statement)).find(item=>item?.sql.includes('INSERT INTO budget_grant_operations'));
          if(operation)await target.prepare(`INSERT INTO budget_grant_closures(tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,
            operation_set_fingerprint,operation_count,measured_json,uncertain_json) VALUES(?,?,?,?,?,?,1,'{}','{}')`)
            .bind(operation.values[0],operation.values[1],operation.values[2],operation.values[4],`synthetic:${crypto.randomUUID()}`,'synthetic').run();}
      }
      const result=await target.batch(batch.map(statement=>statements.get(statement)?.raw??statement));
      for(const item of result)add(item.meta);return result;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
}
function instrumentBucket(bucket:any,metric:Attempt):any{return new Proxy(bucket,{get(target,property){const value=Reflect.get(target,property);
  if(property==='get')return(...args:any[])=>{metric.r2Gets++;return value.apply(target,args);};return typeof value==='function'?value.bind(target):value;}});}

export default {async fetch(request:Request,env:any,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/__ticket-email-control'){
    if(request.method==='POST'){const input=await request.json() as {beforeDelivery?:typeof beforeDelivery;failNext?:number;discard?:boolean;reset?:boolean};
      if(input.beforeDelivery)beforeDelivery=input.beforeDelivery;if(input.failNext!==undefined)capture.failNext(input.failNext);
      if(input.discard)apiTicketBudgetCache.discardForTrustedRuntime();if(input.reset)capture.reset();}
    return Response.json({attempts,messages:capture.list().map(message=>({to:message.to,subject:message.subject})),beforeDelivery,
      deliverySettlements,cache:apiTicketBudgetCache.inspectForTrustedRuntime()});
  }
  const metric:Attempt={path:url.pathname,method:request.method,d1RowsRead:0,d1RowsWritten:0,d1Calls:0,r2Gets:0};
  try{return await app.fetch(request,{...env,DB:instrumentDatabase(env.DB,metric),ATTACHMENTS_BUCKET:instrumentBucket(env.ATTACHMENTS_BUCKET,metric),
    emailTransport:capture},ctx);}finally{attempts.push(metric);}
}};
