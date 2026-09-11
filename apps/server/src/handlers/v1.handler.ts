import { BetaAdmissionError } from '../types/local-beta';
import { articlePageQuery, assertConversationResponseBounds, ConversationReadError } from '../services/conversation-read-bounds';
import { conversationHistory, conversationHistoryPage } from './conversation-history';
import { ConversationHistoryError } from '../services/conversation-audit.service';
import { Hono } from "hono";
import { z } from "zod";
import { Env } from "../bindings";
import { apiAuthMiddleware } from "../middleware/api-auth.middleware";
import { rateLimiter } from "../middleware/rate-limiter";
import { AppVariables } from "../types";
import { TenantRequestDeps } from "../middleware/tenant.middleware";
import { BoundedConversationReadRepository } from '../repositories/bounded-conversation-read.repository';
import { TenantTicketService } from "../services/tenant-ticket.service";
import { TicketMutationError } from '../services/ticket-mutation-replay.service';
import { apiTicketCreateSchema, apiTicketReplySchema, MutationInputError, mutationInputErrorBody, readIdempotencyKey, readMutationJson } from './mutation-request';
import { requestBounds } from '../middleware/request-bounds';
import { admitConfiguredApiTicketMutation } from '../middleware/budget-admission.middleware';
import { admitApiTicketHistory } from '../budgets/api-ticket-history-admission.service';
import { admitApiTicketDetail } from '../budgets/api-ticket-detail-admission.service';

const updateTicketSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
});

const v1 = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * Apply API Authentication to all v1 routes.
 * apiAuthMiddleware resolves the API key to TenantRequestDeps.
 */
v1.use("*", apiAuthMiddleware);
v1.use("*", requestBounds(64 * 1024));

/**
 * POST /api/v1/tickets
 * Create a new ticket via the external API.
 */
v1.post("/tickets", rateLimiter(10, 60000), async (c) => {
  const resolution = c.get('apiKeyResolution');
  if (resolution && !resolution.permissions.includes('tickets:write')) {
    return c.json({ error: "Forbidden: API key lacks required permission" }, 403);
  }

  const deps = c.get('tenantDeps') as TenantRequestDeps;
  let body: unknown; let key: string | undefined;
  try { body = await readMutationJson(c); key = readIdempotencyKey(c); } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status); throw error;
  }
  const result = apiTicketCreateSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);
  }
  const validData = result.data;

  try {
    const mutation = deps.ticketMutationReplay({ kind: 'api-key', id: resolution!.apiKeyId });
    const prepared = await mutation.prepareMutation({ operation: 'api.ticket.create', data: validData }, key);
    if (prepared.replay) {
      if (prepared.replay.keyed) c.header('Idempotency-Replayed', String(prepared.replay.replayed));
      return c.json(prepared.replay.body, prepared.replay.status);
    }
    const budgetRejection = await admitConfiguredApiTicketMutation(c, 'api.ticket.create', mutation, prepared);
    if (budgetRejection) return budgetRejection;
    const outcome = await mutation.commit(prepared);
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error("API Create Ticket Error:", error);
    return c.json({ error: "Failed to create ticket" }, 500);
  }
});

/**
 * GET /api/v1/tickets/:id
 * Retrieve ticket details and articles.
 */
