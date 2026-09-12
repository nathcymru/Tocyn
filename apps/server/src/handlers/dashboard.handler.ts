import { SUPPORT_SLA_RECEIPT_SNAPSHOTS } from '../repositories/support-sla-mutation.repository';
import { BetaAdmissionError } from '../types/local-beta';
import { articlePageQuery, assertConversationResponseBounds, ConversationReadError } from '../services/conversation-read-bounds';
import { conversationHistory } from './conversation-history';
import { validateAttachmentReferences } from '../services/attachment-references';
import { EmailService } from '../services/email/outbound.service';
import { isLocalAuthCaptureTransport } from '../services/email/transport';
import { TicketEmailDeliveryAdmissionService } from '../services/email/ticket-email-admission.service';
import { BroadcastService } from '../services/broadcast.service';
import { Hono } from "hono";
import type { D1Database } from '@cloudflare/workers-types';
import { z } from "zod";
import { ARTICLE_BODY_FORMATS, DEFAULT_ARTICLE_BODY_FORMAT } from '@luminatick/shared';
import { OPERATOR_WORKSPACE_SORTS } from '../types/operator-workspace';
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { roleGuard } from "../middleware/role.guard";
import { permissionGuard, permissionWriteFence, revalidatePermission } from "../middleware/permission.guard";
import { rateLimiter } from "../middleware/rate-limiter";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { JWTPayload, AppVariables } from "../types";
import { TenantTicketService } from "../services/tenant-ticket.service";
import { SupportStateService } from '../services/support-state.service';
import { SupportStateError, SupportStateRepository } from '../repositories/support-state.repository';
import { SlaClockError, SlaClockRepository } from '../repositories/sla-clock.repository';
import { SlaClockService } from '../services/sla-clock.service';
import type { SlaPolicyInput } from '../types/sla';
import { MutationInputError, mutationInputErrorBody, readIdempotencyKey, readMutationJson } from './mutation-request';
import { requestBounds } from '../middleware/request-bounds';
import workspace from "./operator-workspace.handler";
import { replyCapability } from '../services/reply-capability';
import { governedTicketUtilityActions } from '../services/governed-ticket-actions';
import { REPLY_ATTACHMENT_CONTENT_TYPES, REPLY_ATTACHMENT_RULES } from '@luminatick/shared';
import { StaffTicketMutationService } from '../services/staff-ticket-mutation.service';
import type { PreparedStaffMutation, StaffMutationOutcome } from '../types/staff-ticket-mutation';
import { OperatorActivityService } from '../services/operator-activity.service';
import { TicketMutationError } from '../services/ticket-mutation-replay.service';
import { admitConfiguredStaffTicketMutation, admitConfiguredSupportSlaMutation, apiTicketBudgetCache, sessionTicketBudgetAdmission, STAFF_TICKET_ENVELOPES, SUPPORT_SLA_ENVELOPES, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { SupportSlaMutationService } from '../services/support-sla-mutation.service';
import type { SupportSlaBudgetOperation } from '../middleware/budget-admission.middleware';
import { admitDashboardAttachment } from '../budgets/storage-admission.service';
import { admitHttpTicketRead } from '../budgets/http-ticket-read-admission.service';
import { BoundedConversationReadRepository } from '../repositories/bounded-conversation-read.repository';
import { admitHttpTicketList } from '../budgets/http-ticket-list-admission.service';
import { TicketListScanError } from '../repositories/ticket-list-scan.repository';
import { ConfigurationAdmissionError, ConfigurationAdmissionService, CONFIGURATION_REQUEST_BYTES } from '../services/configuration-admission.service';
import type { SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import type { AutomationRow, TicketFieldRow } from '../repositories/configuration-admission.repository';
import { admitGroupDirectory, settleGroupDirectory, type GroupDirectoryAdmission } from '../budgets/group-directory-admission.service';
import { GroupDirectoryFenceError, GroupDirectoryRepository, type GroupDirectoryCommit } from '../repositories/group-directory.repository';
import { admitApiKeyAdmin, apiKeyCandidate, settleApiKeyAdmin, type ApiKeyAdminAdmission } from '../budgets/api-key-admin-admission.service';
import { ApiKeyAdminFenceError, ApiKeyAdminRepository, type ApiKeyAdminCommit,
  type ApiKeyCreationReceipt } from '../repositories/api-key-admin.repository';
import { admitDashboardSummaryRead, settleDashboardSummaryRead, type DashboardSummaryReadAdmission } from '../budgets/dashboard-summary-read-admission.service';
import { DashboardSummaryReadFenceError, DashboardSummaryReadRepository, projectDashboardSlaRows, type DashboardSummaryReadCommit } from '../repositories/dashboard-summary-read.repository';
import { StaffTicketMutationRepository } from '../repositories/staff-ticket-mutation.repository';

const createGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional().nullable(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid("Invalid User ID format"),
});

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(120).refine(value => new TextEncoder().encode(value).length <= 512),
}).strict();

const createTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  customer_email: z.string().email("Invalid email address"),
  body: z.string().min(1, "Message is required"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z.enum(["open", "pending", "resolved", "closed"]).default("open"),
  group_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const staffCreateTicketSchema = createTicketSchema.extend({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(16000).refine(value => new TextEncoder().encode(value).byteLength <= 16000),
  customer_email: z.string().email().max(254),
  body_format: z.enum(ARTICLE_BODY_FORMATS).default(DEFAULT_ARTICLE_BODY_FORMAT),
}).strict();
const staffReplySchema = z.object({
  body: z.string().min(1).max(16000).refine(value => new TextEncoder().encode(value).byteLength <= 16000),
  body_format: z.enum(ARTICLE_BODY_FORMATS).default(DEFAULT_ARTICLE_BODY_FORMAT),
  is_internal: z.boolean().optional(),
  attachments: z.array(z.unknown()).max(10).optional(),
  mentioned_user_ids: z.array(z.string().uuid()).max(16).optional(),
  draft: z.object({ generation: z.string().uuid(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    baseConversationRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
}).strict();

function staffMutationService(c: any, d: TenantRequestDeps, operation: 'dashboard.ticket.create' | 'dashboard.ticket.reply' | 'dashboard.ticket.update') {
  const agent = c.get('jwtPayload') as JWTPayload;
  const sessionVersion = agent.session_version;
  if ((agent.role !== 'admin' && agent.role !== 'agent') || typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(agent.exp)) {
    throw new TicketMutationError(403, 'staff_mutation_denied', 'Ticket mutation is not authorized');
  }
  return new StaffTicketMutationService(d.database, d.scope, {
    tenantId: d.scope.tenantId, actorId: agent.sub, role: agent.role, sessionVersion,
    expiresAt: agent.exp, mfaVerified: agent.mfa_verified === true,
  }, d.ticketMutations, {
    service: sessionTicketBudgetAdmission, repository: d.repositories.budgetAuthority,
    namespace: c.env.BUDGET_COORDINATOR_DO, business: STAFF_TICKET_ENVELOPES[operation],
    now: () => c.env.localNow?.() ?? Date.now(),
  }, undefined, new OperatorActivityService(d));
}

async function deliverCommittedTicketEmail(c: any, d: TenantRequestDeps, mutation: StaffTicketMutationService,
  prepared: PreparedStaffMutation, outcome: StaffMutationOutcome): Promise<boolean> {
  const grant = mutation.ticketEmailGrant(prepared,outcome);
  if (!grant) return false;
  const transport = c.env.emailTransport;
  const admission = new TicketEmailDeliveryAdmissionService(d.database,d.scope,{
    service:sessionTicketBudgetAdmission,repository:d.repositories.budgetAuthority,namespace:c.env.BUDGET_COORDINATOR_DO,
    now:()=>c.env.localNow?.()??Date.now(),externalProvider:!transport || !isLocalAuthCaptureTransport(transport),
    settle:(authority,result,now)=>apiTicketBudgetCache.settleOperation(authority,result,now),
  });
  return admission.deliver(grant,()=>new EmailService(c.env,d,transport).sendTicketReply(outcome.ticket,outcome.article,outcome.attachments));
}

function supportSlaMutationService(c: any, d: TenantRequestDeps, operation: SupportSlaBudgetOperation) {
  const agent = c.get('jwtPayload') as JWTPayload;
  const sessionVersion = agent.session_version;
  if ((agent.role !== 'admin' && agent.role !== 'agent') || typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(agent.exp)) {
    throw new TicketMutationError(403, 'support_sla_mutation_denied', 'Support-state or SLA mutation is not authorized');
  }
  return new SupportSlaMutationService(d.database,d.scope,{tenantId:d.scope.tenantId,actorId:agent.sub,role:agent.role,
    sessionVersion,expiresAt:agent.exp,mfaVerified:agent.mfa_verified===true},{service:sessionTicketBudgetAdmission,
    repository:d.repositories.budgetAuthority,namespace:c.env.BUDGET_COORDINATOR_DO,business:SUPPORT_SLA_ENVELOPES[operation],
    now:()=>c.env.localNow?.()??Date.now()});
}

function supportSlaDeps(d: TenantRequestDeps, database: D1Database): TenantRequestDeps {
  return {...d,database,repositories:{...d.repositories,
    supportStates:new SupportStateRepository(database,d.scope,d.betaAdmission),
    slaClocks:new SlaClockRepository(database,d.scope)}};
}


function staffMutationFailure(c: any, error: unknown): Response | null {
  if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
  if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
  return null;
}

function supportSlaAdmissionConfigurationFailure(c: any): Response | null {
  return staffTicketAdmissionMode(c.env) === 'invalid'
    ? c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503)
    : null;
}

function configurationAdmission(c:any):ConfigurationAdmissionService|Response|null {
  if(c.env.BUDGET_ADMISSION_POLICY===undefined)return null;
  const mode=staffTicketAdmissionMode(c.env);if(mode==='disabled')return null;
  const d=c.get('tenantDeps') as TenantRequestDeps|undefined,payload=c.get('jwtPayload') as JWTPayload|undefined;
  if(mode!=='enabled'||!c.env.BUDGET_COORDINATOR_DO||!d||!payload||payload.sub!==d.scope.actorId||payload.tenant_id!==d.scope.tenantId
    ||(payload.role!=='admin'&&payload.role!=='agent')||payload.mfa_verified!==true||!Number.isSafeInteger(payload.session_version)||!Number.isSafeInteger(payload.exp))
    return c.json({code:'budget_admission_unavailable',error:'Budget admission authority is unavailable'},503);
  const credential:SessionBudgetCredential={tenantId:d.scope.tenantId,actorId:payload.sub,role:payload.role,
    sessionVersion:payload.session_version!,expiresAt:payload.exp,mfaVerified:true};
  return new ConfigurationAdmissionService(d.database,d.scope,credential,{service:sessionTicketBudgetAdmission,
    repository:d.repositories.budgetAuthority,namespace:c.env.BUDGET_COORDINATOR_DO,now:()=>c.env.localNow?.()??Date.now(),
    settle:(authority,outcome,now)=>apiTicketBudgetCache.settleOperation(authority,outcome,now)});
}

function configurationFailure(c:any,error:unknown):Response|null {
  if(error instanceof MutationInputError)return c.json(mutationInputErrorBody(error),error.status);
  if(error instanceof ConfigurationAdmissionError)return c.json({code:error.code,error:error.message},error.status);
  return null;
}

async function readConfigurationBody(c:any):Promise<unknown|Response>{
  try{return await readMutationJson(c);}
  catch(error){const response=configurationFailure(c,error);if(response)return response;throw error;}
}

function groupDirectoryBudgetFailure(c: any, reason: 'exhausted'|'unavailable') {
  return reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

function dashboardSummaryBudgetFailure(c: any, reason: 'exhausted'|'unavailable') {
  return reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}
async function admittedDashboardSummary<T>(c:any,d:TenantRequestDeps,admission:DashboardSummaryReadAdmission,
  work:(repository:DashboardSummaryReadRepository,commit:DashboardSummaryReadCommit)=>Promise<T>):Promise<T|Response> {
  const commit=admission.commit!;
  try {
    const result=await work(new DashboardSummaryReadRepository(d.database,d.scope),commit);
    settleDashboardSummaryRead(commit,'committed',c.env.localNow?.()??Date.now());
    return result;
  } catch(error) {
    settleDashboardSummaryRead(commit,'unknown',c.env.localNow?.()??Date.now());
    if(error instanceof DashboardSummaryReadFenceError)return dashboardSummaryBudgetFailure(c,'unavailable');
    throw error;
  }
}

async function admittedGroupDirectoryWork<T>(c:any,d:TenantRequestDeps,admission:GroupDirectoryAdmission,
  work:(repository:GroupDirectoryRepository,commit:GroupDirectoryCommit)=>Promise<T>):Promise<T|Response> {
  const commit=admission.commit!;
  try {
    const result=await work(new GroupDirectoryRepository(d.scope,d.database),commit);
    settleGroupDirectory(commit,'committed',c.env.localNow?.()??Date.now());
    return result;
  } catch(error) {
    settleGroupDirectory(commit,'unknown',c.env.localNow?.()??Date.now());
    if(error instanceof GroupDirectoryFenceError)return groupDirectoryBudgetFailure(c,'unavailable');
    throw error;
  }
}

/** These admitted routes use the same 65th-row sentinel as their live commit fence. */
function groupDirectoryPermissionGuard(key:'users'|'groups') {
  return async(c:any,next:()=>Promise<void>)=>{
    if(staffTicketAdmissionMode(c.env)!=='enabled')return permissionGuard(key)(c,next);
    const d=c.get('tenantDeps') as TenantRequestDeps|undefined;
    const payload=c.get('jwtPayload') as JWTPayload|undefined;
    const sessionVersion=payload?.session_version;
    if(!d||!payload||(payload.role!=='admin'&&payload.role!=='agent')||typeof sessionVersion!=='number'||!Number.isSafeInteger(sessionVersion)){
      return c.json({error:'Unauthorized',message:'No session found'},401);
    }
    const credential={tenantId:d.scope.tenantId,actorId:payload.sub,role:payload.role,sessionVersion,
      expiresAt:payload.exp,mfaVerified:payload.mfa_verified===true} as const;
    const fence=await new GroupDirectoryRepository(d.scope,d.database).capabilityFence(credential,key);
    if(!fence)return c.json({error:'Forbidden',message:`Capability denied: ${key}.manage`},403);
    c.set('permissionFences',{...(c.get('permissionFences')??{}),[fence.capability]:{allowed:true,reason:'allowed',
      capability:fence.capability,policyFingerprint:fence.policyFingerprint}});
    await next();
  };
}

function apiKeyAdminFailure(c: any, reason: 'exhausted' | 'unavailable' | 'conflict', receipt?: ApiKeyCreationReceipt) {
  if (reason === 'exhausted') return c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429);
  if (reason === 'conflict') return c.json({ code: 'idempotency_conflict', error: 'Idempotency-Key was already used with a different API-key name' }, 409);
  if (receipt) return c.json({ code: 'api_key_plaintext_unavailable',
    error: 'The API key was created, but its one-time plaintext cannot be shown again',
    key: { id: receipt.api_key_id, name: receipt.name, prefix: receipt.prefix, created_at: receipt.created_at } }, 409);
  return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

function apiKeyAdminPermissionGuard() {
  return async (c: any, next: () => Promise<void>) => {
    if (staffTicketAdmissionMode(c.env) !== 'enabled') return permissionGuard('api_keys')(c, next);
    const deps = c.get('tenantDeps') as TenantRequestDeps | undefined;
    const payload = c.get('jwtPayload') as JWTPayload | undefined;
    const sessionVersion = payload?.session_version;
    if (!deps || !payload || (payload.role !== 'admin' && payload.role !== 'agent')
      || typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion)) {
      return c.json({ error: 'Unauthorized', message: 'No session found' }, 401);
    }
    const credential = { tenantId: deps.scope.tenantId, actorId: payload.sub, role: payload.role, sessionVersion,
      expiresAt: payload.exp, mfaVerified: payload.mfa_verified === true } as const;
    const fence = await new ApiKeyAdminRepository(deps.scope, deps.database).capabilityFence(credential);
    if (!fence) return c.json({ error: 'Forbidden', message: 'Capability denied: api-keys.manage' }, 403);
    c.set('permissionFences', { ...(c.get('permissionFences') ?? {}), [fence.capability]: {
      allowed: true, reason: 'allowed', capability: fence.capability, policyFingerprint: fence.policyFingerprint,
    } });
    await next();
  };
}

async function admittedApiKeyWork<T>(c: any, deps: TenantRequestDeps, admission: ApiKeyAdminAdmission,
  work: (repository: ApiKeyAdminRepository, commit: ApiKeyAdminCommit) => Promise<T>): Promise<T | Response> {
  const commit = admission.commit!;
  try {
    const result = await work(new ApiKeyAdminRepository(deps.scope, deps.database), commit);
    settleApiKeyAdmin(commit, 'committed', c.env.localNow?.() ?? Date.now());
    return result;
  } catch (error) {
    settleApiKeyAdmin(commit, 'unknown', c.env.localNow?.() ?? Date.now());
    if (error instanceof ApiKeyAdminFenceError) return apiKeyAdminFailure(c, 'unavailable');
    throw error;
  }
}

const createTicketFieldSchema = z.object({
  name: z.string().min(1, "Name is required"),
  label: z.string().min(1, "Label is required"),
  field_type: z.enum(["text", "textarea", "select", "checkbox"]),
  options: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});

const updateTicketSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
});
const responsibleOwnerSchema = z.object({
  ownerId: z.string().uuid().nullable(),
  expectedOwnerId: z.string().uuid().nullable(),
  capacityOverride: z.literal(true).optional(),
}).strict();
const routingProfileSchema = z.object({
  available: z.boolean(),
  assignmentCapacity: z.number().int().min(0).max(500).nullable(),
}).strict();

const supportStateDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,119}$/i).refine(value => !value.startsWith('legacy-')),
  legacyStatus: z.enum(['open', 'pending', 'resolved', 'closed']),
  internalLabel: z.string().trim().min(1).max(120),
  publicLabel: z.string().trim().min(1).max(120),
  waitingReasonRequired: z.boolean().optional(),
  nextActionRequired: z.boolean().optional(),
}).strict();
const supportStateDefinitionUpdateSchema = supportStateDefinitionSchema.omit({ id: true, legacyStatus: true }).partial().refine(
  value => Object.keys(value).length > 0,
);
const supportStateTransitionSchema = z.object({
  definitionId: z.string().min(1).max(120),
  waitingReason: z.string().trim().min(1).max(512).nullable().optional(),
  nextAction: z.string().trim().min(1).max(512).nullable().optional(),
  expectedRevision: z.number().int().positive(),
}).strict();
const supportStateDeactivateSchema = z.object({
  replacementId: z.string().min(1).max(120),
  waitingReason: z.string().trim().min(1).max(512).nullable().optional(),
  nextAction: z.string().trim().min(1).max(512).nullable().optional(),
}).strict();
const slaPolicySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  calendar: z.unknown(),
  responseTargetMs: z.number().int().nullable(),
  resolutionTargetMs: z.number().int().nullable(),
  reopenPolicy: z.object({ response: z.enum(['continue', 'restart']).optional(), resolution: z.enum(['continue', 'restart']).optional() }).strict().optional(),
}).strict();

function supportStateFailure(c: any, error: unknown) {
  if (!(error instanceof SupportStateError)) throw error;
  const status = error.code === 'invalid' ? 400 : error.code === 'not_found' ? 404 : 409;
  return c.json({ error: error.message, code: `support_state_${error.code}` }, status);
}

function slaFailure(c: any, error: unknown) {
  if (!(error instanceof SlaClockError)) throw error;
  return c.json({ error: error.message, code: `sla_${error.code}` }, error.code === 'invalid' ? 400 : error.code === 'unavailable' ? 503 : error.code === 'conflict' ? 409 : 404);
}

async function readSupportStateMutation(c: any): Promise<{ body: unknown } | { response: Response }> {
  try { return { body: await readMutationJson(c) }; }
  catch (error) {
    if (error instanceof MutationInputError) return { response: c.json(mutationInputErrorBody(error), error.status) };
    throw error;
  }
}

function displayUser(user: {id:string;full_name?:string|null;email:string;role:string}|null) {
  return user ? {id:user.id,full_name:user.full_name??null,email:user.email,role:user.role} : null;
}

function boundedIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

