import { Hono } from "hono";
import { z } from "zod";
import { Env } from "../bindings";
import { apiAuthMiddleware } from "../middleware/api-auth.middleware";
import { rateLimiter } from "../middleware/rate-limiter";
import { AppVariables } from "../types";
import { TenantRequestDeps } from "../middleware/tenant.middleware";
import { TenantTicketService } from "../services/tenant-ticket.service";

const createTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  customer_email: z.string().email("Invalid email address"),
  body: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z.enum(["open", "pending", "resolved", "closed"]).default("open"),
  group_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

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

/**
 * POST /api/v1/tickets
 * Create a new ticket via the external API.
 */
v1.post("/tickets", rateLimiter(10, 60000), async (c) => {
  const resolution = c.get('apiKeyResolution');
  if (resolution && !resolution.permissions.includes('tickets:write')) {
    return c.json({ error: "Forbidden: API key lacks required permission" }, 403);
  }

  const body = await c.req.json();
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);

  const result = createTicketSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);
  }
  const validData = result.data;

  try {
    const ticketData = {
      subject: validData.subject,
      customer_email: validData.customer_email,
      priority: validData.priority,
      assigned_to: validData.assigned_to,
      group_id: validData.group_id,
      custom_fields: validData.custom_fields,
      status: validData.status,
      source: 'api' as const,
    };
    const created = validData.body?.trim()
      ? await ticketService.createTicketWithArticle({
        ...ticketData,
        body: validData.body,
        sender_type: 'customer',
      })
      : { ticket: await ticketService.createTicket(ticketData), article: null };

    return c.json({
      ...created.ticket,
      canonical: ticketService.projectCanonicalConversation(
        created.ticket,
        created.article ? [created.article] : [],
      ),
    }, 201);
  } catch (error) {
    console.error("API Create Ticket Error:", error);
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
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);

  const ticket = await deps.repositories.tickets.get(id);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  const articles = (await deps.repositories.articles.listByTicket(id)).filter(article => !article.is_internal);
  const canonicalArticles = await Promise.all(articles.map(async article => ({
    ...article,
    attachments: await ticketService.getArticleAttachments(article.id),
  })));

  return c.json({
    ...ticket,
    articles,
    canonical: ticketService.projectCanonicalConversation(ticket, canonicalArticles),
  });
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
  const body = await c.req.json();
  const deps = c.get('tenantDeps') as TenantRequestDeps;
  const ticketService = new TenantTicketService(deps);

  if (!body.body) {
    return c.json({ error: "Missing required field: body" }, 400);
  }

  const ticket = await deps.repositories.tickets.get(id);
  if (!ticket) {
    return c.json({ error: "Ticket not found" }, 404);
  }

  try {
    const article = await ticketService.createArticle({
      ticket_id: id,
      body: body.body,
      sender_type: body.sender_type || 'customer',
      is_internal: body.is_internal || false,
      intake_source: 'api',
    });

    await deps.repositories.tickets.touch(id);

    return c.json(article, 201);
  } catch (error) {
    console.error("API Add Article Error:", error);
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
  const body = await c.req.json();
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

  const updateData: Record<string, any> = {};
  for (const [key, value] of Object.entries(validData)) {
    if (value !== undefined) {
      if (key === 'custom_fields') {
        updateData[key] = value ? JSON.stringify(value) : null;
      } else {
        updateData[key] = value;
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    return c.json({ error: "No valid updates provided" }, 400);
  }

  try {
    await deps.repositories.tickets.update(id, updateData);
    await deps.repositories.tickets.touch(id);
    const updatedTicket = await deps.repositories.tickets.get(id);
    return c.json(updatedTicket);
  } catch (error) {
    console.error("API Update Ticket Error:", error);
    return c.json({ error: "Failed to update ticket" }, 500);
  }
});

export default v1;
