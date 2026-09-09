import { LocalBetaDiagnostics } from './services/local-beta-diagnostics';
import { app } from './application';
import { Env } from './bindings';
import { LocalAuthCaptureTransport } from './services/email/transport';

export { NotificationDO } from './durable_objects/NotificationDO';

const localOrigins = new Set(['http://localhost:8787', 'http://127.0.0.1:8787']);
const localCaptureOrigins = new Set([...localOrigins, 'http://localhost:5174', 'http://127.0.0.1:5174']);

function localRequest(request: Request): boolean {
  return localOrigins.has(new URL(request.url).origin);
}

function localMutationOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return !origin || localCaptureOrigins.has(origin);
}

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(body, { ...init, headers });
}

/** The local entrypoint is the only capability factory for captured mail. */
export function createLocalRuntime() {
  const capture = new LocalAuthCaptureTransport();
  const diagnostics = new LocalBetaDiagnostics();
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      if (!localRequest(request)) return response('Local runtime only', { status: 403 });
      if (env.ENVIRONMENT !== 'local') return response('Local runtime configuration is invalid', { status: 503 });
      const path = new URL(request.url).pathname;
      if (path === '/__local/beta-diagnostics' && request.method === 'GET' && env.LOCAL_BETA_ENABLED === 'true') return response(JSON.stringify(diagnostics.list()), { headers: { 'Content-Type': 'application/json' } });
      if (path === '/__local/auth-capture/messages' && request.method === 'GET') return response(JSON.stringify(capture.list()), { headers: { 'Content-Type': 'application/json' } });
      if (path === '/__local/auth-capture/reset' && request.method === 'POST') {
        if (!localMutationOrigin(request)) return response('Untrusted request origin', { status: 403 });
        capture.reset();
        return response(null, { status: 204 });
      }
      return app.fetch(request, { ...env, emailTransport: capture, betaDiagnostics: diagnostics }, ctx);
    },
  };
}

export default createLocalRuntime();