async function storageDigest(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function storageByteDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function attachmentBudgetFailure(c: any, reason: 'exhausted' | 'conflict' | 'unavailable') {
  return reason === 'conflict'
    ? c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409)
    : reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

const dashboard = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Apply auth, MFA, role-based access control, and tenant scoping to all dashboard routes
dashboard.use("*", authMiddleware, mfaGuard, roleGuard(["agent", "admin"]), tenantMiddleware);
dashboard.route("/workspace", workspace);

/**
 * GET /api/ticket-fields
 * List all custom ticket fields
 */
dashboard.get("/ticket-fields", async (c) => {
  const deps = c.get('tenantDeps') as TenantRequestDeps,admission=configurationAdmission(c);
  if(admission instanceof Response)return admission;
  try{return c.json(admission?await admission.read('dashboard.ticket-field.list',{}):await deps.repositories.ticketFields.list());}
  catch(error){const response=configurationFailure(c,error);if(response)return response;throw error;}
});

/**
 * POST /api/ticket-fields
 * Create a new custom ticket field
 */
dashboard.post("/ticket-fields", roleGuard(["admin", "agent"]), permissionGuard("ticket_fields"), requestBounds(CONFIGURATION_REQUEST_BYTES), async (c) => {
  const body = await readConfigurationBody(c);if(body instanceof Response)return body;
  const result = createTicketFieldSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { name, label, field_type, options, is_active } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "ticket_fields");
  if (revalidationFailure) return revalidationFailure;

  try {
    const capability=permissionWriteFence(c,"ticket_fields"),admission=configurationAdmission(c);if(admission instanceof Response)return admission;
    if(admission){
      const prepared=await admission.prepareMutation('dashboard.ticket-field.create',result.data,capability,readIdempotencyKey(c));
      const outcome=await admission.commit(prepared,(repo,commit,snapshot)=>repo.createTicketField(commit,snapshot,{
        tenant_id:d.scope.tenantId,id:crypto.randomUUID(),name,label,field_type,options:options||null,is_active:is_active?1:0,
      } satisfies TicketFieldRow));
      if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body,201);
    }
    const field = await d.repositories.ticketFields.create({
      name, label, field_type, options: options || null, is_active
    }, capability);
    return c.json(field, 201);
  } catch (error: any) {
    const response=configurationFailure(c,error);if(response)return response;
    if (error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "Ticket field with this name already exists" }, 409);
    }
    throw error;
  }
});

/**
 * GET /api/stats
 * Dashboard overview statistics.
 */
dashboard.get("/stats", async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'dashboard.stats.read',target:{},now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
  if(admission.status==='admitted'){
    const result=await admittedDashboardSummary(c,d,admission,(repository,commit)=>repository.stats(commit));
    if(result instanceof Response)return result;
    return c.json(result);
  }
  return c.json(await d.repositories.tickets.dashboardStats());
});

// State definitions are operational settings. They remain separate from the
// legacy ticket payload and use the existing general-settings capability.
dashboard.get('/support-states', async (c) => {
  const limit = Number(c.req.query('limit') ?? '100');
  const cursor = c.req.query('cursor') || undefined;
  const includeInactive = c.req.query('include_inactive') === 'true';
  try {
    const d=c.get('tenantDeps') as TenantRequestDeps;
    const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
      operation:'dashboard.support-states.read',target:{limit,cursor:cursor??null,includeInactive},now:()=>c.env.localNow?.()??Date.now()});
    if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
    if(admission.status==='admitted'){
      const page=await admittedDashboardSummary(c,d,admission,(repository,commit)=>repository.supportStates({limit,cursor:cursor??null,includeInactive},commit));
      if(page instanceof Response)return page;
      const response=c.json(page.results);if(page.nextCursor)response.headers.set('X-Next-Cursor',page.nextCursor);return response;
    }
    const page = await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps).listDefinitionsPage(limit, cursor, includeInactive);
    const response = c.json(page.results);
    if (page.nextCursor) response.headers.set('X-Next-Cursor', page.nextCursor);
    return response;
  }
  catch (error) { return supportStateFailure(c, error); }
});

dashboard.get('/sla-policy', async (c) => {
  try {
    const d=c.get('tenantDeps') as TenantRequestDeps;
    const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
      operation:'dashboard.sla-policy.read',target:{},now:()=>c.env.localNow?.()??Date.now()});
    if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
    if(admission.status==='admitted'){
      const policy=await admittedDashboardSummary(c,d,admission,(repository,commit)=>repository.policy(commit));
      if(policy instanceof Response)return policy;
      return c.json(policy);
    }
    return c.json(await new SlaClockService(d).getPolicy());
  }
  catch (error) { return slaFailure(c, error); }
});

dashboard.put('/sla-policy', requestBounds(64 * 1024), roleGuard(['admin']), permissionGuard('general'), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = slaPolicySchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid SLA policy' }, 400);
  const revalidationFailure = await revalidatePermission(c, 'general');
  if (revalidationFailure) return revalidationFailure;
  const admissionFailure = supportSlaAdmissionConfigurationFailure(c);
  if (admissionFailure) return admissionFailure;
  if (staffTicketAdmissionMode(c.env) === 'enabled') {
    try {
      const d=c.get('tenantDeps') as TenantRequestDeps, fence=permissionWriteFence(c,'general');
      const mutation=supportSlaMutationService(c,d,'dashboard.sla.policy.set');
      const prepared=await mutation.prepareMutation({operation:'dashboard.sla.policy.set',payload:parsed.data,capability:fence},readIdempotencyKey(c));
      if (prepared.replay) { const replay=await mutation.replay(prepared); if (!replay) throw new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable'); c.header('Idempotency-Replayed','true'); return c.json(replay.body,replay.status); }
      const rejection=await admitConfiguredSupportSlaMutation(c,'dashboard.sla.policy.set',mutation,prepared); if(rejection) return rejection;
      const result=await mutation.commit(prepared,200,SUPPORT_SLA_RECEIPT_SNAPSHOTS.policy,[d.scope.tenantId],
        database=>new SlaClockService(supportSlaDeps(d,database)).setPolicy(parsed.data as SlaPolicyInput,fence),true,1);
      if(mutation.keyed(prepared)) c.header('Idempotency-Replayed','false'); return c.json(result);
    } catch(error) { const failure=staffMutationFailure(c,error); return failure ?? slaFailure(c,error); }
  }
  try { return c.json(await new SlaClockService(c.get('tenantDeps') as TenantRequestDeps).setPolicy(parsed.data as SlaPolicyInput, permissionWriteFence(c, 'general'))); }
  catch (error) { return slaFailure(c, error); }
});

dashboard.post('/support-states', requestBounds(64 * 1024), roleGuard(['admin']), permissionGuard('general'), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = supportStateDefinitionSchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid support-state definition' }, 400);
  const revalidationFailure = await revalidatePermission(c, 'general');
  if (revalidationFailure) return revalidationFailure;
  const admissionFailure = supportSlaAdmissionConfigurationFailure(c);
  if (admissionFailure) return admissionFailure;
  if (staffTicketAdmissionMode(c.env) === 'enabled') {
    try {
      const d=c.get('tenantDeps') as TenantRequestDeps, fence=permissionWriteFence(c,'general');
      const mutation=supportSlaMutationService(c,d,'dashboard.support-state.create');
      const prepared=await mutation.prepareMutation({operation:'dashboard.support-state.create',payload:parsed.data,capability:fence},readIdempotencyKey(c));
      if(prepared.replay) { const replay=await mutation.replay(prepared); if (!replay) throw new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable'); c.header('Idempotency-Replayed','true'); return c.json(replay.body,replay.status); }
      const rejection=await admitConfiguredSupportSlaMutation(c,'dashboard.support-state.create',mutation,prepared); if(rejection) return rejection;
      const state=await mutation.commit(prepared,201,SUPPORT_SLA_RECEIPT_SNAPSHOTS.definition,[d.scope.tenantId,parsed.data.id],database=>
        new SupportStateService(supportSlaDeps(d,database)).createDefinition(parsed.data,fence),true,5);
      if(mutation.keyed(prepared)) c.header('Idempotency-Replayed','false'); return c.json(state,201);
    } catch(error) { const failure=staffMutationFailure(c,error); return failure ?? supportStateFailure(c,error); }
  }
  try {
    const state = await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps)
      .createDefinition(parsed.data, permissionWriteFence(c, 'general'));
    return c.json(state, 201);
  } catch (error) { return supportStateFailure(c, error); }
});

dashboard.patch('/support-states/:id', requestBounds(64 * 1024), roleGuard(['admin']), permissionGuard('general'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing support-state ID' }, 400);
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = supportStateDefinitionUpdateSchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid support-state definition' }, 400);
  const revalidationFailure = await revalidatePermission(c, 'general');
  if (revalidationFailure) return revalidationFailure;
  const admissionFailure = supportSlaAdmissionConfigurationFailure(c);
  if (admissionFailure) return admissionFailure;
  if (staffTicketAdmissionMode(c.env) === 'enabled') {
    try {
      const d=c.get('tenantDeps') as TenantRequestDeps, fence=permissionWriteFence(c,'general');
      const mutation=supportSlaMutationService(c,d,'dashboard.support-state.update');
      const prepared=await mutation.prepareMutation({operation:'dashboard.support-state.update',payload:{id,...parsed.data},capability:fence},readIdempotencyKey(c));
      if(prepared.replay) { const replay=await mutation.replay(prepared); if (!replay) throw new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable'); c.header('Idempotency-Replayed','true'); return c.json(replay.body,replay.status); }
      const rejection=await admitConfiguredSupportSlaMutation(c,'dashboard.support-state.update',mutation,prepared); if(rejection) return rejection;
      const state=await mutation.commit(prepared,200,SUPPORT_SLA_RECEIPT_SNAPSHOTS.definition,[d.scope.tenantId,id],database=>
        new SupportStateService(supportSlaDeps(d,database)).updateDefinition(id,parsed.data,fence),true,1);
      if(mutation.keyed(prepared)) c.header('Idempotency-Replayed','false'); return c.json(state);
    } catch(error) { const failure=staffMutationFailure(c,error); return failure ?? supportStateFailure(c,error); }
  }
  try {
    return c.json(await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps)
      .updateDefinition(id, parsed.data, permissionWriteFence(c, 'general')));
  } catch (error) { return supportStateFailure(c, error); }
});

dashboard.post('/support-states/:id/deactivate', requestBounds(64 * 1024), roleGuard(['admin']), permissionGuard('general'), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing support-state ID' }, 400);
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = supportStateDeactivateSchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid support-state replacement' }, 400);
  const revalidationFailure = await revalidatePermission(c, 'general');
  if (revalidationFailure) return revalidationFailure;
  const admissionFailure = supportSlaAdmissionConfigurationFailure(c);
  if (admissionFailure) return admissionFailure;
  if (staffTicketAdmissionMode(c.env) === 'enabled') {
    try {
      const d=c.get('tenantDeps') as TenantRequestDeps, fence=permissionWriteFence(c,'general');
      const mutation=supportSlaMutationService(c,d,'dashboard.support-state.deactivate');
      const prepared=await mutation.prepareMutation({operation:'dashboard.support-state.deactivate',payload:{id,...parsed.data},capability:fence},readIdempotencyKey(c));
      if(prepared.replay) { const replay=await mutation.replay(prepared); if (!replay) throw new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable'); c.header('Idempotency-Replayed','true'); return c.json(replay.body,replay.status); }
      const rejection=await admitConfiguredSupportSlaMutation(c,'dashboard.support-state.deactivate',mutation,prepared); if(rejection) return rejection;
      await mutation.commit(prepared,200,SUPPORT_SLA_RECEIPT_SNAPSHOTS.success,[],database=>
        new SupportStateService(supportSlaDeps(d,database)).deactivate(id,parsed.data,fence),true);
      if(mutation.keyed(prepared)) c.header('Idempotency-Replayed','false'); return c.json({success:true});
    } catch(error) { const failure=staffMutationFailure(c,error); return failure ?? supportStateFailure(c,error); }
  }
  try {
    await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps)
      .deactivate(id, parsed.data, permissionWriteFence(c, 'general'));
    return c.json({ success: true });
  } catch (error) { return supportStateFailure(c, error); }
});

