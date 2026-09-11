import { BetaAdmissionError } from '../types/local-beta';
import { assertConversationResponseBounds } from '../services/conversation-read-bounds';
import { conversationHistory } from './conversation-history';
import { validateAttachmentReferences } from '../services/attachment-references';
import { EmailService } from '../services/email/outbound.service';
import { BroadcastService } from '../services/broadcast.service';
import { Hono } from "hono";
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
import { SupportStateError } from '../repositories/support-state.repository';
import { SlaClockError } from '../repositories/sla-clock.repository';
import { SlaClockService } from '../services/sla-clock.service';
import type { SlaPolicyInput } from '../types/sla';
import { MutationInputError, mutationInputErrorBody, readIdempotencyKey, readMutationJson } from './mutation-request';
import { requestBounds } from '../middleware/request-bounds';
import workspace from "./operator-workspace.handler";
import { replyCapability } from '../services/reply-capability';
import { REPLY_ATTACHMENT_CONTENT_TYPES, REPLY_ATTACHMENT_RULES } from '@luminatick/shared';
import { StaffTicketMutationService } from '../services/staff-ticket-mutation.service';
import { OperatorActivityService } from '../services/operator-activity.service';
import { TicketMutationError } from '../services/ticket-mutation-replay.service';
import { admitConfiguredStaffTicketMutation, sessionTicketBudgetAdmission, STAFF_TICKET_ENVELOPES, staffTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { admitDashboardAttachment } from '../budgets/storage-admission.service';

const createGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional().nullable(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid("Invalid User ID format"),
});

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

function staffMutationFailure(c: any, error: unknown): Response | null {
  if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
  if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
  return null;
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
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const results = await deps.repositories.ticketFields.list();
  return c.json(results);
});

/**
 * POST /api/ticket-fields
 * Create a new custom ticket field
 */
dashboard.post("/ticket-fields", roleGuard(["admin", "agent"]), permissionGuard("ticket_fields"), async (c) => {
  const body = await c.req.json();
  const result = createTicketFieldSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { name, label, field_type, options, is_active } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "ticket_fields");
  if (revalidationFailure) return revalidationFailure;

  try {
    const field = await d.repositories.ticketFields.create({
      name, label, field_type, options: options || null, is_active
    }, permissionWriteFence(c, "ticket_fields"));
    return c.json(field, 201);
  } catch (error: any) {
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
  return c.json(await d.repositories.tickets.dashboardStats());
});

// State definitions are operational settings. They remain separate from the
// legacy ticket payload and use the existing general-settings capability.
dashboard.get('/support-states', async (c) => {
  const limit = Number(c.req.query('limit') ?? '100');
  const cursor = c.req.query('cursor') || undefined;
  const includeInactive = c.req.query('include_inactive') === 'true';
  try {
    const page = await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps).listDefinitionsPage(limit, cursor, includeInactive);
    const response = c.json(page.results);
    if (page.nextCursor) response.headers.set('X-Next-Cursor', page.nextCursor);
    return response;
  }
  catch (error) { return supportStateFailure(c, error); }
});

dashboard.get('/sla-policy', async (c) => {
  try { return c.json(await new SlaClockService(c.get('tenantDeps') as TenantRequestDeps).getPolicy()); }
  catch (error) { return slaFailure(c, error); }
});

dashboard.put('/sla-policy', requestBounds(64 * 1024), roleGuard(['admin']), permissionGuard('general'), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = slaPolicySchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid SLA policy' }, 400);
  const revalidationFailure = await revalidatePermission(c, 'general');
  if (revalidationFailure) return revalidationFailure;
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
  try {
    await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps)
      .deactivate(id, parsed.data, permissionWriteFence(c, 'general'));
    return c.json({ success: true });
  } catch (error) { return supportStateFailure(c, error); }
});

dashboard.get('/tickets/:id/support-state', async (c) => {
  try {
    const state = await new SupportStateService(c.get('tenantDeps') as TenantRequestDeps).getTicketState(c.req.param('id'));
    if (!state) return c.json({ error: 'Ticket not found' }, 404);
    return c.json(state);
  } catch (error) { return supportStateFailure(c, error); }
});

dashboard.get('/tickets/:id/sla', async (c) => {
  try {
    const projection = await new SlaClockService(c.get('tenantDeps') as TenantRequestDeps).getTicketProjection(c.req.param('id'));
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
  try { return c.json(await new SlaClockService(c.get('tenantDeps') as TenantRequestDeps).getTicketProjections(parsed.data.ticketIds)); }
  catch (error) { return slaFailure(c, error); }
});

dashboard.patch('/tickets/:id/support-state', requestBounds(64 * 1024), async (c) => {
  const mutation = await readSupportStateMutation(c);
  if ('response' in mutation) return mutation.response;
  const parsed = supportStateTransitionSchema.safeParse(mutation.body);
  if (!parsed.success) return c.json({ error: 'Invalid support-state transition' }, 400);
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
  const results = await d.repositories.automations.list();
  return c.json(results);
});

/**
 * POST /api/automations
 * Create a new automation rule.
 */
dashboard.post("/automations", permissionGuard("automations"), async (c) => {
  const payload = await c.req.json();
  const { name, event_type, conditions, action_type, action_config, is_active } = payload;

  if (!name || !event_type || !action_type) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "automations");
  if (revalidationFailure) return revalidationFailure;
  const rule = await d.repositories.automations.create({
    name, event_type, conditions: conditions || undefined,
    action_type, action_config: action_config || undefined,
    is_active: is_active ? true : false
  }, permissionWriteFence(c, "automations"));

  return c.json(rule, 201);
});

