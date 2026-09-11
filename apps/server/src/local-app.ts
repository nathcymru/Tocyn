import { LocalBetaDiagnostics } from './services/local-beta-diagnostics';
import { app } from './application';
import { Env } from './bindings';
import { LocalAuthCaptureTransport } from './services/email/transport';

const defaultLocalOrigins = new Set(['http://localhost:8787', 'http://127.0.0.1:8787']);

/**
 * The normal local runtime accepts only its documented port. Isolated local
 * rehearsals may provide one temporary loopback origin so they never need to
 * take over a developer-owned fixture. This is an entrypoint-only value, not a
 * deployed binding or a client-selected origin.
 */
function runtimeOrigins(env: Env): Set<string> {
  const configured = env.LOCAL_RUNTIME_ORIGIN;
  if (!configured) return defaultLocalOrigins;
  try {
    const parsed = new URL(configured);
    const validLoopback = parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && parsed.pathname === '/' && !parsed.search && !parsed.hash
      && parsed.port !== '' && Number.isInteger(Number(parsed.port))
      && Number(parsed.port) > 0 && Number(parsed.port) <= 65535;
    return validLoopback && parsed.origin === configured ? new Set([configured]) : new Set();
  } catch {
    return new Set();
  }
}

function localRequest(request: Request, env: Env): boolean {
  return runtimeOrigins(env).has(new URL(request.url).origin);
}

function localMutationOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  return !origin || new Set([...runtimeOrigins(env), 'http://localhost:5174', 'http://127.0.0.1:5174']).has(origin);
}

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(body, { ...init, headers });
}

export type LocalRuntimeOptions = Readonly<{
  now?: () => number;
  capture?: LocalAuthCaptureTransport;
}>;

/** The local entrypoint is the only capability factory for captured mail. */
export function createLocalRuntime(options: LocalRuntimeOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const capture = options.capture ?? new LocalAuthCaptureTransport(now);
  const diagnostics = new LocalBetaDiagnostics(now);
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      if (!localRequest(request, env)) return response('Local runtime only', { status: 403 });
      if (env.ENVIRONMENT !== 'local') return response('Local runtime configuration is invalid', { status: 503 });
      const path = new URL(request.url).pathname;
      if (path === '/__local/beta-diagnostics' && request.method === 'GET' && env.LOCAL_BETA_ENABLED === 'true') return response(JSON.stringify(diagnostics.list()), { headers: { 'Content-Type': 'application/json' } });
      if (path === '/__local/auth-capture/messages' && request.method === 'GET') return response(JSON.stringify(capture.list()), { headers: { 'Content-Type': 'application/json' } });
      if (path === '/__local/auth-capture/reset' && request.method === 'POST') {
        if (!localMutationOrigin(request, env)) return response('Untrusted request origin', { status: 403 });
        capture.reset();
        return response(null, { status: 204 });
      }
      return app.fetch(request, { ...env, emailTransport: capture, betaDiagnostics: diagnostics, localNow: now }, ctx);
    },
  };
}
