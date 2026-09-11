import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requestBounds } from '../request-bounds';
import { apiCors } from '../cors-policy';

describe('request controls', () => {
  it.each([undefined, '1'])('counts actual streamed bytes with Content-Length %s', async (length) => {
    const app = new Hono(); let dispatched = false;
    app.use('*', requestBounds(8));
    app.post('/', c => { dispatched = true; return c.text('ok'); });
    const req = new Request('https://example.com/', { method: 'POST', headers: length ? { 'Content-Length': length } : {}, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(9)); c.close(); } }), duplex: 'half' } as RequestInit);
    expect((await app.fetch(req)).status).toBe(413);
    expect(dispatched).toBe(false);
  });
  it('preserves a bounded JSON request', async () => {
    const app = new Hono(); app.use('*', requestBounds(50));
    app.post('/', async c => c.json(await c.req.json()));
    expect(await (await app.request('/', { method: 'POST', body: '{"ok":true}' })).json()).toEqual({ ok: true });
  });
  it('permits configured portal credentials and excludes arbitrary credentialed origins', async () => {
    const app = new Hono(); app.use('*', apiCors); app.get('/api/data', c => c.text('ok'));
    const env = { PORTAL_URL: 'https://portal.example.com', ENVIRONMENT: 'production' };
    const allowed = await app.request('/api/data', { headers: { Origin: env.PORTAL_URL } }, env);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(env.PORTAL_URL);
    const denied = await app.request('/api/data', { headers: { Origin: 'https://untrusted.example.com' } }, env);
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('blocks cookie-authenticated mutations before side effects unless their origin is trusted', async () => {
    const app = new Hono(); let writes = 0;
    app.use('*', apiCors); app.post('/api/data', c => { writes++; return c.text('ok'); });
    const env = { PORTAL_URL: 'https://portal.example.com', ENVIRONMENT: 'production' };
    for (const origin of [undefined, 'https://other.example.com']) {
      const headers: Record<string, string> = { Cookie: 'lumina_customer_token=synthetic' };
      if (origin) headers.Origin = origin;
      expect((await app.request('/api/data', { method: 'POST', headers }, env)).status).toBe(403);
    }
    expect(writes).toBe(0);
    expect((await app.request('/api/data', { method: 'POST', headers: { Cookie: 'lumina_customer_token=synthetic', Origin: env.PORTAL_URL } }, env)).status).toBe(200);
    expect(writes).toBe(1);
  });
  it('allows embedded widget bearer access without cross-origin credentials', async () => {
    const app = new Hono(); app.use('*', apiCors); app.get('/api/v1/widget/config', c => c.text('ok'));
    const response = await app.request('/api/v1/widget/config', { headers: { Origin: 'https://embed.example.com' } }, {});
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
  it('does not allow preview HTTP localhost origins', async () => {
    const app = new Hono(); app.use('*', apiCors); app.get('/api/data', c => c.text('ok'));
    const response = await app.request('/api/data', { headers: { Origin: 'http://localhost:5173' } }, { PORTAL_URL: 'http://localhost:5173', ENVIRONMENT: 'preview' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('permits the optional retry header only for configured credentialed origins', async () => {
    const app = new Hono(); app.use('*', apiCors); app.post('/api/data', c => c.text('ok'));
    const env = { PORTAL_URL: 'https://portal.example.com', ENVIRONMENT: 'production' };
    const preflight = await app.request('/api/data', {
      method: 'OPTIONS',
      headers: {
        Origin: env.PORTAL_URL,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,idempotency-key',
      },
    }, env);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key');
    const response = await app.request('/api/data', { method: 'POST', headers: { Origin: env.PORTAL_URL } }, env);
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Idempotency-Replayed');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Next-Cursor');
  });
  it('preflights API credentials with retry keys only on the configured API origin', async () => {
    const app = new Hono(); app.use('*', apiCors);
    const env = { PORTAL_URL: 'https://portal.example.com', ENVIRONMENT: 'production' };
    const headers = {
      Origin: env.PORTAL_URL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-api-key,idempotency-key',
    };
    const allowed = await app.request('/api/v1/tickets', { method: 'OPTIONS', headers }, env);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(env.PORTAL_URL);
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toContain('X-API-Key');
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key');
    const denied = await app.request('/api/v1/tickets', {
      method: 'OPTIONS', headers: { ...headers, Origin: 'https://untrusted.example.com' },
    }, env);
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const widget = await app.request('/api/v1/widget/tickets', { method: 'OPTIONS', headers }, env);
    expect(widget.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(widget.headers.get('Access-Control-Allow-Headers')).not.toContain('X-API-Key');
  });

});
