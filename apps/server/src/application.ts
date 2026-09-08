import { Hono } from 'hono';
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
import { AuthService } from './services/auth/auth.service';
import { environmentGuard } from './middleware/environment-guard';
import { AppVariables } from './types';

export const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use('*', environmentGuard);

app.get('/api/realtime', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') return c.json({ error: 'Expected Upgrade: websocket' }, 426);
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  let user = null;
  try {
    user = await new AuthService(c.env).verifyToken(token);
    if (!user || !['agent', 'admin'].includes(user.role)) return c.json({ error: 'Unauthorized' }, 401);
  } catch { return c.json({ error: 'Unauthorized' }, 401); }
  const internalUrl = new URL(c.req.raw.url); internalUrl.search = '';
  const newReq = new Request(internalUrl, c.req.raw);
  newReq.headers.set('X-User-ID', user.id);
  newReq.headers.set('X-Tenant-ID', user.tenant_id!);
  newReq.headers.set('X-Session-Version', String(user.session_version));
  newReq.headers.set('X-Session-Expiry', String((user as any).session_expires_at));
  newReq.headers.set('X-Session-Role', user.role);
  newReq.headers.set('X-User-Name', user.full_name || user.email);
  const id = c.env.NOTIFICATION_DO.idFromName(`tenant:${user.tenant_id}`);
  return c.env.NOTIFICATION_DO.get(id).fetch(newReq);
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
