import { Hono } from 'hono';
import { z } from 'zod';
import { Env } from '../bindings';
import { roleGuard } from '../middleware/role.guard';
import { permissionGuard,permissionWriteFence,revalidatePermission } from '../middleware/permission.guard';
import { requestBounds } from '../middleware/request-bounds';
import { AppVariables,type JWTPayload } from '../types';
import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { MutationInputError,mutationInputErrorBody,readIdempotencyKey,readMutationJson } from './mutation-request';
import { apiTicketBudgetCache,sessionTicketBudgetAdmission,staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { SavedFilterAdmissionError,SavedFilterAdmissionService,SAVED_FILTER_REQUEST_BYTES,savedFilterResponse } from '../services/saved-filter-admission.service';
import type { SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { SavedFilterRow,SavedFilterSnapshot } from '../repositories/saved-filter-admission.repository';

const filters=new Hono<{Bindings:Env;Variables:AppVariables}>();
const filterConditionSchema=z.object({field:z.string(),operator:z.string(),value:z.any()});
const filterSchema=z.object({name:z.string().min(1,'Name is required').max(100,'Name is too long'),conditions:z.array(filterConditionSchema)});
type FilterInput=z.infer<typeof filterSchema>;

function admission(c:any):SavedFilterAdmissionService|Response|null {
  if(c.env.BUDGET_ADMISSION_POLICY===undefined)return null;
  const mode=staffTicketAdmissionMode(c.env);if(mode==='disabled')return null;
  const d=c.get('tenantDeps') as TenantRequestDeps|undefined,payload=c.get('jwtPayload') as JWTPayload|undefined;
  if(mode!=='enabled'||!c.env.BUDGET_COORDINATOR_DO||!d||!payload||payload.sub!==d.scope.actorId||payload.tenant_id!==d.scope.tenantId
    ||(payload.role!=='admin'&&payload.role!=='agent')||payload.mfa_verified!==true||!Number.isSafeInteger(payload.session_version)||!Number.isSafeInteger(payload.exp))
    return c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
  const credential:SessionBudgetCredential={tenantId:d.scope.tenantId,actorId:payload.sub,role:payload.role,
    sessionVersion:payload.session_version!,expiresAt:payload.exp,mfaVerified:true};
  return new SavedFilterAdmissionService(d.database,d.scope,credential,{service:sessionTicketBudgetAdmission,
    repository:d.repositories.budgetAuthority,namespace:c.env.BUDGET_COORDINATOR_DO,now:()=>c.env.localNow?.()??Date.now(),
    settle:(authority,outcome,now)=>apiTicketBudgetCache.settleOperation(authority,outcome,now)});
}
function failure(c:any,error:unknown):Response|null {
  if(error instanceof MutationInputError)return c.json(mutationInputErrorBody(error),error.status);
  if(error instanceof SavedFilterAdmissionError)return c.json({code:error.code,error:error.message},error.status);
  return null;
}
async function body(c:any):Promise<FilterInput|Response> {
  try {
    const raw=await readMutationJson(c),serialized=JSON.stringify(raw);
    if(new TextEncoder().encode(serialized).byteLength>SAVED_FILTER_REQUEST_BYTES)return c.json({error:'Invalid saved filter'},400);
    const parsed=filterSchema.safeParse(raw);return parsed.success?parsed.data:c.json({error:parsed.error.errors[0].message},400);
  } catch(error) {const response=failure(c,error);if(response)return response;throw error;}
}

filters.get('/',roleGuard(['agent','admin']),async c=>{
  const service=admission(c);if(service instanceof Response)return service;
  try {return c.json(service?await service.read('dashboard.filter.list'):await c.get('tenantDeps')!.repositories.ticketFilters.list());}
  catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

filters.post('/',roleGuard(['admin']),permissionGuard('filters'),requestBounds(SAVED_FILTER_REQUEST_BYTES),async c=>{
  const parsed=await body(c);if(parsed instanceof Response)return parsed;
  const revalidation=await revalidatePermission(c,'filters');if(revalidation)return revalidation;
  const d=c.get('tenantDeps')!,capability=permissionWriteFence(c,'filters'),service=admission(c);if(service instanceof Response)return service;
  if(!service)return c.json(await d.repositories.ticketFilters.create(parsed,capability),201);
  try {
    const prepared=await service.prepareMutation('dashboard.filter.create',parsed,capability,readIdempotencyKey(c));
    const outcome=await service.commit(prepared,async(repo,commit,snapshot)=>{
      const now=new Date(c.env.localNow?.()??Date.now()).toISOString();
      const row:SavedFilterRow={tenant_id:d.scope.tenantId,id:`filter_${crypto.randomUUID()}`,name:parsed.name,
        conditions:JSON.stringify(parsed.conditions),is_system:0,created_at:now,updated_at:now};
      return repo.create(commit,snapshot,row,JSON.stringify(savedFilterResponse(row)));
    });
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body,outcome.status);
  } catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

filters.get('/:id',roleGuard(['agent','admin']),async c=>{
  const id=c.req.param('id')!,service=admission(c);if(service instanceof Response)return service;
  try {const filter=service?await service.read('dashboard.filter.get',id):await c.get('tenantDeps')!.repositories.ticketFilters.get(id);
    return filter?c.json(filter):c.json({error:'Filter not found'},404);
  } catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

filters.put('/:id',roleGuard(['admin','agent']),permissionGuard('filters'),requestBounds(SAVED_FILTER_REQUEST_BYTES),async c=>{
  const id=c.req.param('id')!,parsed=await body(c);if(parsed instanceof Response)return parsed;
  const revalidation=await revalidatePermission(c,'filters');if(revalidation)return revalidation;
  const d=c.get('tenantDeps')!,capability=permissionWriteFence(c,'filters'),service=admission(c);if(service instanceof Response)return service;
  if(!service){try{const updated=await d.repositories.ticketFilters.update(id,parsed,capability);return updated?c.json(updated):c.json({error:'Filter not found'},404);}
    catch(error:any){if(error.message==='Cannot modify system filters')return c.json({error:error.message},403);throw error;}}
  try {
    const prepared=await service.prepareMutation('dashboard.filter.update',parsed,capability,readIdempotencyKey(c),id);
    const outcome=await service.commit(prepared,async(repo,commit,snapshot:SavedFilterSnapshot)=>{
      if(!snapshot.target?.exists||!snapshot.target.row)throw new SavedFilterAdmissionError(404,'filter_not_found','Filter not found');
      if(snapshot.target.row.is_system===1||snapshot.target.row.is_system===true)throw new SavedFilterAdmissionError(403,'system_filter_immutable','Cannot modify system filters');
      const row:SavedFilterRow={...snapshot.target.row,name:parsed.name,conditions:JSON.stringify(parsed.conditions),updated_at:new Date(c.env.localNow?.()??Date.now()).toISOString()};
      return repo.update(commit,id,snapshot,row,JSON.stringify(savedFilterResponse(row)));
    });
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body);
  } catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

filters.delete('/:id',roleGuard(['admin']),permissionGuard('filters'),async c=>{
  const id=c.req.param('id')!,revalidation=await revalidatePermission(c,'filters');if(revalidation)return revalidation;
  const d=c.get('tenantDeps')!,capability=permissionWriteFence(c,'filters'),service=admission(c);if(service instanceof Response)return service;
  if(!service){const existing=await d.repositories.ticketFilters.get(id);if(!existing)return c.json({error:'Filter not found'},404);
    try{await d.repositories.ticketFilters.delete(id,capability);return c.json({success:true});}
    catch(error:any){if(error.message==='Cannot delete system filters')return c.json({error:error.message},403);throw error;}}
  try {
    const prepared=await service.prepareMutation('dashboard.filter.delete',{id},capability,readIdempotencyKey(c),id);
    const outcome=await service.commit(prepared,async(repo,commit,snapshot)=>{
      if(!snapshot.target?.exists||!snapshot.target.row)throw new SavedFilterAdmissionError(404,'filter_not_found','Filter not found');
      if(snapshot.target.row.is_system===1||snapshot.target.row.is_system===true)throw new SavedFilterAdmissionError(403,'system_filter_immutable','Cannot delete system filters');
      return repo.delete(commit,id,snapshot,JSON.stringify({success:true}));
    });
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body);
  } catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

export default filters;