dashboard.get('/tickets/:id/support-state', async (c) => {
  try {
    const d=c.get('tenantDeps') as TenantRequestDeps,id=c.req.param('id');
    const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
      operation:'dashboard.ticket.support-state.read',target:{ticketId:id},now:()=>c.env.localNow?.()??Date.now()});
    if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
    const state=admission.status==='admitted'
      ?await admittedDashboardSummary(c,d,admission,(repository,commit)=>repository.ticketSupportState(id,commit))
      :await new SupportStateService(d).getTicketState(id);
    if(state instanceof Response)return state;
    if (!state) return c.json({ error: 'Ticket not found' }, 404);
    return c.json(state);
  } catch (error) { return supportStateFailure(c, error); }
});

dashboard.get('/tickets/:id/sla', async (c) => {
  try {
    const d=c.get('tenantDeps') as TenantRequestDeps,id=c.req.param('id');
    const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
      operation:'dashboard.ticket.sla.read',target:{ticketId:id},now:()=>c.env.localNow?.()??Date.now()});
    if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
    const projection=admission.status==='admitted'
      ?await admittedDashboardSummary(c,d,admission,async(repository,commit)=>{const rows=await repository.sla({ticketIds:[id]},'dashboard.ticket.sla.read',commit);const row=rows.get(id);return row?projectDashboardSlaRows(row,new Date(c.env.localNow?.()??Date.now())):null;})
      :await new SlaClockService(d).getTicketProjection(id);
    if(projection instanceof Response)return projection;
    return projection ? c.json(projection) : c.json({ error: 'SLA clock unavailable' }, 404);
  } catch (error) { return slaFailure(c, error); }
});

// Legacy tickets are initialized only when an authorized administrator
// explicitly acknowledges the start point. This avoids retroactively applying
// today's policy to historical tickets or scanning an entire tenant.
dashboard.post('/tickets/:id/sla/initialize', requestBounds(1024), roleGuard(['admin']), permissionGuard('general'), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  if (!z.object({}).strict().safeParse(mutation.body).success) return c.json({ error: 'Invalid SLA initialization' }, 400);
  const revalidationFailure = await revalidatePermission(c, 'general');
  if (revalidationFailure) return revalidationFailure;
  const admissionFailure = supportSlaAdmissionConfigurationFailure(c);
  if (admissionFailure) return admissionFailure;
  if (staffTicketAdmissionMode(c.env) === 'enabled') {
    try {
      const id=c.req.param('id'), d=c.get('tenantDeps') as TenantRequestDeps, fence=permissionWriteFence(c,'general');
      const mutation=supportSlaMutationService(c,d,'dashboard.ticket.sla.initialize');
      const prepared=await mutation.prepareMutation({operation:'dashboard.ticket.sla.initialize',ticketId:id,payload:{},capability:fence},readIdempotencyKey(c));
      if(prepared.replay) { const replay=await mutation.replay(prepared); if (!replay) throw new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable'); c.header('Idempotency-Replayed','true'); return c.json(replay.body,replay.status); }
      const rejection=await admitConfiguredSupportSlaMutation(c,'dashboard.ticket.sla.initialize',mutation,prepared); if(rejection) return rejection;
      const initialized=await mutation.commit(prepared,201,SUPPORT_SLA_RECEIPT_SNAPSHOTS.initialized,[],database=>
        new SlaClockService(supportSlaDeps(d,database)).initializeExistingTicket(id),false,3,body=>Boolean((body as { initialized?: unknown }).initialized));
      const body={initialized}; if(mutation.keyed(prepared)) c.header('Idempotency-Replayed','false'); return c.json(body,initialized?201:200);
    } catch(error) { const failure=staffMutationFailure(c,error); return failure ?? slaFailure(c,error); }
  }
  try {
    const initialized = await new SlaClockService(c.get('tenantDeps') as TenantRequestDeps).initializeExistingTicket(c.req.param('id'));
    return c.json({ initialized }, initialized ? 201 : 200);
  } catch (error) { return slaFailure(c, error); }
});

dashboard.post('/ticket-sla/projections', requestBounds(16 * 1024), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = z.object({ ticketIds: z.array(z.string().min(1).max(120)).min(1).max(25) }).strict().safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid SLA projection batch' }, 400);
  try {
    const d=c.get('tenantDeps') as TenantRequestDeps,ids=parsed.data.ticketIds;
    const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
      operation:'dashboard.ticket.sla-batch.read',target:{ticketIds:ids},now:()=>c.env.localNow?.()??Date.now()});
    if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
    if(admission.status==='admitted'){
      const projections=await admittedDashboardSummary(c,d,admission,async(repository,commit)=>{
        const rows=await repository.sla({ticketIds:ids},'dashboard.ticket.sla-batch.read',commit),result:Record<string,unknown>={};
        for(const id of ids){const row=rows.get(id);if(row)result[id]=projectDashboardSlaRows(row,new Date(c.env.localNow?.()??Date.now()));}
        return result;
      });
      if(projections instanceof Response)return projections;
      return c.json(projections);
    }
    return c.json(await new SlaClockService(d).getTicketProjections(ids));
  }
  catch (error) { return slaFailure(c, error); }
});

dashboard.patch('/tickets/:id/support-state', requestBounds(64 * 1024), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = supportStateTransitionSchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid support-state transition' }, 400);
  const admissionFailure = supportSlaAdmissionConfigurationFailure(c);
  if (admissionFailure) return admissionFailure;
  if (staffTicketAdmissionMode(c.env) === 'enabled') {
    try {
      const id=c.req.param('id'), d=c.get('tenantDeps') as TenantRequestDeps;
      const admission=supportSlaMutationService(c,d,'dashboard.ticket.support-state.transition');
      const prepared=await admission.prepareMutation({operation:'dashboard.ticket.support-state.transition',ticketId:id,payload:parsed.data},readIdempotencyKey(c));
      if(prepared.replay) { const replay=await admission.replay(prepared); if (!replay) throw new TicketMutationError(503,'support_sla_mutation_unavailable','Support-state or SLA mutation unavailable'); c.header('Idempotency-Replayed','true'); return c.json(replay.body,replay.status); }
      const rejection=await admitConfiguredSupportSlaMutation(c,'dashboard.ticket.support-state.transition',admission,prepared); if(rejection) return rejection;
      const state=await admission.commit(prepared,200,SUPPORT_SLA_RECEIPT_SNAPSHOTS.state,[d.scope.tenantId,id],database=>
        new SupportStateService(supportSlaDeps(d,database)).transition(id,parsed.data),true,d.betaAdmission ? 5 : 3);
      if(admission.keyed(prepared)) c.header('Idempotency-Replayed','false'); return c.json(state);
    } catch(error) { const failure=staffMutationFailure(c,error); return failure ?? supportStateFailure(c,error); }
  }
  try {
    return c.json(await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps).transition(c.req.param('id'), parsed.data));
  } catch (error) { return supportStateFailure(c, error); }
});

/**
 * GET /api/automations
 * List all automation rules.
 */
dashboard.get("/automations", permissionGuard("automations"), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=configurationAdmission(c);if(admission instanceof Response)return admission;
  if(!admission)return c.json(await d.repositories.automations.list());
  const revalidationFailure=await revalidatePermission(c,"automations");if(revalidationFailure)return revalidationFailure;
  try{return c.json(await admission.read('dashboard.automation.list',{capability:permissionWriteFence(c,'automations')}));}
  catch(error){const response=configurationFailure(c,error);if(response)return response;throw error;}
});

/**
 * POST /api/automations
 * Create a new automation rule.
 */
dashboard.post("/automations", permissionGuard("automations"), requestBounds(CONFIGURATION_REQUEST_BYTES), async (c) => {
  const payload = await readConfigurationBody(c) as Record<string,any>|Response;if(payload instanceof Response)return payload;
  const { name, event_type, conditions, action_type, action_config, is_active } = payload;

  if (!name || !event_type || !action_type) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "automations");
  if (revalidationFailure) return revalidationFailure;
  const capability=permissionWriteFence(c,"automations"),admission=configurationAdmission(c);if(admission instanceof Response)return admission;
  if(!admission){const rule=await d.repositories.automations.create({name,event_type,conditions:conditions||undefined,
    action_type,action_config:action_config||undefined,is_active:is_active?true:false},capability);return c.json(rule,201);}
  try{
    const prepared=await admission.prepareMutation('dashboard.automation.create',payload,capability,readIdempotencyKey(c));
    const outcome=await admission.commit(prepared,(repo,commit,snapshot)=>repo.createAutomation(commit,snapshot,{
      tenant_id:d.scope.tenantId,id:crypto.randomUUID(),name,event_type,conditions:conditions||null,action_type,
      action_config:action_config||null,is_active:is_active?1:0,
    } satisfies Omit<AutomationRow,'created_at'>));
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body,201);
  }catch(error){const response=configurationFailure(c,error);if(response)return response;throw error;}
});

/**
 * PATCH /api/automations/:id
 * Update an automation rule.
 */
dashboard.patch("/automations/:id", permissionGuard("automations"), requestBounds(CONFIGURATION_REQUEST_BYTES), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing ID" }, 400);
  const payload = await readConfigurationBody(c) as Record<string,any>|Response;if(payload instanceof Response)return payload;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "automations");
  if (revalidationFailure) return revalidationFailure;
  const capability=permissionWriteFence(c,"automations"),admission=configurationAdmission(c);if(admission instanceof Response)return admission;
  if(!admission)return c.json(await d.repositories.automations.update(id,payload,capability));
  try{
    const prepared=await admission.prepareMutation('dashboard.automation.update',payload,capability,readIdempotencyKey(c),id);
    const outcome=await admission.commit(prepared,(repo,commit,snapshot)=>repo.updateAutomation(commit,id,snapshot,payload));
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body);
  }catch(error){const response=configurationFailure(c,error);if(response)return response;throw error;}
});

/**
 * DELETE /api/automations/:id
 * Delete an automation rule.
 */
dashboard.delete("/automations/:id", permissionGuard("automations"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing ID" }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "automations");
  if (revalidationFailure) return revalidationFailure;
  const capability=permissionWriteFence(c,"automations"),admission=configurationAdmission(c);if(admission instanceof Response)return admission;
  if(!admission){await d.repositories.automations.delete(id,capability);return c.json({success:true});}
  try{
    const prepared=await admission.prepareMutation('dashboard.automation.delete',{id},capability,readIdempotencyKey(c),id);
    const outcome=await admission.commit(prepared,(repo,commit,snapshot)=>repo.deleteAutomation(commit,id,snapshot));
    if(outcome.replayed&&outcome.keyed)c.header('Idempotency-Replayed','true');return c.json(outcome.body);
  }catch(error){const response=configurationFailure(c,error);if(response)return response;throw error;}
});

