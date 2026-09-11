import { localBetaEnabled, authorizeLocalBeta } from '../middleware/local-beta';
import { LOCAL_AUTH_CAPTURE_RECIPIENTS } from '../services/email/transport';
import { BetaAdmissionError } from '../types/local-beta';
import { articlePageQuery, assertConversationResponseBounds, ConversationReadError } from '../services/conversation-read-bounds';
import { conversationHistory } from './conversation-history';
import { z } from 'zod';
import { validateAttachmentReferences } from '../services/attachment-references';
import { requestBounds } from '../middleware/request-bounds';
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Env } from "../bindings";
import { AppVariables, Article } from "../types";
import { CustomerAuthService } from "../services/customer-auth.service";
import { TenantTicketService } from "../services/tenant-ticket.service";
import { publicArticleBodyText } from '../services/email/article-body-renderer';
import { publicSupportState } from '../types/support-state';
import { tenantMiddleware, TenantRequestDeps, createTenantRequestDeps, createCustomerAuthResolvers } from "../middleware/tenant.middleware";
import { createVerifiedTenantScope } from "../auth/scope";
import { BroadcastService } from "../services/broadcast.service";
import { widgetAuthMiddleware } from "../middleware/widget-auth.middleware";
import { roleGuard } from "../middleware/role.guard";
import { rateLimiter } from "../middleware/rate-limiter";
import { decryptString } from "../utils/crypto";
import { verifyTurnstileToken } from "../utils/turnstile";
import { TicketMutationError } from '../services/ticket-mutation-replay.service';
import { SlaClockError } from '../repositories/sla-clock.repository';
import type { RequestCredentialAuthDecision } from '../observability/request-auth-sli';
import { MutationInputError, mutationInputErrorBody, normalizeAttachmentReferences, portalTicketCreateSchema, portalTicketReplySchema, readIdempotencyKey, readMutationJson } from './mutation-request';
import { admitConfiguredCustomerTicketMutation, customerTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { admitCustomerAttachment } from '../budgets/customer-storage-admission.service';
import { admitHttpTicketRead } from '../budgets/http-ticket-read-admission.service';
import { BoundedConversationReadRepository } from '../repositories/bounded-conversation-read.repository';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function boundedStorageIdempotencyKey(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

async function storageDigest(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function storageByteDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function attachmentBudgetFailure(c: any, reason: string): Response {
  return reason === 'exhausted'
    ? c.json({ code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }, 429)
    : reason === 'conflict'
      ? c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409)
      : c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
}

function recordCredentialDecision(c: { get: (key: 'requestAuthSli') => AppVariables['requestAuthSli'] }, decision: RequestCredentialAuthDecision): void {
  try { c.get('requestAuthSli')?.record(decision); } catch { /* Evidence cannot affect authentication. */ }
}

app.use('*', async (c, next) => requestBounds(c.req.path.endsWith('/attachments/upload') ? 10 * 1024 * 1024 + 50000 : 64 * 1024)(c, next));

// --- PUBLIC CONFIG ROUTE ---
app.get('/config', async (c) => {
  if (c.req.header('X-Tenant-ID') || c.req.query('tenant_id') || c.req.query('tenantId')) {
    return c.json({ error: 'Invalid tenant context' }, 400);
  }
  const widgetKey = c.req.header('X-Widget-Key') || c.req.query('key');
  if (!widgetKey?.trim()) return c.json({ error: 'Widget key required' }, 400);
  const tenantId = (await createCustomerAuthResolvers(c.env, c.get('resourceOperationEmitter')).widget.resolveTenantByKey(widgetKey.trim()))?.tenantId;
  if (!tenantId) return c.json({ error: 'Widget configuration not found' }, 404);
  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'));
  return c.json(await new CustomerAuthService(c.env, deps).getConfig());
});

// --- AUTHENTICATION ROUTES ---

app.post('/auth/request', rateLimiter(5, 60000), async (c) => {
  const body = await c.req.json();

  const parsedAuth = z.object({ email: z.string().trim().email().max(254), type: z.enum(['magic_link', 'otp']).default('magic_link') }).safeParse(body);
  if (!parsedAuth.success) return c.json({ error: 'Invalid authentication request' }, 400);

  // Reject caller-supplied tenant IDs in body or header immediately
  if (body.tenant_id || body.tenantId || c.req.header('X-Tenant-ID')) {
    return c.json({ error: 'Invalid tenant context' }, 400);
  }

  const widgetKey = body.widgetKey || c.req.header('X-Widget-Key') || c.req.query('key');
  if (!widgetKey || typeof widgetKey !== 'string' || !widgetKey.trim()) {
    return c.json({ error: 'Widget key required' }, 400);
  }

  const resolvers = createCustomerAuthResolvers(c.env, c.get('resourceOperationEmitter'));
  const tenantId = (await resolvers.widget.resolveTenantByKey(widgetKey.trim()))?.tenantId;
  if (!tenantId) {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'));

  if (localBetaEnabled(c.env)) {
    const generic=()=>c.json({success:true,...(parsedAuth.data.type==='otp'?{challengeId:crypto.randomUUID()}: {})});
    const user=await resolvers.identity.resolveCredentialsByEmail(parsedAuth.data.email.toLowerCase());
    if(!user || user.tenantId!==tenantId || user.role!=='customer' || !LOCAL_AUTH_CAPTURE_RECIPIENTS.includes(parsedAuth.data.email.toLowerCase()))return generic();
    try {await authorizeLocalBeta(c.env,scope,{kind:'customer',id:user.userId},c.get('resourceOperationEmitter'));}
    catch(error) {if(error instanceof BetaAdmissionError && error.code==='beta_not_invited')return generic();throw error;}
  }

  // Turnstile verification bound to resolved tenant
  try {
    const isValid = await verifyTurnstileToken(c.env, deps, body.turnstileToken, c.req.header('CF-Connecting-IP'));
    if (!isValid) {
      return c.json({ error: 'Turnstile validation failed or token missing' }, 400);
    }
  } catch (error: any) {
    if (error.message?.includes('APP_MASTER_KEY')) {
      return c.json({ error: "Server misconfiguration: APP_MASTER_KEY is missing." }, 500);
    }
    return c.json({ error: 'Internal server error during Turnstile validation' }, 500);
  }

  const authService = new CustomerAuthService(c.env, deps, c.env.emailTransport, resolvers.identity, c.env.localNow);

  try {
    const result = await authService.requestAuth(parsedAuth.data.email, parsedAuth.data.type);
    return c.json({ success: true, ...result });
  } catch (err: any) {
    if (err.message === 'Invalid tenant context') {
      return c.json({ error: 'Invalid tenant context' }, 400);
    }
    throw err;
  }
});

app.post('/auth/verify', rateLimiter(5, 60000), async (c) => {
  const body = await c.req.json();

  const widgetKey = body.widgetKey || c.req.header('X-Widget-Key') || c.req.query('key');
  if (!widgetKey || typeof widgetKey !== 'string' || !widgetKey.trim()) {
    return c.json({ error: 'Widget key required' }, 400);
  }

  const resolvers = createCustomerAuthResolvers(c.env, c.get('resourceOperationEmitter'));
  const tenantId = (await resolvers.widget.resolveTenantByKey(widgetKey.trim()))?.tenantId;
  if (!tenantId) {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env, undefined, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'));

  const authService = new CustomerAuthService(c.env, deps, undefined, undefined, c.env.localNow);
  if (typeof body.token !== 'string' || !body.token || body.token.length > 512) {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: 'Invalid token' }, 400);
  }
  if (body.challengeId !== undefined && typeof body.challengeId !== 'string') {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: 'Invalid challenge' }, 400);
  }
  let verification;
  try {
    verification = await authService.verifyAuthWithDecision(body.token, body.challengeId);
  } catch (error) {
    recordCredentialDecision(c, 'unavailable');
    throw error;
  }
  if (verification.decision === 'admission-suppressed') return c.json({ error: 'Invalid token' }, 401);
  if (verification.decision === 'denied') {
    recordCredentialDecision(c, 'denied');
    return c.json({ error: 'Invalid token' }, 401);
  }
  const result = verification.result;
  recordCredentialDecision(c, 'accepted');

  setCookie(c, 'lumina_customer_token', result.token, {
    httpOnly: true,
    secure: c.req.url.startsWith('https'),
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 // 7 days
  });

  return c.json(result);
});

