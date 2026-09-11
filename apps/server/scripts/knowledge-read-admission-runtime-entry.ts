export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';

let beforeRead:'session'|'policy'|'growth'|'source'|undefined;
let afterRead:'session'|'policy'|'closure'|undefined;
let wrappedDatabase:any,wrappedNamespace:any;
let r2Gets=0,r2Bytes=0,knowledgeRowsRead=0,knowledgeRowsWritten=0,knowledgeBusinessRows=0;
const calls={refresh:0,reserve:0};
let lastGrant:{tenantId:string;reservationId:string;holderId:string;aggregateId:string}|undefined;

async function mutate(db:any,action:string|undefined){
  if(action==='session')await db.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='knowledge-a' AND id='knowledge-admin'").run();
  if(action==='policy')await db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' ' WHERE deployment_id='knowledge-deployment'").run();
  if(action==='growth')await db.prepare(`INSERT INTO knowledge_docs (tenant_id,id,title,file_path,status,tier)
    VALUES ('knowledge-a','late-growth','late growth','knowledge/late-growth/body.md','pending','answer')`).run();
  if(action==='source')await db.prepare("UPDATE knowledge_docs SET file_path='knowledge/shared/changed' WHERE tenant_id='knowledge-a' AND id='shared'").run();
  if(action==='closure'&&lastGrant)await db.prepare(`INSERT INTO budget_grant_closures
    (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
    VALUES (?,?,?,?,?,?,1,'{}','{}')`).bind(lastGrant.tenantId,lastGrant.reservationId,lastGrant.holderId,lastGrant.aggregateId,
      `synthetic-${lastGrant.reservationId}`,'synthetic-operation-set').run();
}

function instrumentDatabase(db:any){
  if(wrappedDatabase)return wrappedDatabase;
  const statements=new WeakMap<object,{raw:any;sql:string}>();
  const wrap=(raw:any,sql:string):any=>{const proxy=new Proxy(raw,{get(target,property){
    if(property==='bind')return(...values:any[])=>wrap(target.bind(...values),sql);
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});statements.set(proxy,{raw,sql});return proxy;};
  wrappedDatabase=new Proxy(db,{get(target,property){
    if(property==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);
    if(property==='batch')return async(batch:any[])=>{
      const knowledge=batch.some(statement=>statements.get(statement)?.sql.includes('knowledge-read-fence'));
      if(knowledge&&beforeRead){const action=beforeRead;beforeRead=undefined;await mutate(target,action);}
      const results=await target.batch(batch.map(statement=>statements.get(statement)?.raw??statement));
      if(knowledge){
        knowledgeRowsRead+=results.reduce((sum:number,result:any)=>sum+(result.meta?.rows_read??0),0);
        knowledgeRowsWritten+=results.reduce((sum:number,result:any)=>sum+(result.meta?.rows_written??0),0);
        knowledgeBusinessRows+=results[2]?.meta?.rows_read??0;
        if(afterRead){const action=afterRead;afterRead=undefined;await mutate(target,action);}
      }
      return results;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});return wrappedDatabase;
}

function instrumentBucket(bucket:any){return new Proxy(bucket,{get(target,property){
  if(property==='get')return async(...args:any[])=>{r2Gets++;const object=await target.get(...args);r2Bytes+=object?.size??0;return object;};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
}});}

function instrumentNamespace(namespace:any){
  if(wrappedNamespace)return wrappedNamespace;
  wrappedNamespace={idFromName:(name:string)=>namespace.idFromName(name),get:(id:any)=>{const target=namespace.get(id);return{
    refreshFromTrustedAuthority:async(input:any)=>{calls.refresh++;return target.refreshFromTrustedAuthority(input);},
    reserveFromTrustedAuthority:async(input:any)=>{calls.reserve++;const result=await target.reserveFromTrustedAuthority(input);
      if((result.status==='granted'||result.status==='idempotent')&&result.reservation)lastGrant={tenantId:input.tenantId,
        reservationId:result.reservation.reservationId,holderId:input.holderId,aggregateId:'synthetic-aggregate'};
      return result;},
  };}};return wrappedNamespace;
}

export default {async fetch(request:Request,env:any,ctx:ExecutionContext){
  if(new URL(request.url).pathname==='/__knowledge-read-control'){
    if(request.method==='POST'){
      const value=await request.json() as {beforeRead?:typeof beforeRead;afterRead?:typeof afterRead};
      beforeRead=value.beforeRead;afterRead=value.afterRead;
    }
    return Response.json({r2Gets,r2Bytes,knowledgeRowsRead,knowledgeRowsWritten,knowledgeBusinessRows,calls});
  }
  return app.fetch(request,{...env,DB:instrumentDatabase(env.DB),ATTACHMENTS_BUCKET:instrumentBucket(env.ATTACHMENTS_BUCKET),
    BUDGET_COORDINATOR_DO:instrumentNamespace(env.BUDGET_COORDINATOR_DO)},ctx);
}};
