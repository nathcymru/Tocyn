import { z } from 'zod';
import { validateAttachmentReferences } from '../services/attachment-references';
import { requestBounds } from '../middleware/request-bounds';
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Env } from "../bindings";
import { AppVariables, Article } from "../types";
import { CustomerAuthService } from "../services/customer-auth.service";
import { TenantTicketService } from "../services/tenant-ticket.service";
import { tenantMiddleware, TenantRequestDeps, createTenantRequestDeps, createCustomerAuthResolvers } from "../middleware/tenant.middleware";
import { createVerifiedTenantScope } from "../auth/scope";
import { BroadcastService } from "../services/broadcast.service";
import { widgetAuthMiddleware } from "../middleware/widget-auth.middleware";
import { roleGuard } from "../middleware/role.guard";
import { rateLimiter } from "../middleware/rate-limiter";
import { decryptString } from "../utils/crypto";
import { verifyTurnstileToken } from "../utils/turnstile";
import { TicketMutationError } from '../services/ticket-mutation-replay.service';
import { MutationInputError, mutationInputErrorBody, normalizeAttachmentReferences, portalTicketCreateSchema, portalTicketReplySchema, readIdempotencyKey, readMutationJson } from './mutation-request';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', async (c, next) => requestBounds(c.req.path.endsWith('/attachments/upload') ? 10 * 1024 * 1024 + 50000 : 64 * 1024)(c, next));

// --- PUBLIC CONFIG ROUTE ---
app.get('/config', async (c) => {
  if (c.req.header('X-Tenant-ID') || c.req.query('tenant_id') || c.req.query('tenantId')) {
    return c.json({ error: 'Invalid tenant context' }, 400);
  }
  const widgetKey = c.req.header('X-Widget-Key') || c.req.query('key');
  if (!widgetKey?.trim()) return c.json({ error: 'Widget key required' }, 400);
  const tenantId = (await createCustomerAuthResolvers(c.env).widget.resolveTenantByKey(widgetKey.trim()))?.tenantId;
  if (!tenantId) return c.json({ error: 'Widget configuration not found' }, 404);
  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env);
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

  const resolvers = createCustomerAuthResolvers(c.env);
  const tenantId = (await resolvers.widget.resolveTenantByKey(widgetKey.trim()))?.tenantId;
  if (!tenantId) {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env);

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

  const authService = new CustomerAuthService(c.env, deps, c.env.emailTransport, resolvers.identity);

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

  const resolvers = createCustomerAuthResolvers(c.env);
  const tenantId = (await resolvers.widget.resolveTenantByKey(widgetKey.trim()))?.tenantId;
  if (!tenantId) {
    return c.json({ error: 'Widget configuration not found' }, 404);
  }

  const scope = createVerifiedTenantScope(tenantId, 'widget-anonymous', ['customer'], 1);
  const deps = createTenantRequestDeps(scope, c.env);

  const authService = new CustomerAuthService(c.env, deps);
  if (typeof body.token !== 'string' || !body.token || body.token.length > 512) return c.json({ error: 'Invalid token' }, 400);
  if (body.challengeId !== undefined && typeof body.challengeId !== 'string') return c.json({ error: 'Invalid challenge' }, 400);
  const result = await authService.verifyAuth(body.token, body.challengeId);
  if (!result) return c.json({ error: 'Invalid token' }, 401);

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
    const outcome = await mutation.commit(prepared);
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body, outcome.status);
  } catch (error) {
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

app.get('/tickets/:id', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const payload = c.get('jwtPayload');
  const ticketId = c.req.param('id')!;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);
  const ticket = await ticketService.findTicketById(ticketId);

  if (!ticket || ticket.customer_email !== payload.email) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Exclude internal notes
  const articlesList = await ticketService.getTicketArticles(ticketId);
  const externalArticles = articlesList.filter(a => !a.is_internal);
  await ticketService.hydrateArticles(externalArticles);

  const articlesWithAttachments = await Promise.all(externalArticles.map(async (article) => {
    const atts = await ticketService.getArticleAttachments(article.id);
    return {
      response: {
        ...article,
        attachments: atts.map(a => ({ id: a.id, filename: a.file_name, size: a.file_size, contentType: a.content_type, storageKey: a.r2_key })),
      },
      canonical: { ...article, attachments: atts },
    };
  }));

  return c.json({
    ticket,
    articles: articlesWithAttachments.map(article => article.response),
    canonical: ticketService.projectCanonicalConversation(
      ticket,
      articlesWithAttachments.map(article => article.canonical),
    ),
  });
});

app.post('/tickets/:id/messages', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, rateLimiter(5, 60000), async (c) => {
  const payload = c.get('jwtPayload');
  const ticketId = c.req.param('id')!;
  const deps = c.get('tenantDeps') as TenantRequestDeps;
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
    let verifiedAttachments;
    try {
      verifiedAttachments = await validateAttachmentReferences(deps, `customer-attachments/${payload.sub}/`, attachments);
    } catch {
      return c.json({ error: 'Invalid attachment reference' }, 400);
    }
    const outcome = await mutation.commit(prepared, verifiedAttachments);
    if (!outcome.replayed) {
      try {
        await new BroadcastService(c.env, deps.scope).broadcast('article.created', {
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
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

// --- ATTACHMENT ROUTES ---
app.get('/attachments/:id/download', widgetAuthMiddleware, roleGuard(['customer']), tenantMiddleware, async (c) => {
  const attachmentId = c.req.param('id');
  const payload = c.get('jwtPayload');

  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const attachment = await deps.repositories.attachments.getAttachmentWithMeta(attachmentId!);
  if (!attachment || attachment.is_internal || attachment.customer_email !== payload.email) {
    return c.json({ error: 'Not found or unauthorized' }, 404);
  }
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

  const body = await c.req.parseBody();
  const file = body['file'] as File;

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

  const fileName = file.name || '';
  const lastDotIndex = fileName.lastIndexOf('.');
  const hasExtension = lastDotIndex !== -1 && lastDotIndex < fileName.length - 1;
  const rawExt = hasExtension ? fileName.substring(lastDotIndex + 1) : '';
  const fileExt = rawExt.replace(/[^a-zA-Z0-9]/g, '');
  const extPart = fileExt ? `.${fileExt}` : '';

  const key = `customer-attachments/${payload.sub}/${crypto.randomUUID()}${extPart}`;

  try {
    await deps.attachmentStorage.putAttachment(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });
    return c.json({ key });
  } catch (error: any) {
    console.error('Error uploading file:', error);
    return c.json({ error: 'Failed to upload file' }, 500);
  }
});

export default app;
