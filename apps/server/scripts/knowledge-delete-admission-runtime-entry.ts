export {BudgetCoordinatorDO} from '../src/durable_objects/BudgetCoordinatorDO';
export {BudgetGrantHolderDO} from '../src/durable_objects/BudgetGrantHolderDO';
export {NotificationDO} from '../src/durable_objects/NotificationDO';
import {app} from '../src/application';
import {createSystemTenantScope} from '../src/auth/scope';
import {createTenantRequestDeps} from '../src/middleware/tenant.middleware';
import {TenantKnowledgeService} from '../src/services/tenant-knowledge.service';
import {StatelessAiService} from '../src/services/ai.service';

let beforeRevoke:'session'|'policy'|undefined,beforeEffect:'closure'|undefined,failR2Once=false,failVectorOnce=false,wrapped:any;
let r2Deletes=0,vectorDeleteCalls=0,vectorIds=0,d1Reads=0,d1Writes=0,meterActive=false;
type Gate={armed:boolean;started:boolean;wait:Promise<void>;release?:()=>void};
function gate():Gate{return {armed:false,started:false,wait:Promise.resolve()};}
const putGate=gate(),upsertGate=gate(),storedVectors=new Set<string>();
function arm(value:Gate){value.armed=true;value.started=false;value.wait=new Promise(resolve=>{value.release=resolve;});}
function release(value:Gate){value.release?.();value.release=undefined;value.armed=false;}
const vector={upsert:async(items:{id:string}[])=>{if(upsertGate.armed){upsertGate.started=true;await upsertGate.wait;}for(const item of items)storedVectors.add(item.id);},
  query:async()=>({matches:[]}),deleteByIds:async(ids:string[])=>{
  vectorDeleteCalls++;vectorIds+=ids.length;if(failVectorOnce){failVectorOnce=false;throw new Error('synthetic lost vector response');}
  for(const id of ids)storedVectors.delete(id);
}};
async function mutate(db:any,action:typeof beforeRevoke){
  if(action==='session')await db.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='delete-a' AND id='delete-admin'").run();
  if(action==='policy')await db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' ' WHERE deployment_id='delete-deployment'").run();
}
async function closeLatestGrant(db:any){await db.prepare(`INSERT INTO budget_grant_closures
  (tenant_id,reservation_id,holder_id,aggregate_id,terminal_evidence_id,operation_set_fingerprint,operation_count,measured_json,uncertain_json)
  SELECT tenant_id,reservation_id,holder_id,aggregate_id,?, 'synthetic-closed-operation',1,'{}','{}'
  FROM budget_grant_operations WHERE tenant_id='delete-a' ORDER BY rowid DESC LIMIT 1`).bind(`synthetic-close-${crypto.randomUUID()}`).run();}
