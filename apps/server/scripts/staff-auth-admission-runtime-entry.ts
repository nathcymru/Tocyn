export { BudgetCoordinatorDO } from '../src/durable_objects/BudgetCoordinatorDO';
export { BudgetGrantHolderDO } from '../src/durable_objects/BudgetGrantHolderDO';
export { NotificationDO } from '../src/durable_objects/NotificationDO';
import { app } from '../src/application';

type Action='session'|'role'|'policy'|'mfa';
let beforeFence:Action|undefined;
let loseEnrollmentAcknowledgement=false;
let loseConfirmationResponse=false;
let wrappedDatabase:any;
let fullUserReads=0,fullUserRows=0,staffRowsRead=0,staffRowsWritten=0;

async function mutate(db:any,action:Action){
  if(action==='session')await db.prepare("UPDATE users SET session_version=session_version+1 WHERE tenant_id='staff-a' AND id='staff-admin'").run();
  if(action==='role')await db.prepare("UPDATE users SET role='customer' WHERE tenant_id='staff-a' AND id='staff-admin'").run();
  if(action==='policy')await db.prepare("UPDATE budget_owner_policies SET policy_json=policy_json||' ' WHERE deployment_id='staff-deployment'").run();
  if(action==='mfa')await db.prepare("UPDATE users SET mfa_enabled=1 WHERE tenant_id='staff-a' AND id='staff-enroll'").run();
}

function instrumentDatabase(db:any){
  if(wrappedDatabase)return wrappedDatabase;
  const statements=new WeakMap<object,{raw:any;sql:string}>();
  const wrap=(raw:any,sql:string):any=>{const proxy=new Proxy(raw,{get(target,property){
    if(property==='bind')return(...values:any[])=>wrap(target.bind(...values),sql);
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});statements.set(proxy,{raw,sql});return proxy;};
  wrappedDatabase=new Proxy(db,{get(target,property){
    if(property==='prepare')return(sql:string)=>{if(/SELECT\s+\*\s+FROM\s+users/i.test(sql))fullUserReads++;return wrap(target.prepare(sql),sql);};
    if(property==='batch')return async(batch:any[])=>{
      const entries=batch.map(statement=>statements.get(statement));
      const staff=entries.some(entry=>entry?.sql.includes('budget_grant_operations'))
        &&entries.some(entry=>entry?.sql.includes('budget_mutation_assertion'));
      if(staff&&beforeFence){const action=beforeFence;beforeFence=undefined;await mutate(target,action);}
      const enrollment=entries.some(entry=>entry?.sql.includes('SET mfa_secret=COALESCE'));
      const results=await target.batch(batch.map(statement=>statements.get(statement)?.raw??statement));
      if(staff){staffRowsRead+=results.reduce((sum:number,result:any)=>sum+(result.meta?.rows_read??0),0);
        staffRowsWritten+=results.reduce((sum:number,result:any)=>sum+(result.meta?.rows_written??0),0);
        entries.forEach((entry,index)=>{if(entry&&/SELECT\s+\*\s+FROM\s+users/i.test(entry.sql))fullUserRows+=results[index]?.results?.length??0;});}
      if(enrollment&&loseEnrollmentAcknowledgement){loseEnrollmentAcknowledgement=false;throw new Error('synthetic lost enrollment acknowledgement');}
      return results;
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  return wrappedDatabase;
}

export default {async fetch(request:Request,env:any,ctx:ExecutionContext){
  if(new URL(request.url).pathname==='/__staff-auth-control'){
    if(request.method==='POST'){
      const value=await request.json() as {beforeFence?:Action;loseEnrollmentAcknowledgement?:boolean;loseConfirmationResponse?:boolean;reset?:boolean};
      beforeFence=value.beforeFence;
      loseEnrollmentAcknowledgement=value.loseEnrollmentAcknowledgement===true;
      loseConfirmationResponse=value.loseConfirmationResponse===true;
      if(value.reset){fullUserReads=0;fullUserRows=0;staffRowsRead=0;staffRowsWritten=0;}
    }
    return Response.json({fullUserReads,fullUserRows,staffRowsRead,staffRowsWritten});
  }
  const response=await app.fetch(request,{...env,DB:instrumentDatabase(env.DB)},ctx);
  if(loseConfirmationResponse&&new URL(request.url).pathname==='/api/auth/mfa/confirm'&&response.status===200){
    loseConfirmationResponse=false;
    return Response.json({error:'synthetic lost confirmation response'},{status:503});
  }
  return response;
}};
