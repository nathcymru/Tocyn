import { VectorizeWorkflow } from './workflows/vectorize.workflow';
import { Hono } from 'hono';
import { apiCors } from './middleware/cors-policy';
import { Env } from './bindings';
import { EmailHandler } from './handlers/email.handler';
import { InboundEmailService } from './services/email/inbound.service';
import { runScheduledRetention } from './auth/automation-composition';
import auth from './handlers/auth.handler';
import dashboard from './handlers/dashboard.handler';
import knowledge from './handlers/knowledge.handler';
import settings from './handlers/settings.handler';
import channels from './handlers/channels.handler';
import permissions from './handlers/permissions.handler';
import v1 from './handlers/v1.handler';
import widget from './handlers/widget.handler';
import customerHandler from './handlers/customer.handler';
import { AuthService } from './services/auth/auth.service';
import { NotificationDO } from './durable_objects/NotificationDO';
import { rateLimiter } from './middleware/rate-limiter';
import { AppVariables } from './types';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Real-time WebSocket connection
app.get('/api/realtime', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected Upgrade: websocket' }, 426);
  }

  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  let user = null;
  try {
    const authService = new AuthService(c.env);
    user = await authService.verifyToken(token); // Verify auth before passing to DO
    if (!user || !['agent', 'admin'].includes(user.role)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } catch (err) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Construct a new Request and inject trusted headers
  const internalUrl = new URL(c.req.raw.url);
  internalUrl.search = '';
  const newReq = new Request(internalUrl, c.req.raw);
  newReq.headers.set('X-User-ID', user.id);
  newReq.headers.set('X-Tenant-ID', user.tenant_id!);
  newReq.headers.set('X-Session-Version', String(user.session_version));
  newReq.headers.set('X-Session-Expiry', String((user as any).session_expires_at));
  newReq.headers.set('X-Session-Role', user.role);
  newReq.headers.set('X-User-Name', user.full_name || user.email);

  const id = c.env.NOTIFICATION_DO.idFromName(`tenant:${user.tenant_id}`);
  const obj = c.env.NOTIFICATION_DO.get(id);
  return obj.fetch(newReq);
});

// Credentialed browser access is limited to configured application origins.
app.use('/api/*', apiCors);

// Health check
app.get('/health', (c) => c.text('OK'));

// Test endpoint for simulating inbound emails removed for security reasons in production.


// API Routes
app.route('/api/auth', auth);
app.route('/api/permissions', permissions);
app.route('/api/knowledge', knowledge);
app.route('/api/settings', settings);
app.route('/api/channels', channels);
app.route('/api/v1/customer', customerHandler);
app.route('/api/v1/widget', widget);
app.route('/api/v1', v1);
app.route('/api', dashboard);

export { NotificationDO, VectorizeWorkflow };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const handler = new EmailHandler(env);
    await handler.handleEmail(message, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const result = await runScheduledRetention(env);
    console.log(`Retention run complete: ${result.deleted_tickets} tickets deleted, ${result.deleted_attachments} attachments deleted.`);
  },
};