function instrumentDb(db:any){if(wrapped)return wrapped;const statements=new WeakMap<object,{raw:any;sql:string}>();
  const wrap=(raw:any,sql:string):any=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...values:any[])=>wrap(target.bind(...values),sql);
    if(key==='first')return async(...args:any[])=>{if(beforeEffect&&sql.includes('AND authority_revision=? AND recovery_reservation=?')){
      beforeEffect=undefined;await closeLatestGrant(db);}return target.first(...args);};
    if(key==='run')return async(...args:any[])=>{const result=await target.run(...args);if(meterActive){d1Reads+=result.meta?.rows_read??0;d1Writes+=result.meta?.rows_written??0;}return result;};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});statements.set(proxy,{raw,sql});return proxy;};
  wrapped=new Proxy(db,{get(target,key){if(key==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);if(key==='batch')return async(items:any[])=>{
    const deletion=items.some(item=>statements.get(item)?.sql.includes('knowledge_delete_jobs'));
    if(deletion&&beforeRevoke){const action=beforeRevoke;beforeRevoke=undefined;await mutate(target,action);}
    const results=await target.batch(items.map(item=>statements.get(item)?.raw??item));if(meterActive){
      d1Reads+=results.reduce((sum:number,result:any)=>sum+(result.meta?.rows_read??0),0);
      d1Writes+=results.reduce((sum:number,result:any)=>sum+(result.meta?.rows_written??0),0);}
    return results;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});return wrapped;}
function instrumentBucket(bucket:any){return new Proxy(bucket,{get(target,key){if(key==='delete')return async(...args:any[])=>{
  r2Deletes++;if(failR2Once){failR2Once=false;throw new Error('synthetic lost R2 response');}return target.delete(...args);};
  if(key==='put')return async(...args:any[])=>{if(putGate.armed){putGate.started=true;await putGate.wait;}return target.put(...args);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}

export default {async fetch(request:Request,env:any,ctx:ExecutionContext){const url=new URL(request.url),db=instrumentDb(env.DB),bucket=instrumentBucket(env.ATTACHMENTS_BUCKET);
  if(url.pathname==='/__knowledge-delete-control'){
    if(request.method==='POST'){const body=await request.json() as {beforeRevoke?:typeof beforeRevoke;beforeEffect?:typeof beforeEffect;
      failR2Once?:boolean;failVectorOnce?:boolean;reset?:boolean;armPut?:boolean;releasePut?:boolean;armUpsert?:boolean;releaseUpsert?:boolean};
      if(body.reset)r2Deletes=vectorDeleteCalls=vectorIds=d1Reads=d1Writes=0;
      if(body.armPut)arm(putGate);if(body.releasePut)release(putGate);if(body.armUpsert)arm(upsertGate);if(body.releaseUpsert)release(upsertGate);
      beforeRevoke=body.beforeRevoke;beforeEffect=body.beforeEffect;failR2Once=body.failR2Once??false;failVectorOnce=body.failVectorOnce??false;}
    return Response.json({r2Deletes,vectorDeleteCalls,vectorIds,d1Reads,d1Writes,putStarted:putGate.started,
      upsertStarted:upsertGate.started,storedVectors:storedVectors.size});
  }
  if(url.pathname==='/__knowledge-delete-stage-source'){
    const body=await request.json() as {documentId:string};const scope=createSystemTenantScope({tenantId:'delete-a',actor:'vectorize-workflow'});
    const deps=createTenantRequestDeps(scope,{...env,DB:db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:vector});
    try{await new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array(1024).fill(0)} as any)
      .updateArticle(body.documentId,'Late source','late source bytes',null,'answer',{status:'disabled'});return Response.json({outcome:'complete'});}
    catch{return Response.json({outcome:'superseded'},{status:409});}
  }
  if(url.pathname==='/__knowledge-delete-index-chunk'){
    const body=await request.json() as {documentId:string;version:number;chunkIndex:number};const scope=createSystemTenantScope({tenantId:'delete-a',actor:'vectorize-workflow'});
    const deps=createTenantRequestDeps(scope,{...env,DB:db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:vector});
    const outcome=await new TenantKnowledgeService(deps,{generateEmbeddings:async()=>Array(1024).fill(0)} as any)
      .indexManifestChunk(body.documentId,body.version,body.chunkIndex);return Response.json({outcome});
  }
  if(url.pathname==='/__knowledge-delete-step'){
    const body=await request.json() as {tenantId:string;documentId:string;deleteToken:string;purpose:'new-work'|'recovery'};
    const scope=createSystemTenantScope({tenantId:body.tenantId,actor:'knowledge-delete'}),deps=createTenantRequestDeps(scope,{...env,DB:db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:vector});
    meterActive=true;try{const outcome=await new TenantKnowledgeService(deps,new StatelessAiService(env.AI,deps.emitResourceOperation)).runKnowledgeDeleteStep({env:{...env,DB:db,
      ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:vector},documentId:body.documentId,deleteToken:body.deleteToken,purpose:body.purpose});
      return Response.json({outcome});}finally{meterActive=false;}
  }
  meterActive=true;try{return await app.fetch(request,{...env,DB:db,ATTACHMENTS_BUCKET:bucket,VECTOR_INDEX:vector},ctx);}finally{meterActive=false;}
}};