/**
 * GET /api/api-keys
 * List all API keys for management (metadata only, never hashes/secrets).
 */
dashboard.get("/api-keys", apiKeyAdminPermissionGuard(), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitApiKeyAdmin({ env: c.env, deps: d, payload: c.get('jwtPayload') as JWTPayload,
    operation: 'api-key.list', target: {}, capability: permissionWriteFence(c, 'api_keys'),
    now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return apiKeyAdminFailure(c, admission.reason!);
  const keys = admission.status === 'admitted'
    ? await admittedApiKeyWork(c, d, admission, (repository, commit) => repository.list(commit))
    : await d.repositories.apiKeys.list();
  if (keys instanceof Response) return keys;
  return c.json(keys);
});

/**
 * POST /api/api-keys
 * Generate a new API key. Plaintext returned once only.
 */
dashboard.post("/api-keys", requestBounds(2 * 1024), apiKeyAdminPermissionGuard(), async (c) => {
  let body: unknown;
  let idempotencyKey: string | undefined;
  try { body = await readMutationJson(c); idempotencyKey = readIdempotencyKey(c); }
  catch (error) {
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    throw error;
  }
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const { name } = parsed.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitApiKeyAdmin({ env: c.env, deps: d, payload: c.get('jwtPayload') as JWTPayload,
    operation: 'api-key.create', target: { name }, capability: permissionWriteFence(c, 'api_keys'), idempotencyKey,
    now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') {
    if (!idempotencyKey && staffTicketAdmissionMode(c.env) === 'enabled') {
      return c.json({ error: 'Idempotency-Key is required', code: 'invalid_idempotency_key' }, 400);
    }
    return apiKeyAdminFailure(c, admission.reason!);
  }
  if (admission.status === 'admitted') {
    const candidate = await apiKeyCandidate(name);
    const outcome = await admittedApiKeyWork(c, d, admission, (repository, commit) =>
      repository.create(candidate, admission.idempotencyHash!, admission.payloadHash!, commit));
    if (outcome instanceof Response) return outcome;
    if (outcome.kind === 'conflict') return apiKeyAdminFailure(c, 'conflict');
    if (outcome.kind === 'unavailable') return apiKeyAdminFailure(c, 'unavailable', outcome.receipt);
    return c.json({ apiKey: outcome.value.apiKey, id: outcome.value.id, name: outcome.value.name,
      prefix: outcome.value.prefix, permissions: [...outcome.value.permissions] }, 201);
  }
  const revalidationFailure = await revalidatePermission(c, "api_keys");
  if (revalidationFailure) return revalidationFailure;
  const result = await d.repositories.apiKeys.create(name, undefined, permissionWriteFence(c, "api_keys"));
  return c.json(result, 201);
});

/**
 * DELETE /api/api-keys/:id
 * Revoke/Delete an API key.
 */
dashboard.delete("/api-keys/:id", apiKeyAdminPermissionGuard(), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: 'Missing ID' }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitApiKeyAdmin({ env: c.env, deps: d, payload: c.get('jwtPayload') as JWTPayload,
    operation: 'api-key.delete', target: { id }, capability: permissionWriteFence(c, 'api_keys'),
    now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return apiKeyAdminFailure(c, admission.reason!);
  if (admission.status === 'admitted') {
    const result = await admittedApiKeyWork(c, d, admission, (repository, commit) => repository.delete(id, commit));
    if (result instanceof Response) return result;
    return c.json({ success: true });
  }
  const revalidationFailure = await revalidatePermission(c, "api_keys");
  if (revalidationFailure) return revalidationFailure;
  await d.repositories.apiKeys.delete(id, permissionWriteFence(c, "api_keys"));
  return c.json({ success: true });
});

/**
 * POST /api/tickets
 * Create a new ticket from the dashboard.
 */
dashboard.post("/tickets", requestBounds(64 * 1024), async (c) => {
  const admissionMode = staffTicketAdmissionMode(c.env);
  if (admissionMode === 'invalid') return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  if (admissionMode === 'enabled') {
    const d = c.get('tenantDeps') as TenantRequestDeps;
    try {
      const body = await readMutationJson(c);
      const parsed = staffCreateTicketSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
      const mutation = staffMutationService(c, d, 'dashboard.ticket.create');
      const prepared = await mutation.prepareStaffMutation({ operation: 'dashboard.ticket.create', data: {
        subject: parsed.data.subject, customer_email: parsed.data.customer_email, body: parsed.data.body,
        bodyFormat: parsed.data.body_format, priority: parsed.data.priority, status: parsed.data.status,
        group_id: parsed.data.group_id, assigned_to: parsed.data.assigned_to, custom_fields: parsed.data.custom_fields,
      } }, readIdempotencyKey(c));
      if (prepared.replay) {
        c.header('Idempotency-Replayed', 'true');
        return c.json(prepared.replay.body, prepared.replay.status);
      }
      const rejection = await admitConfiguredStaffTicketMutation(c, 'dashboard.ticket.create', mutation, prepared);
      if (rejection) return rejection;
      const outcome = await mutation.commit(prepared);
      // A raced receipt winner is already durable work. Only the canonical
      // winner performs the existing best-effort delivery side effects.
      if (!outcome.replayed) {
        await new BroadcastService(c.env,d.scope,d.emitResourceOperation).notifyTicketCreated(outcome.ticket, mutation.broadcastGrant(prepared,outcome));
        try { await deliverCommittedTicketEmail(c,d,mutation,prepared,outcome); }
        catch { console.error('Initial ticket email delivery failed'); }
      }
      if (outcome.replayed) c.header('Idempotency-Replayed', 'true');
      return c.json(outcome.body, outcome.status);
    } catch (error) {
      const failure = staffMutationFailure(c,error); if (failure) return failure;
      if (c.env.LOCAL_BETA_ENABLED !== 'true') console.error('Dashboard budgeted ticket create failed');
      return c.json({ error: 'Failed to create ticket' }, 500);
    }
  }
  const body = await c.req.json();
  const schema = c.env.LOCAL_BETA_ENABLED === 'true' ? createTicketSchema.extend({
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(16000),
    customer_email: z.string().email().max(254),
  }) : createTicketSchema;
  const result = schema.safeParse(body);

  if (!result.success) {
    return c.json({
      error: "Validation failed",
      details: result.error.flatten().fieldErrors
    }, 400);
  }

  const { subject, customer_email, body: articleBody, priority, status, group_id, assigned_to, custom_fields } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(d);
  const agent = c.get("jwtPayload") as JWTPayload;

  try {
    // Link to existing customer record if it exists
    const customer = await d.repositories.users.findByEmail(customer_email.toLowerCase());

    const { ticket, article } = await ticketService.createTicketWithArticle({
      subject,
      customer_email: customer_email.toLowerCase(),
      priority,
      status,
      source: "dashboard",
      customer_id: customer?.id, group_id, assigned_to, custom_fields,
      body: articleBody,
      sender_id: customer?.id,
      sender_type: "customer",
    }, {kind:'staff',id:agent.sub,source:'dashboard'});

    await new BroadcastService(c.env,d.scope,d.emitResourceOperation).notifyTicketCreated(ticket);
    try {
      await new EmailService(c.env,d,(c.env as any).emailTransport).sendTicketReply(ticket,article);
    } catch { console.error('Initial ticket email delivery failed'); }
    return c.json(ticket, 201);
  } catch (error: any) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error("Dashboard Create Ticket Error:", error);
    return c.json({ error: "Failed to create ticket" }, 500);
  }
});

/**
 * GET /api/tickets
 * List tickets with filters and pagination
 */
dashboard.get("/tickets", async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const payload = c.get('jwtPayload') as JWTPayload;
  const sort = z.enum(OPERATOR_WORKSPACE_SORTS).optional().safeParse(c.req.query('sort'));
  if (!sort.success) return c.json({ error: 'Invalid ticket sort' }, 400);
  const admission = await admitHttpTicketList({ env: c.env, deps: d, payload, operation: 'dashboard.ticket.list',
    filterId: c.req.query('filter_id'), search: c.req.query('search'), now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return c.json(admission.reason === 'exhausted'
    ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
    : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, admission.reason === 'exhausted' ? 429 : 503);
  try {
    const result = await d.repositories.tickets.list({
      sort: sort.data,
      customerEmail:c.req.query('customer_email'), filterId:c.req.query('filter_id'),
      status:c.req.query('status'),priority:c.req.query('priority'),assignedTo:c.req.query('assigned_to'),
      groupId:c.req.query('group_id'),ticketNo:c.req.query('ticket_no'),search:c.req.query('search'),
      page:Number(c.req.query('page') || 1),limit:Number(c.req.query('limit') || 50),
      viewer: { role: payload.role === 'agent' ? 'agent' : 'admin', actorId: d.scope.actorId },
      ...(admission.snapshot ? { scanFence: admission.snapshot } : {}),
      ...(admission.snapshot ? { currentCredential: { role: payload.role === 'agent' ? 'agent' : 'admin',
        sessionVersion: payload.session_version ?? -1, expiresAt: payload.exp } } : {}),
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof TicketListScanError) return c.json({ code: 'budget_admission_unavailable', error: 'Ticket list capacity changed; retry the request' }, 503);
    throw error;
  }
});

/**
 * GET /api/tickets/:id
 * Get detailed ticket info with articles and attachments
 */
dashboard.get("/tickets/:id", async (c) => {
  const id = c.req.param("id");
  const d = c.get('tenantDeps') as TenantRequestDeps;

  const admissionEnabled = c.env.BUDGET_ADMISSION_POLICY !== undefined && staffTicketAdmissionMode(c.env) === 'enabled';
  let query: { limit?: string; cursor?: string } = {};
  if (admissionEnabled) {
    try { query = articlePageQuery({ limit: c.req.query('article_limit'), cursor: c.req.query('article_cursor') }); }
    catch (error) {
      if (error instanceof ConversationReadError) return c.json({ code: error.code, error: error.message }, error.status);
      throw error;
    }
  }
  const admission = await admitHttpTicketRead({ env: c.env, deps: d, payload: c.get('jwtPayload') as JWTPayload,
    operation: 'dashboard.ticket.detail', ticketId: id, page: query, now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return c.json(admission.reason === 'exhausted'
    ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
    : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, admission.reason === 'exhausted' ? 429 : 503);

  const ticket = await d.repositories.tickets.get(id);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  const conversationRead = admission.status === 'admitted'
    ? d.boundedConversationRead ?? new BoundedConversationReadRepository(d.database, d.scope)
    : d.boundedConversationRead;
  if (conversationRead) {
    const page=await conversationRead.page(id,{limit:query.limit || c.req.query('article_limit'),cursor:query.cursor || c.req.query('article_cursor')});
    const articles = page.articles.map(({ attachments, ...article }) => ({
      ...article,
      attachments: attachments.map(a => ({
        id: a.id, filename: a.file_name, size: a.file_size,
        contentType: a.content_type, storageKey: a.r2_key,
      })),
    }));
    const response = {
      ...ticket, articles,
      customer: ticket.customer_id ? displayUser(await d.repositories.users.get(ticket.customer_id)) : null,
      assignee: ticket.assigned_to ? displayUser(await d.repositories.users.get(ticket.assigned_to)) : null,
      pagination: page.pagination,
    };
    assertConversationResponseBounds(response);
    return c.json(response);
  }

  const articles = await d.repositories.articles.listByTicket(id);

  // Group attachments by article
  const articlesWithAttachments = await Promise.all(
    articles.map(async (article) => {
      const attachments = await d.repositories.attachments.findByArticle(article.id);
      return {
        ...article,
        attachments: attachments.map((a: any) => ({
          id: a.id, filename: a.file_name, size: a.file_size,
          contentType: a.content_type, storageKey: a.r2_key
        })),
      };
    })
  );

  // Fetch customer details if available
  let customer = null;
  if (ticket.customer_id) {
    customer = await d.repositories.users.get(ticket.customer_id);
  }

  // Fetch assignee details
  let assignee = null;
  if (ticket.assigned_to) {
    assignee = await d.repositories.users.get(ticket.assigned_to);
  }

  return c.json({
    ...ticket,
    articles: articlesWithAttachments,
    customer:displayUser(customer),
    assignee:displayUser(assignee),
  });
});

/**
 * Describe the existing dashboard reply paths without disclosing a recipient,
 * provider configuration, or inferring a delivery route from intake provenance.
 */
dashboard.get('/tickets/:id/reply-capability', async (c) => {
  const ticketId = c.req.param('id');
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const agent = c.get('jwtPayload') as JWTPayload;
  const admission=await admitDashboardSummaryRead({env:c.env,deps:d,payload:agent,
    operation:'dashboard.ticket.reply-capability.read',target:{ticketId},now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return dashboardSummaryBudgetFailure(c,admission.reason!);
  if(admission.status==='admitted'){
    const capability=await admittedDashboardSummary(c,d,admission,(repository,commit)=>repository.replyCapability(ticketId,commit));
    if(capability instanceof Response)return capability;
    if(capability.status==='missing')return c.json({ error: 'Ticket not found' },404);
    if(capability.status==='forbidden')return c.json({ error: 'Forbidden', message: 'You do not have access to this ticket\'s group' },403);
    return c.json(replyCapability(ticketId,{version:1,conversationRevision:capability.revision ?? 0,protocol:'draft-precondition-v1'}));
  }
  const ticket = await d.repositories.tickets.get(ticketId);
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  // Keep the same live group boundary as the corresponding reply mutation.
  if (agent.role === 'agent' && ticket.group_id
    && !await d.repositories.groups.isMember(ticket.group_id, agent.sub)) {
    return c.json({ error: 'Forbidden', message: 'You do not have access to this ticket\'s group' }, 403);
  }

  const admissionMode = staffTicketAdmissionMode(c.env);
  const collision = admissionMode === 'enabled'
    ? { version: 1 as const, protocol: 'draft-precondition-v1' as const,
      conversationRevision: await d.conversationAudit.currentRevision(ticket.id) }
    : undefined;
  const internalMentions = admissionMode === 'enabled'
    ? { version: 1 as const, protocol: 'internal-activity-v1' as const, maxRecipients: 16 as const }
    : undefined;
  return c.json(replyCapability(ticket.id, collision, internalMentions));
});

/**
 * The action list is a server-issued view model. It is deliberately not a
 * generic extension endpoint: tenant data cannot provide executable code,
 * command identifiers, or link targets through this route.
 */
dashboard.get('/tickets/:id/utility-actions', async (c) => {
  const ticketId = c.req.param('id');
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const agent = c.get('jwtPayload') as JWTPayload;
  const ticket = await d.repositories.tickets.get(ticketId);
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
  if (agent.role === 'agent' && ticket.group_id && !await d.repositories.groups.isMember(ticket.group_id, agent.sub)) {
    return c.json({ error: 'Forbidden', message: 'You do not have access to this ticket\'s group' }, 403);
  }
  const decision = await d.capabilityPolicy.authorize({
    tenantId: d.scope.tenantId,
    actorId: agent.sub,
    role: agent.role,
    sessionVersion: agent.session_version ?? 0,
  }, 'tools.reference.read');
  return c.json(governedTicketUtilityActions(ticket.id, decision));
});

/**
 * POST /api/tickets/:id/articles
 * Add a new article (agent response or internal note) to a ticket
 */
dashboard.post("/tickets/:id/articles", requestBounds(64 * 1024), rateLimiter(10, 60000), async (c) => {
  const ticketId = c.req.param("id");
  if (!ticketId) return c.json({ error: 'Missing ID' }, 400);
  const admissionMode = staffTicketAdmissionMode(c.env);
  if (admissionMode === 'invalid') return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  if (admissionMode === 'enabled') {
    const d = c.get('tenantDeps') as TenantRequestDeps;
    try {
      const payload = await readMutationJson(c);
      const parsed = staffReplySchema.safeParse(payload);
      if (!parsed.success) return c.json({ error: 'Invalid bounded reply' }, 400);
      const requested = (parsed.data.attachments ?? []).map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const raw = item as Record<string, unknown>;
        return { storageKey: raw.storageKey ?? raw.key, filename: raw.filename };
      });
      const mutation = staffMutationService(c,d,'dashboard.ticket.reply');
      const prepared = await mutation.prepareStaffMutation({ operation: 'dashboard.ticket.reply', ticketId, data: {
        body: parsed.data.body, bodyFormat: parsed.data.body_format, is_internal: parsed.data.is_internal, draft: parsed.data.draft,
        mentionedUserIds: parsed.data.mentioned_user_ids, attachments: requested as any,
      } }, readIdempotencyKey(c));
      if (prepared.replay) {
        c.header('Idempotency-Replayed', 'true');
        return c.json(prepared.replay.body, prepared.replay.status);
      }
      const rejection = await admitConfiguredStaffTicketMutation(c, 'dashboard.ticket.reply', mutation, prepared);
      if (rejection) return rejection;
      let verified;
      try { verified = await validateAttachmentReferences(d, `agent-attachments/${(c.get('jwtPayload') as JWTPayload).sub}/`, parsed.data.attachments); }
      catch { return c.json({ error: 'Invalid attachment reference' }, 400); }
      const outcome = await mutation.commit(prepared,verified);
      if (!outcome.replayed) {
        if (!outcome.article.is_internal) {
          // The canonical commit returned these exact attachment rows; do not
          // re-list metadata after admission before the bounded stream path.
          try { await deliverCommittedTicketEmail(c,d,mutation,prepared,outcome); }
          catch { console.error('Ticket reply email delivery failed'); }
        }
        await new BroadcastService(c.env,d.scope,d.emitResourceOperation).broadcast('article.created',{ticket_id:ticketId,article_id:outcome.article.id},2,mutation.broadcastGrant(prepared,outcome));
      }
      if (outcome.replayed) c.header('Idempotency-Replayed', 'true');
      return c.json(outcome.body, outcome.status);
    } catch (error) {
      const failure = staffMutationFailure(c,error); if (failure) return failure;
      if (c.env.LOCAL_BETA_ENABLED !== 'true') console.error('Dashboard budgeted ticket reply failed');
      return c.json({ error: 'Failed to add article' }, 500);
    }
  }
  const payloadBody = await c.req.json();
  const boundedReply = z.object({
    body: z.string().min(1).max(16000).refine(value => new TextEncoder().encode(value).length <= 16000),
    body_format: z.enum(ARTICLE_BODY_FORMATS).default(DEFAULT_ARTICLE_BODY_FORMAT),
    is_internal: z.boolean().optional(),
    attachments: z.array(z.unknown()).max(10).optional(),
  }).strict();
  const parsedReply = boundedReply.safeParse(payloadBody);
  if (!parsedReply.success) return c.json({ error: 'Invalid bounded reply' }, 400);
  const { body: articleBody, body_format, is_internal, attachments: bodyAttachments } = parsedReply.data;
  const agent = c.get("jwtPayload") as JWTPayload;
  const d = c.get('tenantDeps') as TenantRequestDeps;

  if (!articleBody) {
    return c.json({ error: "Article body is required" }, 400);
  }

  const ticket = await d.repositories.tickets.get(ticketId);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  // RBAC Check: Ensure agents (non-admins) can only post to tickets in their assigned groups.
  if (agent.role === "agent" && ticket.group_id) {
    const isMember = await d.repositories.groups.isMember(ticket.group_id, agent.sub);
    if (!isMember) {
      return c.json({ error: "Forbidden", message: "You do not have access to this ticket's group" }, 403);
    }
  }

  const ticketService = new TenantTicketService(d);

  await d.betaAdmission?.authorize('conversation');
  let verifiedAttachments;
  try { verifiedAttachments = await validateAttachmentReferences(d, `agent-attachments/${agent.sub}/`, bodyAttachments); }
  catch { return c.json({ error: 'Invalid attachment reference' }, 400); }

  const {article,attachments:savedAttachments} = await ticketService.createAuditedReply(
    ticketId,articleBody,Boolean(is_internal),{kind:'staff',id:agent.sub,source:'dashboard'},verifiedAttachments,body_format);
  const attachments = savedAttachments.map(a => ({id:a.id,filename:a.file_name,size:a.file_size,contentType:a.content_type,storageKey:a.r2_key}));

  if (!article.is_internal) {
    try {
      const savedAttachments = await d.repositories.attachments.findByArticle(article.id);
      await new EmailService(c.env,d,(c.env as any).emailTransport).sendTicketReply(ticket,article,savedAttachments);
    } catch { console.error('Ticket reply email delivery failed'); }
  }
  await new BroadcastService(c.env,d.scope,d.emitResourceOperation).broadcast('article.created',{ticket_id:ticketId,article_id:article.id});
  return c.json({ ...article, attachments }, 201);
});

/**
 * PATCH /api/tickets/:id/responsible-owner
 *
 * Narrow #137 transition over the existing canonical `assigned_to` field.
 * It does not derive availability, ceilings, queue ordering, or SLA state.
 */
dashboard.patch('/tickets/:id/responsible-owner', requestBounds(1024), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  if (staffTicketAdmissionMode(c.env) !== 'enabled') {
    return c.json({ code: 'routing_admission_unavailable', error: 'Responsible-owner assignment requires configured mutation admission' }, 503);
  }
  try {
    const payload = await readMutationJson(c);
    const parsed = responsibleOwnerSchema.safeParse(payload);
    if (!parsed.success) return c.json({ error: 'Invalid responsible-owner assignment', details: parsed.error.flatten().fieldErrors }, 400);
    const key = readIdempotencyKey(c);
    if (!key) return c.json({ code: 'idempotency_key_required', error: 'Idempotency-Key is required for responsible-owner assignment' }, 400);
    const id = c.req.param('id');
    const mutation = staffMutationService(c,d,'dashboard.ticket.update');
    const prepared = await mutation.prepareStaffMutation({ operation:'dashboard.ticket.update',ticketId:id,data:{
      assigned_to:parsed.data.ownerId, responsibleOwnerAssignment:true, expectedAssignedTo:parsed.data.expectedOwnerId,
      ...(parsed.data.capacityOverride ? { capacityOverride:true } : {}),
    } },key);
    if (prepared.replay) {
      c.header('Idempotency-Replayed', 'true');
      return c.json({ success:true, responsibleOwnerId:prepared.replay.ticket.assigned_to ?? null }, prepared.replay.status);
    }
    const rejection = await admitConfiguredStaffTicketMutation(c,'dashboard.ticket.update',mutation,prepared);
    if (rejection) return rejection;
    const outcome = await mutation.commit(prepared);
    await new BroadcastService(c.env,d.scope,d.emitResourceOperation).notifyTicketUpdated(outcome.ticket,mutation.broadcastGrant(prepared,outcome));
    c.header('Idempotency-Replayed', 'false');
    return c.json({ success:true, responsibleOwnerId:outcome.ticket.assigned_to ?? null }, outcome.status);
  } catch (error) {
    const failure = staffMutationFailure(c,error); if (failure) return failure;
    if (c.env.LOCAL_BETA_ENABLED !== 'true') console.error('Dashboard responsible-owner assignment failed');
    return c.json({ error:'Responsible-owner assignment failed' },500);
  }
});

/**
 * POST /api/tickets/:id/route
 *
 * Server-only balanced queue selection for an unassigned active ticket. The
 * queue preserves the existing responsible-owner mutation/audit/receipt path;
 * when every eligible operator is unavailable or at capacity it leaves the
 * ticket unassigned and reports that explicit fallback.
 */
dashboard.post('/tickets/:id/route', requestBounds(1024), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  if (staffTicketAdmissionMode(c.env) !== 'enabled') {
    return c.json({ code:'routing_admission_unavailable',error:'Queue routing requires configured mutation admission' },503);
  }
  try {
    const key = readIdempotencyKey(c);
    if (!key) return c.json({ code:'idempotency_key_required',error:'Idempotency-Key is required for queue routing' },400);
    const id = c.req.param('id');
    const mutation = staffMutationService(c,d,'dashboard.ticket.update');
    const prepared = await mutation.prepareStaffMutation({ operation:'dashboard.ticket.update',ticketId:id,data:{routingSelection:true} },key);
    if (prepared.replay) {
      c.header('Idempotency-Replayed','true');
      return c.json({ success:true,responsibleOwnerId:prepared.replay.ticket.assigned_to ?? null },prepared.replay.status);
    }
    const rejection = await admitConfiguredStaffTicketMutation(c,'dashboard.ticket.update',mutation,prepared);
    if (rejection) return rejection;
    const outcome = await mutation.commit(prepared);
    await new BroadcastService(c.env,d.scope,d.emitResourceOperation).notifyTicketUpdated(outcome.ticket,mutation.broadcastGrant(prepared,outcome));
    c.header('Idempotency-Replayed','false');
    return c.json({ success:true,responsibleOwnerId:outcome.ticket.assigned_to ?? null },outcome.status);
  } catch (error) {
    const failure = staffMutationFailure(c,error); if (failure) return failure;
    if (c.env.LOCAL_BETA_ENABLED !== 'true') console.error('Dashboard queue routing failed');
    return c.json({ error:'Queue routing failed' },500);
  }
});

/**
 * PUT /api/operators/:id/routing-profile
 *
 * Tenant administrators configure server-side routing facts. Assignment does
 * not trust a dashboard copy of this profile: it reads this row again inside
 * the canonical assignment batch.
 */
dashboard.put('/operators/:id/routing-profile', roleGuard(['admin']), permissionGuard('general'), requestBounds(1024), async (c) => {
  try {
    const parsed = routingProfileSchema.safeParse(await readMutationJson(c));
    if (!parsed.success) return c.json({ error: 'Invalid routing profile', details: parsed.error.flatten().fieldErrors }, 400);
    const permissionFailure = await revalidatePermission(c,'general'); if (permissionFailure) return permissionFailure;
    const d = c.get('tenantDeps') as TenantRequestDeps;
    const actor = c.get('jwtPayload') as JWTPayload;
    if (!Number.isSafeInteger(actor.session_version)) return c.json({ error:'Unauthorized' },401);
    const profile = await new StaffTicketMutationRepository(d.database,d.scope)
      .updateRoutingProfile(actor.sub,actor.session_version,c.req.param('id'),parsed.data.available,parsed.data.assignmentCapacity);
    if (!profile) return c.json({ error:'Routing profile update is not authorized' },403);
    return c.json({ available:profile.is_available === 1, assignmentCapacity:profile.assignment_capacity, updatedAt:profile.updated_at });
  } catch (error) {
    if (error instanceof MutationInputError) return c.json({ error:'Invalid routing profile' },400);
    throw error;
  }
});

/**
 * PATCH /api/tickets/:id
 * Update ticket properties
 */
dashboard.patch("/tickets/:id", requestBounds(64 * 1024), async (c) => {
  const id = c.req.param("id");
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admissionMode = staffTicketAdmissionMode(c.env);
  if (admissionMode === 'invalid') return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  if (admissionMode === 'enabled') {
    try {
      const payload = await readMutationJson(c);
      const result = updateTicketSchema.safeParse(payload);
      if (!result.success) return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);
      const updateFields = result.data;
      if (!Object.keys(updateFields).length) return c.json({ error: "No valid fields to update" }, 400);
      const mutation = staffMutationService(c,d,'dashboard.ticket.update');
      const prepared = await mutation.prepareStaffMutation({ operation:'dashboard.ticket.update',ticketId:id,data:updateFields },readIdempotencyKey(c));
      if (prepared.replay) {
        c.header('Idempotency-Replayed', 'true');
        return c.json(prepared.replay.body, prepared.replay.status);
      }
      const rejection = await admitConfiguredStaffTicketMutation(c,'dashboard.ticket.update',mutation,prepared);
      if (rejection) return rejection;
      const outcome = await mutation.commit(prepared);
      if (!outcome.replayed) await new BroadcastService(c.env,d.scope,d.emitResourceOperation).notifyTicketUpdated(outcome.ticket,mutation.broadcastGrant(prepared,outcome));
      if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
      return c.json(outcome.body,outcome.status);
    } catch (error) {
      const failure = staffMutationFailure(c,error); if (failure) return failure;
      if (c.env.LOCAL_BETA_ENABLED !== 'true') console.error('Dashboard budgeted ticket update failed');
      return c.json({ error: 'Failed to update ticket' }, 500);
    }
  }
  const payload = await c.req.json();
  const agent = c.get("jwtPayload") as JWTPayload;

  const result = updateTicketSchema.safeParse(payload);
  if (!result.success) {
    return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);
  }
  const validData = result.data;

  const updateFields: Record<string, any> = {};
  for (const [key, value] of Object.entries(validData)) {
    if (value !== undefined) {
      if (key === 'custom_fields') {
        updateFields[key] = value ? JSON.stringify(value) : null;
      } else {
        updateFields[key] = value;
      }
    }
  }

  if (Object.keys(updateFields).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const ticket = await d.repositories.tickets.get(id);
  if (!ticket) return c.json({error:'Ticket not found'},404);
  if (agent.role === 'agent' && ticket.group_id && !await d.repositories.groups.isMember(ticket.group_id,agent.sub)) return c.json({error:'Forbidden'},403);
  const outcome = await d.conversationAudit.updateWithEvents(id,updateFields,{kind:'staff',id:agent.sub,source:'dashboard'},true);
  if (outcome.ticket) await new BroadcastService(c.env, d.scope, d.emitResourceOperation).notifyTicketUpdated(outcome.ticket);

  return c.json({ success: true });
});

/**
 * GET /api/users
 * List all users with pagination and role filter
 */
dashboard.get("/users", groupDirectoryPermissionGuard("users"), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20') || 20));
  const role=c.req.query('role');
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.users.list',target:{page,limit,role:role??null},capability:permissionWriteFence(c,'users'),
    now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  const users=admission.status==='admitted'
    ?await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.listUsers({page,limit,role},commit))
    :await d.repositories.users.list({page,limit,role});
  if(users instanceof Response)return users;
  return c.json({users,page,limit});
});

