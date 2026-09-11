export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';
import { apiTicketBudgetCache } from '../src/middleware/budget-admission.middleware';

type Action=''|'session'|'role'|'mfa'|'authority'|'population-growth';
type Metric={path:string;method:string;d1RowsRead:number;d1RowsWritten:number;categoryRowsLoaded:number};
const attempts:Metric[]=[];let beforeCanonical:Action='';
let loseNextCanonicalAck=false;

function instrumentDatabase(db:any,metric:Metric):any{
  const statements=new WeakMap<object,{raw:any;sql:string}>();
  const add=(meta:any)=>{metric.d1RowsRead+=meta?.rows_read??0;metric.d1RowsWritten+=meta?.rows_written??0;};
  const before=(sql:string,result:any)=>{if(/SELECT \* FROM knowledge_categories/i.test(sql))metric.categoryRowsLoaded+=result?.results?.length??0;};
  const wrap=(raw:any,sql:string):any=>new Proxy(raw,{get(target,property){
    if(property==='bind')return(...values:any[])=>{const value=wrap(target.bind(...values),sql);statements.set(value,{raw:target.bind(...values),sql});return value;};
    if(property==='first')return async(column?:string)=>{const result=await target.all();add(result.meta);before(sql,result);const row=result.results?.[0]??null;return column&&row?row[column]:row;};
    if(property==='all')return async()=>{const result=await target.all();add(result.meta);before(sql,result);return result;};
    if(property==='run')return async()=>{const result=await target.run();add(result.meta);return result;};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  return new Proxy(db,{get(target,property){
    if(property==='prepare')return(sql:string)=>{const raw=target.prepare(sql),value=wrap(raw,sql);statements.set(value,{raw,sql});return value;};
    if(property==='batch')return async(batch:any[])=>{
      const canonical=batch.some(statement=>statements.get(statement)?.sql.includes('INSERT INTO budget_mutation_assertion'));
      const action=canonical?beforeCanonical:'';if(canonical)beforeCanonical='';
      if(action==='session')await target.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='category-a' AND id='staff'").run();
      if(action==='role')await target.prepare("UPDATE users SET role='customer' WHERE tenant_id='category-a' AND id='staff'").run();
      if(action==='mfa')await target.prepare("UPDATE users SET mfa_enabled=0 WHERE tenant_id='category-a' AND id='staff'").run();
      if(action==='authority')await target.prepare("UPDATE budget_deployment_authority SET state='revoked'").run();
      if(action==='population-growth')await target.prepare("INSERT INTO knowledge_categories(tenant_id,id,name) VALUES('category-a','race','Concurrent')").run();
      const result=await target.batch(batch.map(statement=>statements.get(statement)?.raw??statement));
      for(let index=0;index<result.length;index++){add(result[index].meta);before(statements.get(batch[index])?.sql??'',result[index]);}
      if(canonical&&loseNextCanonicalAck){loseNextCanonicalAck=false;throw new Error('Synthetic lost D1 acknowledgement');}return result;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
}

export default{async fetch(request:Request,env:any,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname==='/__category-control'){
    if(request.method==='POST'){const body=await request.json() as {beforeCanonical?:Action;loseNextCanonicalAck?:boolean;discard?:boolean};
      if(body.beforeCanonical)beforeCanonical=body.beforeCanonical;if(body.loseNextCanonicalAck)loseNextCanonicalAck=true;
      if(body.discard)apiTicketBudgetCache.discardForTrustedRuntime();}
    return Response.json({attempts});
  }
  const metric:Metric={path:url.pathname,method:request.method,d1RowsRead:0,d1RowsWritten:0,categoryRowsLoaded:0};
  try{return await app.fetch(request,{...env,DB:instrumentDatabase(env.DB,metric)},ctx);}finally{attempts.push(metric);}
}};