v1.get("/tickets/:id", async (c) => {
  const resolution = c.get('apiKeyResolution');
  if (resolution && !resolution.permissions.includes('tickets:read')) {
    return c.json({ error: "Forbidden: API key lacks required permission" }, 403);
  }

  const id = c.req.param("id");
  if (!id) return c.json({ error: 'Missing ID' }, 400);
  let query: { limit?: string; cursor?: string };
  try {
    query = articlePageQuery({ limit: c.req.query('article_limit'), cursor: c.req.query('article_cursor') });
  } catch (error) {
    if (error instanceof ConversationReadError) return c.json({ code: error.code, error: error.message }, error.status);
    throw error;
  }
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);
  // This route owns bounded API detail reads. Other existing consumers keep
  // their established local-beta branch until their own admission work lands.
  const conversationRead = deps.boundedConversationRead ?? new BoundedConversationReadRepository(deps.database, deps.scope);

  // Admission rechecks the active integration key and its current read
  // permission before this route can reveal whether a tenant-scoped ticket
  // exists or begin any article/attachment query.
  const admission = await admitApiTicketDetail({ env: c.env, deps, apiKeyId: resolution!.apiKeyId,
    ticketId: id, page: query, now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return c.json(admission.reason === 'exhausted'
    ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
    : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, admission.reason === 'exhausted' ? 429 : 503);

  const ticket = await deps.repositories.tickets.get(id);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  try {
    const page=await conversationRead.page(id,{publicOnly:true,limit:query.limit,cursor:query.cursor});
    const response = {
      ...ticket,
      articles: page.articles.map(({ attachments, ...article }) => article),
      canonical: await ticketService.projectAuditedConversation(ticket, page.articles, { boundedPage: true }),
      pagination: page.pagination,
    };
    assertConversationResponseBounds(response);
    return c.json(response);
  } catch (error) {
    if (error instanceof ConversationReadError) return c.json({ code: error.code, error: error.message }, error.status);
    throw error;
  }
});

/**
 * POST /api/v1/tickets/:id/articles
 * Add a new article (comment/reply) to an existing ticket.
 */
v1.post("/tickets/:id/articles", rateLimiter(10, 60000), async (c) => {
  const resolution = c.get('apiKeyResolution');
  if (resolution && !resolution.permissions.includes('tickets:write')) {
    return c.json({ error: "Forbidden: API key lacks required permission" }, 403);
  }

  const id = c.req.param("id");
  if (!id) return c.json({ error: 'Missing ID' }, 400);
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  let body: unknown; let key: string | undefined;
  try { body = await readMutationJson(c); key = readIdempotencyKey(c); } catch (error) { if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status); throw error; }
  const parsed = apiTicketReplySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);

  const ticket = await deps.repositories.tickets.get(id);
  if (!ticket) {
    // This tenant-scoped lookup is the authoritative pre-mutation denial;
    // no D1 mutation batch is attempted on this path.
    deps.canonicalMutationSli?.recordDenied();
    return c.json({ error: "Ticket not found" }, 404);
  }

  try {
    const mutation = deps.ticketMutationReplay({ kind: 'api-key', id: resolution!.apiKeyId });
    const prepared = await mutation.prepareMutation({ operation: 'api.ticket.reply', ticketId: id, data: parsed.data }, key);
    if (prepared.replay) {
      if (prepared.replay.keyed) c.header('Idempotency-Replayed', String(prepared.replay.replayed));
      return c.json(prepared.replay.body, prepared.replay.status);
    }
    const budgetRejection = await admitConfiguredApiTicketMutation(c, 'api.ticket.reply', mutation, prepared);
    if (budgetRejection) return budgetRejection;
    const outcome = await mutation.commit(prepared);
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error("API Add Article Error:", error);
    return c.json({ error: "Failed to add article" }, 500);
  }
});

/**
 * PATCH /api/v1/tickets/:id
 * Update ticket properties (status, priority, etc.).
 */
v1.patch("/tickets/:id", async (c) => {
  const resolution = c.get('apiKeyResolution');
  if (resolution && !resolution.permissions.includes('tickets:write')) {
    return c.json({ error: "Forbidden: API key lacks required permission" }, 403);
  }
  const id = c.req.param("id");
  if (!id) return c.json({ error: 'Missing ID' }, 400);
  let body: unknown;
  let key: string | undefined;
  try { body = await readMutationJson(c); key = readIdempotencyKey(c); }
  catch (error) { if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status); throw error; }
  const deps = c.get('tenantDeps') as TenantRequestDeps;

  const ticket = await deps.repositories.tickets.get(id);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  const result = updateTicketSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);
  }
  const validData = result.data;
  if (deps.betaAdmission) assertConversationResponseBounds({...ticket,...validData});

  if (Object.keys(validData).length === 0) {
    return c.json({ error: "No valid updates provided" }, 400);
  }

  try {
    const mutation = deps.ticketMutationReplay({ kind: 'api-key', id: resolution!.apiKeyId });
    const prepared = await mutation.prepareMutation({ operation: 'api.ticket.update', ticketId: id, data: validData }, key);
    if (prepared.replay) {
      if (prepared.replay.keyed) c.header('Idempotency-Replayed', String(prepared.replay.replayed));
      return c.json(prepared.replay.body, prepared.replay.status);
    }
    const budgetRejection = await admitConfiguredApiTicketMutation(c, 'api.ticket.update', mutation, prepared);
    if (budgetRejection) return budgetRejection;
    const outcome = await mutation.commit(prepared);
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error("API Update Ticket Error:", error);
    return c.json({ error: "Failed to update ticket" }, 500);
  }
});

v1.get('/tickets/:id/history', async c => {
  if (!c.get('apiKeyResolution')?.permissions.includes('tickets:read')) return c.json({error:'Forbidden'},403);
  let page;
  try { page = conversationHistoryPage({ limit: c.req.query('limit'), cursor: c.req.query('cursor') }); }
  catch (error) {
    if (error instanceof ConversationHistoryError) return c.json({ error: error.message }, error.status);
    return c.json({ error: 'Conversation history unavailable' }, 503);
  }
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticket = await deps.repositories.tickets.get(c.req.param('id')!);
  // Preserve the existing tenant-qualified not-found response without spending
  // capacity on a target the principal cannot read.
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
  const admission = await admitApiTicketHistory({ env: c.env, deps, apiKeyId: c.get('apiKeyResolution')!.apiKeyId,
    ticketId: ticket.id, page, now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return c.json(admission.reason === 'exhausted'
    ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
    : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, admission.reason === 'exhausted' ? 429 : 503);
  return conversationHistory(c, 'api', page);
});

export default v1;