/**
 * GET /api/users/agents
 * List all users with agent or admin role
 */
dashboard.get("/users/agents", async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.agents.list',target:{},now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  const users=admission.status==='admitted'
    ?await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.listAllStaff(commit))
    :await d.repositories.users.list({page:1,limit:100,staffOnly:true});
  if(users instanceof Response)return users;
  return c.json(users);
});

/**
 * GET /api/groups
 * List all available groups
 */
dashboard.get("/groups", async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.groups.list',target:{},now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  const results=admission.status==='admitted'
    ?await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.listGroups(commit))
    :await d.repositories.groups.list();
  if(results instanceof Response)return results;
  return c.json(results);
});

/**
 * POST /api/groups
 * Create a new group
 */
dashboard.post("/groups", roleGuard(["admin", "agent"]), groupDirectoryPermissionGuard("groups"), async (c) => {
  const body = await c.req.json();
  const result = createGroupSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { name, description } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const capability=permissionWriteFence(c,"groups");
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.group.create',target:{name,description:description??null},capability,
    now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  if(admission.status==='admitted'){
    const group=await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.createGroup({name,description},commit));
    if(group instanceof Response)return group;
    return group?c.json(group,201):c.json({error:"Group with this name already exists"},409);
  }
  const revalidationFailure = await revalidatePermission(c, "groups");
  if (revalidationFailure) return revalidationFailure;

  try {
    const group = await d.repositories.groups.create({ name, description }, permissionWriteFence(c, "groups"));
    return c.json(group, 201);
  } catch (error: any) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "Group with this name already exists" }, 409);
    }
    throw error;
  }
});

