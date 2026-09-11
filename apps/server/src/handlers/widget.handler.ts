import { tenantRateLimit } from '../middleware/tenant-rate-limit';
import { Hono } from 'hono';
import { Env } from '../bindings';
import { AiService, StatelessAiService } from '../services/ai.service';
import { WidgetKnowledgeReader } from '../services/tenant-knowledge.service';
import { widgetAuthMiddleware, widgetTenantMiddleware } from '../middleware/widget-auth.middleware';
import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { rateLimiter } from '../middleware/rate-limiter';
import { AppVariables } from '../types';
import { z } from 'zod';
import { requestBounds } from '../middleware/request-bounds';
import { BetaAdmissionError } from '../types/local-beta';
import { TicketMutationError } from '../services/ticket-mutation-replay.service';
import { MutationInputError, mutationInputErrorBody, readIdempotencyKey, readMutationJson } from './mutation-request';
import { admitConfiguredCustomerTicketMutation, customerTicketAdmissionMode } from '../middleware/budget-admission.middleware';
import { admitHttpAi } from '../budgets/http-ai-admission.service';
import { MAX_WIDGET_CONTEXT_BYTES, MAX_WIDGET_HISTORY_BYTES, MAX_WIDGET_MESSAGE_BYTES, boundRecentHistory, boundUntrustedAiText, truncateUtf8 } from '../services/ai-input-bounds';

const widgetAiFallback = "I'm having trouble connecting to my brain. Please try again later.";

const widget = new Hono<{ Bindings: Env; Variables: AppVariables }>();
widget.use('*', requestBounds(64 * 1024));

// Embeds authenticate explicitly with a customer bearer token, without ambient cookies.
widget.get('/session', widgetAuthMiddleware, (c) => c.json({ user: { email: c.get('jwtPayload')!.email } }));

// Fetch widget configuration
widget.get('/config', widgetTenantMiddleware, async (c) => {
  const d = c.get('tenantDeps') as TenantRequestDeps;

  const config: Record<string, any> = {
    primaryColor: '#3b82f6',
    title: 'Support',
    welcomeMessage: "Hello! I'm here to help you. What's on your mind?",
    features: {
      aiChat: true,
      ticketForm: true,
    }
  };

  const widgetKeys = ['widget.primaryColor', 'widget.title', 'widget.welcomeMessage', 'widget.features.aiChat', 'widget.features.ticketForm'];
  const widgetValues = await Promise.all(widgetKeys.map(k => d.repositories.config.get(k)));
  for (const [index, k] of widgetKeys.entries()) {
    const val = widgetValues[index];
    if (val !== null) {
      const key = k.replace('widget.', '');
      if (key.includes('.')) {
        const parts = key.split('.');
        let current = config;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = val;
      } else {
        config[key] = val;
      }
    }
  }

  const portalBase = await d.repositories.config.get('PORTAL_URL') || c.env.PORTAL_URL;
  if (portalBase) {
    try {
      const portal = new URL('/login', portalBase);
      if (portal.protocol === 'https:' || (portal.protocol === 'http:' && portal.hostname === 'localhost')) {
        portal.searchParams.set('key', c.req.query('key') || c.req.header('X-Widget-Key') || '');
        config.portalUrl = portal.toString();
      }
    } catch { /* Invalid portal configuration never becomes a public link. */ }
  }
  return c.json(config);
});

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(8000),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(8000)
    })
  ).max(20).optional().default([]),
  category_id: z.string().optional(),
});

// AI Chat endpoint
widget.post('/chat', rateLimiter(5, 60000), widgetAuthMiddleware, tenantRateLimit('widget-chat', 5, 60000), async (c) => {
  const body = await c.req.json();
  const result = chatSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', details: result.error.flatten().fieldErrors }, 400);
  }

  const { message, history, category_id } = result.data;

  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admission = await admitHttpAi({ env: c.env, deps, payload: c.get('jwtPayload'), operation: 'widget.chat',
    now: () => c.env.localNow?.() ?? Date.now() });
  // Disabled and denied AI are intentionally indistinguishable to the embed:
  // neither path may expose allocation state or start retrieval/provider work.
  if (admission.status !== 'admitted') return c.json({ response: widgetAiFallback });
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const reader = new WidgetKnowledgeReader(deps, aiService);
  try {
    const contextResults = await reader.search(message, 3, category_id);
    const context = truncateUtf8(contextResults.map(r => r.content).join('\n\n'), MAX_WIDGET_CONTEXT_BYTES);
    const response = await aiService.generateResponse(
      boundUntrustedAiText(message, MAX_WIDGET_MESSAGE_BYTES), context, boundRecentHistory(history || [], MAX_WIDGET_HISTORY_BYTES),
    );
    return c.json({ response });
  } catch {
    // Admission already charged this bounded attempt. Do not retry embedding or
    // retrieval after a provider failure; return the same manual fallback.
    return c.json({ response: widgetAiFallback });
  }
});

const createWidgetTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(300),
  email: z.string().email("Invalid email address"),
  message: z.string().min(1, "Message is required").max(16000),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  metadata: z.never().optional(), // Context metadata has no supported persistence contract.
});

// Ticket Submission endpoint
widget.post('/tickets', rateLimiter(3, 300000), widgetAuthMiddleware, tenantRateLimit('widget-ticket', 3, 300000), async (c) => {
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const admissionMode = customerTicketAdmissionMode(c.env);
  if (admissionMode === 'invalid') return c.json({ code: 'budget_admission_unavailable', error: 'Budget admission authority is unavailable' }, 503);
  try {
    const body = await readMutationJson(c);
    const parsed = createWidgetTicketSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
    const payload = c.get('jwtPayload');
    if (parsed.data.email.trim().toLowerCase() !== c.get('user').email.trim().toLowerCase()) {
      return c.json({ error: 'Email must match the authenticated customer' }, 400);
    }
    const mutation = deps.ticketMutationReplay({ kind: 'customer', id: payload.sub, sessionVersion: payload.session_version ?? 0, expiresAt: payload.exp ?? 0 });
    const prepared = await mutation.prepareMutation({ operation: 'portal.ticket.create', source: 'widget', data: {
      subject: parsed.data.subject, body: parsed.data.message, custom_fields: parsed.data.custom_fields,
    } }, readIdempotencyKey(c));
    if (prepared.replay) {
      if (prepared.replay.keyed) c.header('Idempotency-Replayed', 'true');
      return c.json(prepared.replay.body.ticket, prepared.replay.status);
    }
    if (admissionMode === 'enabled') {
      const rejection = await admitConfiguredCustomerTicketMutation(c, 'portal.ticket.create', mutation, prepared, outcome => outcome.body.ticket);
      if (rejection) return rejection;
    }
    const outcome = await mutation.commit(prepared);
    if (outcome.keyed) c.header('Idempotency-Replayed', String(outcome.replayed));
    return c.json(outcome.body.ticket, outcome.status);
  } catch (error) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof MutationInputError) return c.json(mutationInputErrorBody(error), error.status);
    if (error instanceof TicketMutationError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
});

export default widget;
