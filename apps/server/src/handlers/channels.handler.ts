import { Hono } from "hono";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { roleGuard } from "../middleware/role.guard";
import { permissionGuard, permissionWriteFence, revalidatePermission } from "../middleware/permission.guard";
import { AppVariables, type JWTPayload } from "../types";
import { z } from "zod";
import { requestBounds } from '../middleware/request-bounds';
import { MutationInputError, mutationInputErrorBody, readIdempotencyKey, readMutationJson } from './mutation-request';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { ChannelConfigurationAdmissionError, ChannelConfigurationAdmissionService, CHANNEL_CONFIGURATION_REQUEST_BYTES } from '../services/channel-configuration-admission.service';
import type { SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { SupportEmailRow } from '../repositories/channel-configuration-admission.repository';
import { normalizeSupportEmail } from '../utils/email-normalize';

const channels = new Hono<{ Bindings: Env; Variables: AppVariables }>();

channels.use("*", authMiddleware, tenantMiddleware, mfaGuard, roleGuard(["admin", "agent"]), permissionGuard("channels_email"));

const createEmailSchema = z.object({
  email_address: z.string().email("Invalid email address"),
  name: z.string().optional(),
  group_id: z.string().uuid().nullable().optional(),

  is_default: z.boolean().default(false),
});

function admission(c:any):ChannelConfigurationAdmissionService|Response|null{
  if(c.env.BUDGET_ADMISSION_POLICY===undefined)return null;
  const mode=staffTicketAdmissionMode(c.env);if(mode==='disabled')return null;
  const d=c.get('tenantDeps') as TenantRequestDeps|undefined,payload=c.get('jwtPayload') as JWTPayload|undefined;
  if(mode!=='enabled'||!c.env.BUDGET_COORDINATOR_DO||!d||!payload||payload.sub!==d.scope.actorId||payload.tenant_id!==d.scope.tenantId
    ||(payload.role!=='admin'&&payload.role!=='agent')||payload.mfa_verified!==true||!Number.isSafeInteger(payload.session_version)||!Number.isSafeInteger(payload.exp))
    return c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
  const credential:SessionBudgetCredential={tenantId:d.scope.tenantId,actorId:payload.sub,role:payload.role,
    sessionVersion:payload.session_version!,expiresAt:payload.exp,mfaVerified:true};
  return new ChannelConfigurationAdmissionService(d.database,d.scope,credential,{service:sessionTicketBudgetAdmission,
    repository:d.repositories.budgetAuthority,namespace:c.env.BUDGET_COORDINATOR_DO,now:()=>c.env.localNow?.()??Date.now(),
    settle:(authority,outcome,now)=>apiTicketBudgetCache.settleOperation(authority,outcome,now)});
}
function failure(c:any,error:unknown):Response|null{
  if(error instanceof MutationInputError)return c.json(mutationInputErrorBody(error),error.status);
  if(error instanceof ChannelConfigurationAdmissionError)return c.json({code:error.code,error:error.message},error.status);
  return null;
}
async function body(c:any):Promise<unknown|Response>{try{return await readMutationJson(c);}
  catch(error){const response=failure(c,error);if(response)return response;throw error;}}

channels.get("/emails", async (c) => {
  const deps=c.get('tenantDeps') as TenantRequestDeps,service=admission(c);if(service instanceof Response)return service;
  if(!service)return c.json(await deps.repositories.channels.listSupportEmails());
  const revalidation=await revalidatePermission(c,'channels_email');if(revalidation)return revalidation;
  try{return c.json(await service.read(permissionWriteFence(c,'channels_email')));}
  catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

channels.post("/emails", requestBounds(CHANNEL_CONFIGURATION_REQUEST_BYTES), async (c) => {
  const deps = c.get("tenantDeps") as TenantRequestDeps;
  const input=await body(c);if(input instanceof Response)return input;
  const result = createEmailSchema.safeParse(input);
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { email_address, name, group_id, is_default } = result.data;
  const revalidationFailure = await revalidatePermission(c, "channels_email");
  if (revalidationFailure) return revalidationFailure;
  const capability=permissionWriteFence(c,'channels_email'),service=admission(c);if(service instanceof Response)return service;
  if(!service){
    if(group_id&&!await deps.repositories.groups.get(group_id))return c.json({error:'Group not found in this tenant'},400);
    try{const email=await deps.repositories.channels.createSupportEmail({id:crypto.randomUUID(),email_address,name,
      group_id:group_id||undefined,is_default},capability);return c.json(email,201);}
    catch(error:any){if(error.message.includes('UNIQUE constraint failed'))return c.json({error:'Email address already exists'},409);throw error;}
  }

  try {
    const prepared=await service.prepareMutation('dashboard.channel.email.create',result.data,capability,
      {key:readIdempotencyKey(c),groupId:group_id,isDefault:is_default});
    const outcome=await service.commit(prepared,(repo,commit,snapshot)=>repo.create(commit,snapshot,{
      tenant_id:deps.scope.tenantId,id:crypto.randomUUID(),email_address,normalized_email:normalizeSupportEmail(email_address),
      name:name||null,group_id:group_id||null,is_default:is_default?1:0,
    } satisfies Omit<SupportEmailRow,'created_at'|'updated_at'>));
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body,201);
  } catch (error: any) {
    const response=failure(c,error);if(response)return response;
    if(error.message.includes('UNIQUE constraint failed'))return c.json({error:'Email address already exists'},409);
    throw error;
  }
});

channels.delete("/emails/:id", async (c) => {
  const deps = c.get("tenantDeps") as TenantRequestDeps;
  const id = c.req.param("id");
  const idSchema = z.string().uuid();
  const result = idSchema.safeParse(id);

  if (!result.success) {
    return c.json({ error: "Invalid ID format" }, 400);
  }

  const revalidationFailure = await revalidatePermission(c, "channels_email");
  if (revalidationFailure) return revalidationFailure;
  const capability=permissionWriteFence(c,'channels_email'),service=admission(c);if(service instanceof Response)return service;
  if(!service){await deps.repositories.channels.deleteSupportEmail(id,capability);return c.json({success:true});}
  try{const prepared=await service.prepareMutation('dashboard.channel.email.delete',{id},capability,{key:readIdempotencyKey(c),targetId:id});
    const outcome=await service.commit(prepared,(repo,commit,snapshot)=>repo.delete(commit,id,snapshot));
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body);
  }catch(error){const response=failure(c,error);if(response)return response;throw error;}
});

export default channels;