/**
 * DELETE /api/groups/:id
 * Delete a group
 */
dashboard.delete("/groups/:id", roleGuard(["admin", "agent"]), groupDirectoryPermissionGuard("groups"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing ID" }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.group.delete',target:{groupId:id},capability:permissionWriteFence(c,'groups'),
    now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  if(admission.status==='admitted'){
    const outcome=await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.deleteGroup(id,commit));
    if(outcome instanceof Response)return outcome;
    if(outcome==='missing')return c.json({error:"Group not found"},404);
    if(outcome==='has_tickets')return c.json({error:"Cannot delete group with associated tickets"},400);
    return c.json({success:true});
  }

  const group = await d.repositories.groups.get(id);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  const hasTickets = await d.repositories.groups.hasTickets(id);
  if (hasTickets) {
    return c.json({ error: "Cannot delete group with associated tickets" }, 400);
  }

  const revalidationFailure = await revalidatePermission(c, "groups");
  if (revalidationFailure) return revalidationFailure;
  await d.repositories.groups.delete(id, permissionWriteFence(c, "groups"));
  return c.json({ success: true });
});

/**
 * GET /api/groups/:id/members
 * List users belonging to a specific group
 */
dashboard.get("/groups/:id/members", async (c) => {
  const groupId = c.req.param("id");
  if (!groupId) return c.json({ error: "Missing ID" }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.group.members.list',target:{groupId},now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  if(admission.status==='admitted'){
    const result=await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.members(groupId,commit));
    if(result instanceof Response)return result;
    return result?c.json(result.members):c.json({error:"Group not found"},404);
  }

  const group = await d.repositories.groups.get(groupId);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  const members = await d.repositories.groups.getMembers(groupId);
  return c.json(members);
});

