import { BetaAdmissionError } from '../types/local-beta';
import { assertConversationResponseBounds } from '../services/conversation-read-bounds';
import { conversationHistory } from './conversation-history';
import { validateAttachmentReferences } from '../services/attachment-references';
import { EmailService } from '../services/email/outbound.service';
import { BroadcastService } from '../services/broadcast.service';
import { Hono } from "hono";
import { z } from "zod";
import { Env } from "../bindings";
import { authMiddleware } from "../middleware/auth.middleware";
import { mfaGuard } from "../middleware/mfa.guard";
import { roleGuard } from "../middleware/role.guard";
import { permissionGuard, permissionWriteFence, revalidatePermission } from "../middleware/permission.guard";
import { rateLimiter } from "../middleware/rate-limiter";
import { tenantMiddleware, TenantRequestDeps } from "../middleware/tenant.middleware";
import { JWTPayload, AppVariables } from "../types";
import { TenantTicketService } from "../services/tenant-ticket.service";

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

function displayUser(user: {id:string;full_name?:string|null;email:string;role:string}|null) {
  return user ? {id:user.id,full_name:user.full_name??null,email:user.email,role:user.role} : null;
}

const dashboard = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Apply auth, MFA, role-based access control, and tenant scoping to all dashboard routes
dashboard.use("*", authMiddleware, mfaGuard, roleGuard(["agent", "admin"]), tenantMiddleware);

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
dashboard.post("/tickets", async (c) => {
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
  const result = await d.repositories.tickets.list({
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
 * POST /api/tickets/:id/articles
 * Add a new article (agent response or internal note) to a ticket
 */
dashboard.post("/tickets/:id/articles", rateLimiter(10, 60000), async (c) => {
  const ticketId = c.req.param("id");
  if (!ticketId) return c.json({ error: 'Missing ID' }, 400);
  const payloadBody = await c.req.json();
  if (c.env.LOCAL_BETA_ENABLED === 'true') {
    const boundedReply = z.object({
      body: z.string().min(1).max(16000),
      is_internal: z.boolean().optional(),
      attachments: z.array(z.unknown()).max(10).optional(),
    });
    if (!boundedReply.safeParse(payloadBody).success) return c.json({ error: 'Invalid bounded reply' }, 400);
  }
  const { body: articleBody, is_internal, attachments: bodyAttachments } = payloadBody;
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
    ticketId,articleBody,Boolean(is_internal),{kind:'staff',id:agent.sub,source:'dashboard'},verifiedAttachments);
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
dashboard.patch("/tickets/:id", async (c) => {
  const id = c.req.param("id");
  const payload = await c.req.json();
  const agent = c.get("jwtPayload") as JWTPayload;
  const d = c.get('tenantDeps') as TenantRequestDeps;

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

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
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

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Unsupported file type. Please upload images, PDFs, or text files.' }, 415);
  }

  if(c.env.LOCAL_BETA_ENABLED==='true' && (!file.name.trim() || file.name.length>255))return c.json({error:'Invalid attachment filename'},400);
  const fileExt = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '');
  const extPart = fileExt ? `.${fileExt}` : '';
  const logicalKey = `agent-attachments/${payload.sub}/${crypto.randomUUID()}${extPart}`;

  try {
    await d.attachmentStorage.putAttachment(logicalKey, c.env.LOCAL_BETA_ENABLED==='true' ? await file.arrayBuffer() : file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    return c.json({ key: logicalKey });
  } catch (error: any) {
    if (error instanceof BetaAdmissionError) return c.json({ code: error.code, error: error.message }, error.status);
    if (c.env.LOCAL_BETA_ENABLED!=='true') console.error('Error uploading file:', error);
    return c.json({ error: 'Failed to upload file to storage' }, 500);
  }
});

dashboard.get('/tickets/:id/history', c => conversationHistory(c,'staff'));

export default dashboard;
