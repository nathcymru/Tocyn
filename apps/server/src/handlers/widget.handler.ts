import { tenantRateLimit } from '../middleware/tenant-rate-limit';
import { Hono } from 'hono';
import { Env } from '../bindings';
import { AiService, StatelessAiService } from '../services/ai.service';
import { WidgetKnowledgeReader } from '../services/tenant-knowledge.service';
import { widgetAuthMiddleware, widgetTenantMiddleware } from '../middleware/widget-auth.middleware';
import { TenantRequestDeps } from '../middleware/tenant.middleware';
import { TenantTicketService } from '../services/tenant-ticket.service';
import { rateLimiter } from '../middleware/rate-limiter';
import { AppVariables } from '../types';
import { z } from 'zod';
import { requestBounds } from '../middleware/request-bounds';

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
  const aiService = new StatelessAiService(c.env.AI, deps.emitResourceOperation);
  const reader = new WidgetKnowledgeReader(deps, aiService);

  const contextResults = await reader.search(message, 3, category_id);
  const context = contextResults.map(r => r.content).join('\n\n');

  const response = await aiService.generateResponse(message, context, history || []);

  return c.json({ response });
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
  const body = await c.req.json();
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);

  const result = createWidgetTicketSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);
  }
  const validData = result.data;
  if (validData.email.trim().toLowerCase() !== c.get('user').email.trim().toLowerCase()) {
    return c.json({ error: "Email must match the authenticated customer" }, 400);
  }

  try {
    const { ticket } = await ticketService.createTicketWithArticle({
      subject: validData.subject,
      customer_email: c.get('user').email,
      source: 'widget',
      custom_fields: validData.custom_fields,
      body: validData.message,
      sender_type: 'customer',
      sender_id: c.get('user').id,
      customer_id: c.get('user').id,
    }, {kind:'customer',id:c.get('user').id,source:'widget'});

    return c.json(ticket, 201);
  } catch (error) {
    console.error("Widget Create Ticket Error:", error);
    return c.json({ error: "Failed to create ticket" }, 500);
  }
});

export default widget;