/**
 * POST /api/groups/:id/members
 * Add a user to a group
 */
dashboard.post("/groups/:id/members", roleGuard(["admin", "agent"]), groupDirectoryPermissionGuard("groups"), async (c) => {
  const groupId = c.req.param("id");
  if (!groupId) return c.json({ error: "Missing ID" }, 400);
  const body = await c.req.json();
  const result = addMemberSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { userId } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
    operation:'directory.group.member.add',target:{groupId,userId},capability:permissionWriteFence(c,'groups'),
    now:()=>c.env.localNow?.()??Date.now()});
  if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
  if(admission.status==='admitted'){
    const outcome=await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.addMember(groupId,userId,commit));
    if(outcome instanceof Response)return outcome;
    if(outcome==='missing_group')return c.json({error:"Group not found"},404);
    if(outcome==='missing_user')return c.json({error:"User not found"},404);
    if(outcome==='already_member')return c.json({error:"User is already a member of this group"},409);
    return c.json({success:true});
  }

  const group = await d.repositories.groups.get(groupId);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  const user = await d.repositories.users.get(userId);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const revalidationFailure = await revalidatePermission(c, "groups");
  if (revalidationFailure) return revalidationFailure;
  try {
    await d.repositories.groups.addMember(groupId, userId, permissionWriteFence(c, "groups"));
  } catch (error: any) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "User is already a member of this group" }, 409);
    }
    throw error;
  }

  return c.json({ success: true });
});

/**
 * DELETE /api/groups/:id/members/:userId
 * Remove a user from a group
 */
dashboard.delete(
  "/groups/:id/members/:userId",
  roleGuard(["admin", "agent"]),
  groupDirectoryPermissionGuard("groups"),
  async (c) => {
    const groupId = c.req.param("id");
    const userId = c.req.param("userId");
    if (!groupId || !userId) return c.json({ error: "Missing ID" }, 400);
    const d = c.get('tenantDeps') as TenantRequestDeps;
    const admission=await admitGroupDirectory({env:c.env,deps:d,payload:c.get('jwtPayload') as JWTPayload,
      operation:'directory.group.member.remove',target:{groupId,userId},capability:permissionWriteFence(c,'groups'),
      now:()=>c.env.localNow?.()??Date.now()});
    if(admission.status==='rejected')return groupDirectoryBudgetFailure(c,admission.reason!);
    if(admission.status==='admitted'){
      const removed=await admittedGroupDirectoryWork(c,d,admission,(repository,commit)=>repository.removeMember(groupId,userId,commit));
      if(removed instanceof Response)return removed;
      return removed?c.json({success:true}):c.json({error:"User is not a member of this group"},404);
    }

    // Verify membership exists via isMember
    const isMember = await d.repositories.groups.isMember(groupId, userId);

    if (!isMember) {
      return c.json({ error: "User is not a member of this group" }, 404);
    }

    const revalidationFailure = await revalidatePermission(c, "groups");
    if (revalidationFailure) return revalidationFailure;
    await d.repositories.groups.removeMember(groupId, userId, permissionWriteFence(c, "groups"));
    return c.json({ success: true });
  }
);

/**
 * GET /api/attachments/:id/download
 * Download a specific attachment
 */
dashboard.get('/attachments/:id/download', async (c) => {
  const attachmentId = c.req.param('id');
  if (!attachmentId) return c.json({ error: "Missing ID" }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;

  const attachment = await d.repositories.attachments.getAttachmentWithMeta(attachmentId);
  if (!attachment) return c.json({ error: 'Not found' }, 404);

  const payload = c.get('jwtPayload') as JWTPayload;
  const digest = await storageDigest(['dashboard-attachment-download-v1', d.scope.tenantId, payload.sub, attachment.id, crypto.randomUUID()]);
  const admission = await admitDashboardAttachment({ env: c.env, deps: d, payload, operation: 'dashboard.attachment.download',
    operationId: `storage-download:${digest}`, operationFingerprint: `storage-download:${digest}`, now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return attachmentBudgetFailure(c, admission.reason!);

  const response = await d.attachmentStorage.getAttachment(attachment.r2_key);
  if (!response) return c.json({ error: 'File not found in storage' }, 404);

  const headers = new Headers();
  response.writeHttpMetadata(headers);
  const newResponse = new Response(response.body, {headers});
  const safeFileName = (attachment.file_name || 'attachment').replace(/^.*[\\/]/, '').replace(/[\r\n"]/g, '_');
  newResponse.headers.set('Content-Disposition', `attachment; filename="${safeFileName}"`);
  return newResponse;
});

/**
 * POST /api/attachments/upload
 * Upload an attachment via tenant-scoped R2 storage
 */
dashboard.post('/attachments/upload', async (c) => {
  const payload = c.get('jwtPayload');
  const d = c.get('tenantDeps') as TenantRequestDeps;

  const MAX_FILE_SIZE = REPLY_ATTACHMENT_RULES.maxBytesPerFile;
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > MAX_FILE_SIZE) {
    return c.json({ error: 'Payload too large. Maximum size is 10MB.' }, 413);
  }

  const formData = await c.req.formData();
  if(c.env.LOCAL_BETA_ENABLED==='true' && formData.getAll('file').length!==1) return c.json({error:'A single file is required'},400);
  const fileRaw = formData.get('file');

  if (!fileRaw || typeof fileRaw === 'string') {
    return c.json({ error: 'No valid file uploaded' }, 400);
  }

  const file = fileRaw as unknown as File;

  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: 'File too large. Maximum size is 10MB.' }, 413);
  }

  if (!(REPLY_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return c.json({ error: 'Unsupported file type. Please upload images, PDFs, or text files.' }, 415);
  }

  if(c.env.LOCAL_BETA_ENABLED==='true' && (!file.name.trim() || file.name.length>255))return c.json({error:'Invalid attachment filename'},400);
  const fileExt = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '');
  const extPart = fileExt ? `.${fileExt}` : '';
  const requestedIdempotency = c.req.header('idempotency-key');
  const idempotencyKey = boundedIdempotencyKey(requestedIdempotency);
  if (requestedIdempotency !== undefined && !idempotencyKey) return c.json({ error: 'Invalid Idempotency-Key' }, 400);
  const uploadSeed = idempotencyKey ?? crypto.randomUUID();
  const digest = await storageDigest(['dashboard-attachment-upload-v1', d.scope.tenantId, payload.sub, uploadSeed]);
  // FormData has already bounded the file to the endpoint's ten MiB limit.
  // Hash its exact bytes before admission so an idempotency key cannot replay a
  // same-size replacement. The original stream remains usable for R2 below.
  const fileBytes = await file.arrayBuffer();
  const byteDigest = await storageByteDigest(fileBytes);
  const fingerprint = await storageDigest(['dashboard-attachment-upload-content-v2', file.name, file.type, String(file.size), byteDigest]);
  // An idempotent key maps to one immutable logical object. Legacy unkeyed
  // uploads retain their extension-bearing key shape, and existing stored
  // references remain readable through the unchanged tenant storage adapter.
  const logicalKey = idempotencyKey
    ? `agent-attachments/${payload.sub}/${digest}`
    : `agent-attachments/${payload.sub}/${digest}${extPart}`;
  const admission = await admitDashboardAttachment({ env: c.env, deps: d, payload, operation: 'dashboard.attachment.upload',
    operationId: `storage-upload:${digest}`, operationFingerprint: `storage-upload:${fingerprint}`, bytes: file.size,
    now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return attachmentBudgetFailure(c, admission.reason!);

  try {
    // A retry with an Idempotency-Key first verifies its own bounded marker.
    // We never delete after an ambiguous write: provider acceptance remains
    // charged until a later lifecycle operation owns cleanup evidence.
    await d.attachmentStorage.prepareUploadAttempt();
    const existing = idempotencyKey ? await d.attachmentStorage.getAttachment(logicalKey) : null;
    if (existing) {
      try {
        if ((existing.customMetadata as Record<string, string> | undefined)?.tocynUploadFingerprint !== fingerprint) {
          return c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409);
        }
      } finally { await existing.body?.cancel(); }
      return c.json({ key: logicalKey });
    }
    try {
      const put = await d.attachmentStorage.putAttachment(logicalKey, c.env.LOCAL_BETA_ENABLED==='true' ? fileBytes : file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: { tocynUploadFingerprint: fingerprint },
        onlyIf: { etagDoesNotMatch: '*' },
      });
      // R2 may report an unmet conditional write as `null` rather than
      // throwing. Treat it exactly like the catch path below; returning a key
      // before checking its marker would permit a conflicting overwrite race.
      if (put.res !== null) return c.json({ key: logicalKey });
    } catch (error) {
      if (error instanceof BetaAdmissionError) throw error;
      // A conditional collision can be the original write winning while this
      // request lost its response. One bounded second metadata read proves a
      // same-fingerprint recovery; every other ambiguous error stays charged.
      const winner = await d.attachmentStorage.getAttachment(logicalKey);
      if (winner) {
        try {
          if ((winner.customMetadata as Record<string, string> | undefined)?.tocynUploadFingerprint === fingerprint) return c.json({ key: logicalKey });
        } finally { await winner.body?.cancel(); }
        return c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409);
      }
      throw error;
    }
    const winner = await d.attachmentStorage.getAttachment(logicalKey);
    if (winner) {
      try {
        if ((winner.customMetadata as Record<string, string> | undefined)?.tocynUploadFingerprint === fingerprint) return c.json({ key: logicalKey });
      } finally { await winner.body?.cancel(); }
      return c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409);
    }
    return c.json({ error: 'Failed to upload file to storage' }, 500);
  } catch (error: any) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error('Error uploading file:', error);
    return c.json({ error: 'Failed to upload file to storage' }, 500);
  }
});

dashboard.get('/tickets/:id/history', c => conversationHistory(c,'staff'));

export default dashboard;