/**
 * PATCH /api/automations/:id
 * Update an automation rule.
 */
dashboard.patch("/automations/:id", permissionGuard("automations"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing ID" }, 400);
  const payload = await c.req.json();
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "automations");
  if (revalidationFailure) return revalidationFailure;

  const rule = await d.repositories.automations.update(id, payload, permissionWriteFence(c, "automations"));
  return c.json(rule);
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
  await d.repositories.automations.delete(id, permissionWriteFence(c, "automations"));
  return c.json({ success: true });
});

/**
 * GET /api/api-keys
 * List all API keys for management (metadata only, never hashes/secrets).
 */
dashboard.get("/api-keys", permissionGuard("api_keys"), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const keys = await d.repositories.apiKeys.list();
  return c.json(keys);
});

/**
 * POST /api/api-keys
 * Generate a new API key. Plaintext returned once only.
 */
dashboard.post("/api-keys", permissionGuard("api_keys"), async (c) => {
  const { name } = await c.req.json();
  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  const d = c.get('tenantDeps') as TenantRequestDeps;
  const revalidationFailure = await revalidatePermission(c, "api_keys");
  if (revalidationFailure) return revalidationFailure;
  const result = await d.repositories.apiKeys.create(name, undefined, permissionWriteFence(c, "api_keys"));
  return c.json(result, 201);
});

/**
 * DELETE /api/api-keys/:id
 * Revoke/Delete an API key.
 */
dashboard.delete("/api-keys/:id", permissionGuard("api_keys"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: 'Missing ID' }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;
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
        try { await new EmailService(c.env,d,(c.env as any).emailTransport).sendTicketReply(outcome.ticket,outcome.article,outcome.attachments); }
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
  const sort = z.enum(OPERATOR_WORKSPACE_SORTS).optional().safeParse(c.req.query('sort'));
  if (!sort.success) return c.json({ error: 'Invalid ticket sort' }, 400);
  const result = await d.repositories.tickets.list({
    sort: sort.data,
    customerEmail:c.req.query('customer_email'), filterId:c.req.query('filter_id'),
    status:c.req.query('status'),priority:c.req.query('priority'),assignedTo:c.req.query('assigned_to'),
    groupId:c.req.query('group_id'),ticketNo:c.req.query('ticket_no'),search:c.req.query('search'),
    page:Number(c.req.query('page') || 1),limit:Number(c.req.query('limit') || 50)
  });
  return c.json(result);
});

/**
 * GET /api/tickets/:id
 * Get detailed ticket info with articles and attachments
 */
dashboard.get("/tickets/:id", async (c) => {
  const id = c.req.param("id");
  const d = c.get('tenantDeps') as TenantRequestDeps;

  const ticket = await d.repositories.tickets.get(id);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  if (d.boundedConversationRead) {
    const page=await d.boundedConversationRead.page(id,{limit:c.req.query('article_limit'),cursor:c.req.query('article_cursor')});
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
          try { await new EmailService(c.env,d,(c.env as any).emailTransport).sendTicketReply(outcome.ticket,outcome.article,outcome.attachments); }
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
dashboard.get("/users", permissionGuard("users"), async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20') || 20));
  const users = await d.repositories.users.list({page,limit,role:c.req.query('role')});
  return c.json({users,page,limit});
});

/**
 * GET /api/users/agents
 * List all users with agent or admin role
 */
dashboard.get("/users/agents", async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  return c.json(await d.repositories.users.list({page:1,limit:100,staffOnly:true}));
});

/**
 * GET /api/groups
 * List all available groups
 */
dashboard.get("/groups", async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;
  const results = await d.repositories.groups.list();
  return c.json(results);
});

/**
 * POST /api/groups
 * Create a new group
 */
dashboard.post("/groups", roleGuard(["admin", "agent"]), permissionGuard("groups"), async (c) => {
  const body = await c.req.json();
  const result = createGroupSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { name, description } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;
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
dashboard.delete("/groups/:id", roleGuard(["admin", "agent"]), permissionGuard("groups"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing ID" }, 400);
  const d = c.get('tenantDeps') as TenantRequestDeps;

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
dashboard.post("/groups/:id/members", roleGuard(["admin", "agent"]), permissionGuard("groups"), async (c) => {
  const groupId = c.req.param("id");
  if (!groupId) return c.json({ error: "Missing ID" }, 400);
  const body = await c.req.json();
  const result = addMemberSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const { userId } = result.data;
  const d = c.get('tenantDeps') as TenantRequestDeps;

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
  permissionGuard("groups"),
  async (c) => {
    const groupId = c.req.param("id");
    const userId = c.req.param("userId");
    if (!groupId || !userId) return c.json({ error: "Missing ID" }, 400);
    const d = c.get('tenantDeps') as TenantRequestDeps;

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
