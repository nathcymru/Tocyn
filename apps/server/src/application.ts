import { BetaAdmissionError } from './types/local-beta';
import { ConversationReadError } from './services/conversation-read-bounds';
import { CapabilityFenceError } from './auth/capability-policy';
import { Hono } from 'hono';
import { localBetaGuard } from './middleware/local-beta';
import { authenticateRealtimeToken } from './middleware/auth.middleware';
import { apiCors } from './middleware/cors-policy';
import { Env } from './bindings';
import auth from './handlers/auth.handler';
import dashboard from './handlers/dashboard.handler';
import knowledge from './handlers/knowledge.handler';
import settings from './handlers/settings.handler';
import channels from './handlers/channels.handler';
import permissions from './handlers/permissions.handler';
import v1 from './handlers/v1.handler';
import widget from './handlers/widget.handler';
import customerHandler from './handlers/customer.handler';
import { environmentGuard } from './middleware/environment-guard';
import { operationalObservability } from './middleware/operational-observability';
import { measureResourceOperation } from './observability/resource-operation';
import { AppVariables } from './types';

export const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.onError((error,c) => {
  if (error instanceof BetaAdmissionError || error instanceof ConversationReadError) return c.json({code:error.code,error:error.message},error.status);
  if (error instanceof CapabilityFenceError) return c.json({ error: 'Forbidden', message: error.message }, 403);
  if (c.env.LOCAL_BETA_ENABLED === 'true') return c.json({error:'Local beta request failed',code:'beta_request_failed'},500);
  console.error(error);
  return c.text('Internal Server Error',500);
});
app.use('*', environmentGuard);
app.use('*', operationalObservability);
app.use('*', localBetaGuard);

app.get('/api/realtime', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') return c.json({ error: 'Expected Upgrade: websocket' }, 426);
  const token = c.req.query('token');
  if (!token) {
    try { c.get('requestAuthSli')?.record('denied'); } catch { /* Evidence cannot affect authentication. */ }
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = await authenticateRealtimeToken(c.env, token, decision => c.get('requestAuthSli')?.record(decision), c.get('resourceOperationEmitter'));
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const internalUrl = new URL(c.req.raw.url); internalUrl.search = '';
  const newReq = new Request(internalUrl, c.req.raw);
  newReq.headers.set('X-User-ID', user.id);
  newReq.headers.set('X-Tenant-ID', user.tenant_id!);
  newReq.headers.set('X-Session-Version', String(user.session_version));
  newReq.headers.set('X-Session-Expiry', String((user as any).session_expires_at));
  newReq.headers.set('X-Session-Role', user.role);
  newReq.headers.set('X-User-Name', user.full_name || user.email);
  const id = c.env.NOTIFICATION_DO.idFromName(`tenant:${user.tenant_id}`);
  return measureResourceOperation({
    resource: 'durable_object', operation: 'invoke', emit: c.get('resourceOperationEmitter'),
    execute: () => c.env.NOTIFICATION_DO.get(id).fetch(newReq),
    isFailureResult: response => response.status >= 500,
  });
});

app.use('/api/*', apiCors);
app.get('/health', c => c.text('OK'));
app.route('/api/auth', auth);
app.route('/api/permissions', permissions);
app.route('/api/knowledge', knowledge);
app.route('/api/settings', settings);
app.route('/api/channels', channels);
app.route('/api/v1/customer', customerHandler);
app.route('/api/v1/widget', widget);
app.route('/api/v1', v1);
app.route('/api', dashboard);
