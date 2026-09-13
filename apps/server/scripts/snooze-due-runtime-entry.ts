export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
import { createSystemTenantScope } from '../src/auth/scope';
import { createTenantRequestDeps } from '../src/middleware/tenant.middleware';
import { admitSnoozeDue } from '../src/budgets/snooze-due-admission.service';
import { SnoozeDueCheckpointRepository } from '../src/repositories/snooze-due-checkpoint.repository';

const proxies = new WeakMap<object, any>();
let reads=0,writes=0,batches=0;
function metered(db:any) {
  const prior=proxies.get(db);if(prior)return prior;
  const originals=new WeakMap<object,any>();
  const count=(results:any[])=>{for(const r of results){reads+=r.meta?.rows_read??0;writes+=r.meta?.rows_written??0;}};
  const wrap=(statement:any):any=>{
    const proxy=new Proxy(statement,{get(target,key){
      if(key==='bind')return(...values:any[])=>wrap(target.bind(...values));
      if(key==='first')return async(column?:string)=>{const r=await target.all();count([r]);const row=r.results[0]??null;return column&&row?row[column]:row;};
      if(key==='all'||key==='run')return async(...args:any[])=>{const r=await target[key](...args);count([r]);return r;};
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});originals.set(proxy,statement);return proxy;
  };
  const proxy=new Proxy(db,{get(target,key){
    if(key==='prepare')return(sql:string)=>wrap(target.prepare(sql));
    if(key==='batch')return async(statements:any[])=>{batches++;const results=await target.batch(statements.map(s=>originals.get(s)??s));count(results);return results;};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});proxies.set(db,proxy);return proxy;
}
export default {async fetch(request:Request,env:any) {
  const input=await request.json() as any;
  if(input.action==='inspect'){
    const ns=env.BUDGET_COORDINATOR_DO;
    return Response.json(await ns.get(ns.idFromName('due-coordinator')).inspectForTrustedRuntime());
  }
  if(!['due-a','due-b'].includes(input.tenant))return new Response(null,{status:403});
  reads=0;writes=0;batches=0;
  const deps=createTenantRequestDeps(createSystemTenantScope({tenantId:input.tenant,actor:'scheduled-snooze-resurface'}),{...env,DB:metered(env.DB)});
  const admitted=await admitSnoozeDue({env,deps,intent:input.intent,now:Date.now});
  if(admitted.status!=='admitted')return Response.json({admitted,reads,writes,batches},{status:429});
  // Faults apply only to synthetic test state, between admission and exact batch.
  if(input.fault==='policy')await env.DB.prepare("UPDATE budget_tenant_allocations SET state='revoked' WHERE tenant_id=?").bind(input.tenant).run();
  const repository=new SnoozeDueCheckpointRepository(deps.database,deps.scope);
  try{
    const result=admitted.intent.family==='read'?await repository.read(admitted.intent.input,admitted.authority)
      :await repository.advance(admitted.intent.input,admitted.authority);
    admitted.finish(input.fault==='lost'?'unknown':'committed');
    return Response.json({result,reads,writes,batches,grant:admitted.authority.grant,
      purpose:admitted.authority.purpose}, {status:input.fault==='lost'?503:200});
  }catch(error){admitted.finish('unknown');return Response.json({error:String(error),reads,writes,batches},{status:409});}
}};