app.post('/auth/logout', async (c, next) => {
  // Clear the browser cookie even if authentication or database revocation fails.
  deleteCookie(c, 'lumina_customer_token', { path: '/' });
  await next();
}, widgetAuthMiddleware, roleGuard(['customer']), async (c) => {
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  await deps.repositories.users.revokeSessions((c.get('jwtPayload') as any).sub);
  return c.json({ success: true });
});

app.get('/auth/me', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const user = await deps.repositories.users.get(payload.sub);
  return c.json({ user: user ? { id: user.id, email: user.email, full_name: user.full_name, role: user.role, tenant_id: user.tenant_id } : null });
});

// --- TICKET ROUTES ---

app.get('/tickets', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const tickets = await ticketService.findTickets({ page, limit, customerEmail: payload.email });
  return c.json(tickets);
});

app.post('/tickets', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, rateLimiter(3, 60000), async (c) => {
  const payload = c.get('jwtPayload');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admissionMode = customerTicketAdmissionMode(c.env);
  if (admissionMode === 'invalid') return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  try {
    const body = await readMutationJson(c);
    const key = readIdempotencyKey(c);
    const parsed = portalTicketCreateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
    const mutation = deps.ticketMutationReplay({
      kind: 'customer', id: payload.sub, sessionVersion: payload.session_version ?? 0, expiresAt: payload.exp ?? 0,
    });
    const prepared = await mutation.prepareMutation({ operation: 'portal.ticket.create', data: {
      subject: parsed.data.subject, body: parsed.data.message, custom_fields: parsed.data.custom_fields,
    } }, key);
    if (prepared.replay) {
      if (prepared.replay.keyed) c.header('Idempotency-Replayed', 'true');
      return c.json(prepared.replay.body, prepared.replay.status);
    }
    try {
      const valid = await verifyTurnstileToken(c.env, deps, parsed.data.turnstileToken, c.req.header('CF-Connecting-IP'));
      if (!valid) return c.json({ error: 'Turnstile validation failed or token missing' }, 400);
    } catch (error: any) {
      if (error.message?.includes('APP_MASTER_KEY')) return c.json({ error: 'Server misconfiguration: APP_MASTER_KEY is missing.' }, 500);
      return c.json({ error: 'Internal server error during Turnstile validation' }, 500);
    }
    if (admissionMode === 'enabled') {
      const rejection = await admitConfiguredCustomerTicketMutation(c, 'portal.ticket.create', mutation, prepared);
      if (rejection) return rejection;
    }
    const outcome = await mutation.commit(prepared);
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

app.get('/tickets/:id', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload');
  const ticketId = c.req.param('id')!;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admissionEnabled = c.env.BUDGET_ADMISSION_POLICY !== undefined && customerTicketAdmissionMode(c.env) === 'enabled';
  let query: { limit?: string; cursor?: string } = {};
  if (admissionEnabled) {
    try { query = articlePageQuery({ limit: c.req.query('article_limit'), cursor: c.req.query('article_cursor') }); }
    catch (error) {
      if (error instanceof ConversationReadError) return c.json({ code: error.code, error: error.message }, error.status);
      throw error;
    }
  }
  const admission = await admitHttpTicketRead({ env: c.env, deps, payload, operation: 'portal.ticket.detail', ticketId,
    page: query, now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return c.json(admission.reason === 'exhausted'
    ? { code: 'budget_exhausted', error: 'Configured budget capacity is exhausted' }
    : { code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, admission.reason === 'exhausted' ? 429 : 503);
  const ticketService = new TenantTicketService(deps);
  const ticket = await ticketService.findTicketById(ticketId);

  if (!ticket || ticket.customer_email !== payload.email) {
    return c.json({ error: 'Not found' }, 404);
  }

  const conversationRead = admission.status === 'admitted'
    ? deps.boundedConversationRead ?? new BoundedConversationReadRepository(deps.database, deps.scope)
    : deps.boundedConversationRead;
  if (conversationRead) {
    const page=await conversationRead.page(ticketId,{customerEmail:payload.email,limit:query.limit || c.req.query('article_limit'),cursor:query.cursor || c.req.query('article_cursor')});
    const articles = page.articles.map(({ attachments, ...article }) => {
      const bodyText = publicArticleBodyText(article);
      return {
        ...article,
        ...(bodyText === undefined ? {} : { body_text: bodyText }),
        attachments: attachments.map(a => ({
        id: a.id, filename: a.file_name, size: a.file_size,
        contentType: a.content_type, storageKey: a.r2_key,
      })),
      };
    });
    const response = {
      ticket, articles,
      canonical: await ticketService.projectAuditedConversation(ticket, page.articles),
      pagination: page.pagination,
    };
    assertConversationResponseBounds(response);
    return c.json(response);
  }

  // Exclude internal notes
  const articlesList = await ticketService.getTicketArticles(ticketId);
  const externalArticles = articlesList.filter(a => !a.is_internal);
  await ticketService.hydrateArticles(externalArticles);

  const articlesWithAttachments = await Promise.all(externalArticles.map(async (article) => {
    const atts = await ticketService.getArticleAttachments(article.id);
    const bodyText = publicArticleBodyText(article);
    return {
      response: {
        ...article,
        ...(bodyText === undefined ? {} : { body_text: bodyText }),
        attachments: atts.map(a => ({ id: a.id, filename: a.file_name, size: a.file_size, contentType: a.content_type, storageKey: a.r2_key })),
      },
      canonical: { ...article, attachments: atts },
    };
  }));

  return c.json({
    ticket,
    articles: articlesWithAttachments.map(article => article.response),
    canonical: await ticketService.projectAuditedConversation(
      ticket,
      articlesWithAttachments.map(article => article.canonical),
    ),
  });
});

/** Customer projection deliberately excludes operator labels and waiting facts. */
app.get('/tickets/:id/support-state', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Not found' }, 404);
  const ticket = await deps.repositories.tickets.get(id);
  if (!ticket || ticket.customer_email !== payload.email || (ticket.customer_id !== null && ticket.customer_id !== payload.sub)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const state = await deps.repositories.supportStates.getTicketState(ticket.id);
  if (!state) return c.json({ error: 'Not found' }, 404);
  return c.json(publicSupportState(state));
});

app.get('/tickets/:id/sla', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload');
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const id = c.req.param('id');
  const ticket = id ? await deps.repositories.tickets.get(id) : null;
  if (!ticket || ticket.customer_email !== payload.email || (ticket.customer_id !== null && ticket.customer_id !== payload.sub)) {
    return c.json({ error: 'Not found' }, 404);
  }
  try {
    const projection = await deps.repositories.slaClocks.getProjection(ticket.id);
    return projection ? c.json(projection) : c.json({ error: 'Not found' }, 404);
  } catch (error) {
    if (error instanceof SlaClockError && error.code === 'unavailable') return c.json({ error: error.message, code: 'sla_unavailable' }, 503);
    throw error;
  }
});

app.post('/tickets/:id/messages', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, rateLimiter(5, 60000), async (c) => {
  const payload = c.get('jwtPayload');
  const ticketId = c.req.param('id')!;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admissionMode = customerTicketAdmissionMode(c.env);
  if (admissionMode === 'invalid') return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  try {
    const body = await readMutationJson(c);
    const key = readIdempotencyKey(c);
    const parsed = portalTicketReplySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
    const attachments = normalizeAttachmentReferences(parsed.data.attachments);
    const mutation = deps.ticketMutationReplay({
      kind: 'customer', id: payload.sub, sessionVersion: payload.session_version ?? 0, expiresAt: payload.exp ?? 0,
    });
    // prepare reauthorizes current ownership before it can return a saved response.
    const prepared = await mutation.prepareMutation({ operation: 'portal.ticket.reply', ticketId, data: {
      body: parsed.data.message, attachments,
    } }, key);
    if (prepared.replay) {
      if (prepared.replay.keyed) c.header('Idempotency-Replayed', 'true');
      return c.json(prepared.replay.body, prepared.replay.status);
    }
    if (admissionMode === 'enabled') {
      const rejection = await admitConfiguredCustomerTicketMutation(c, 'portal.ticket.reply', mutation, prepared);
      if (rejection) return rejection;
    }
    let verifiedAttachments;
    try {
      verifiedAttachments = await validateAttachmentReferences(deps, `customer-attachments/${payload.sub}/`, attachments);
    } catch {
      return c.json({ error: 'Invalid attachment reference' }, 400);
    }
    const outcome = await mutation.commit(prepared, verifiedAttachments);
    if (!outcome.replayed) {
      try {
        await new BroadcastService(c.env, deps.scope, deps.emitResourceOperation).broadcast('article.created', {
          ticketId: outcome.ticketId, articleId: outcome.articleId, senderType: 'customer', isInternal: false,
        });
      } catch {
        // The committed response remains successful; refreshing the ticket recovers missed events.
        console.warn('Portal reply notification failed after commit');
      }
    }
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

// --- ATTACHMENT ROUTES ---
app.get('/attachments/:id/download', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const attachmentId = c.req.param('id');
  const payload = c.get('jwtPayload');

  if (!attachmentId) return c.json({ error: 'Missing attachment ID' }, 400);
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const attachment = await deps.repositories.attachments.getAttachmentWithMeta(attachmentId);
  if (!attachment || attachment.is_internal || attachment.customer_email !== payload.email) {
    return c.json({ error: 'Not found or unauthorized' }, 404);
  }
  const digest = await storageDigest(['customer-attachment-download-v1', deps.scope.tenantId, payload.sub, attachmentId, crypto.randomUUID()]);
  const admission = await admitCustomerAttachment({ env: c.env, deps, payload, operation: 'customer.attachment.download',
    operationId: `storage-download:${digest}`, operationFingerprint: `storage-download:${digest}`, now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return attachmentBudgetFailure(c, admission.reason!);
  const r2Object = await deps.attachmentStorage.getAttachment(attachment.r2_key);
  if (!r2Object) return c.json({ error: 'File not found in storage' }, 404);

  const headers = new Headers();
  if (r2Object.writeHttpMetadata) {
    r2Object.writeHttpMetadata(headers);
  } else if (r2Object.httpMetadata?.contentType) {
    headers.set('Content-Type', r2Object.httpMetadata.contentType);
  }
  const safeFileName = (attachment.file_name || 'attachment').replace(/^.*[\\/]/, '').replace(/[\r\n"]/g, '_');
  headers.set('Content-Disposition', `attachment; filename="${safeFileName}"`);
  return new Response(r2Object.body, { headers });
});


app.post('/attachments/upload', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload') as any;
  const deps = c.get('tenantDeps') as TenantRequestDeps;

  // Early payload size check via Content-Length (10MB + slight overhead for multipart boundaries)
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > MAX_FILE_SIZE + 50000) {
    return c.json({ error: 'Payload too large. File must be under 10MB' }, 413);
  }

  const body = await c.req.parseBody(c.env.LOCAL_BETA_ENABLED==='true'?{all:true}:{});
  const file = body['file'] as File;

  if (c.env.LOCAL_BETA_ENABLED==='true' && (Array.isArray(file) || typeof file==='string')) return c.json({error:'A single file is required'},400);
  if (!file) {
    return c.json({ error: 'File is required' }, 400);
  }

  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'];
  if (!allowedMimeTypes.includes(file.type)) {
    return c.json({ error: 'Unsupported media type' }, 415);
  }

  // Double-check actual file size after parsing
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: 'File exceeds maximum allowed size of 10MB' }, 413);
  }

  if (c.env.LOCAL_BETA_ENABLED==='true' && (!file.name?.trim() || file.name.length>255)) return c.json({error:'Invalid attachment filename'},400);
  const fileName = file.name || '';
  const lastDotIndex = fileName.lastIndexOf('.');
  const hasExtension = lastDotIndex !== -1 && lastDotIndex < fileName.length - 1;
  const rawExt = hasExtension ? fileName.substring(lastDotIndex + 1) : '';
  const fileExt = rawExt.replace(/[^a-zA-Z0-9]/g, '');
  const extPart = fileExt ? `.${fileExt}` : '';

  const requestedIdempotency = c.req.header('idempotency-key');
  const idempotencyKey = boundedStorageIdempotencyKey(requestedIdempotency);
  if (requestedIdempotency !== undefined && !idempotencyKey) return c.json({ error: 'Invalid Idempotency-Key' }, 400);
  const uploadSeed = idempotencyKey ?? crypto.randomUUID();
  const digest = await storageDigest(['customer-attachment-upload-v1', deps.scope.tenantId, payload.sub, uploadSeed]);
  // Parsing is already capped at ten MiB. Bind durable retry identity to the
  // exact content before the budget spend so a same-size replacement conflicts.
  const fileBytes = await file.arrayBuffer();
  const byteDigest = await storageByteDigest(fileBytes);
  const fingerprint = await storageDigest(['customer-attachment-upload-content-v2', file.name, file.type, String(file.size), byteDigest]);
  const key = idempotencyKey ? `customer-attachments/${payload.sub}/${digest}` : `customer-attachments/${payload.sub}/${digest}${extPart}`;
  const admission = await admitCustomerAttachment({ env: c.env, deps, payload, operation: 'customer.attachment.upload',
    operationId: `storage-upload:${digest}`, operationFingerprint: `storage-upload:${fingerprint}`, bytes: file.size,
    now: () => c.env.localNow?.() ?? Date.now() });
  if (admission.status === 'rejected') return attachmentBudgetFailure(c, admission.reason!);

  try {
    await deps.attachmentStorage.prepareUploadAttempt();
    if (idempotencyKey) {
      const existing = await deps.attachmentStorage.getAttachment(key);
      if (existing) {
        try {
          if ((existing.customMetadata as Record<string, string> | undefined)?.tocynUploadFingerprint !== fingerprint) {
            return c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409);
          }
        } finally { await existing.body?.cancel(); }
        return c.json({ key });
      }
    }
    try {
      const put = await deps.attachmentStorage.putAttachment(key, c.env.LOCAL_BETA_ENABLED==='true' ? fileBytes : file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' }, customMetadata: { tocynUploadFingerprint: fingerprint },
        onlyIf: { etagDoesNotMatch: '*' },
      });
      if (put.res !== null) return c.json({ key });
    } catch (error) {
      if (error instanceof BetaAdmissionError) throw error;
      const winner = await deps.attachmentStorage.getAttachment(key);
      if (winner) {
        try {
          if ((winner.customMetadata as Record<string, string> | undefined)?.tocynUploadFingerprint === fingerprint) return c.json({ key });
        } finally { await winner.body?.cancel(); }
        return c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409);
      }
      throw error;
    }
    const winner = await deps.attachmentStorage.getAttachment(key);
    if (winner) {
      try {
        if ((winner.customMetadata as Record<string, string> | undefined)?.tocynUploadFingerprint === fingerprint) return c.json({ key });
      } finally { await winner.body?.cancel(); }
      return c.json({ error: 'Idempotency-Key conflicts with a different upload' }, 409);
    }
    return c.json({ error: 'Failed to upload file to storage' }, 500);
  } catch (error: any) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error('Error uploading file:', error);
    return c.json({ error: 'Failed to upload file' }, 500);
  }
});

app.get('/tickets/:id/history', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, c => conversationHistory(c,'customer'));

export default app;
