import type { MiddlewareHandler } from 'hono';
import type { Env } from '../bindings';
import type { VerifiedTenantScope } from '../types/tenant';
import { BetaAdmissionError, localBetaEnabled, type BetaPrincipal } from '../types/local-beta';
export { localBetaEnabled } from '../types/local-beta';
import { createCustomerAuthResolvers, createLocalBetaAdmission, createLocalBetaRuntimeRepository } from './tenant.middleware';
import { isLocalAuthCaptureTransport } from '../services/email/transport';
import { ConversationReadError, parseListPage } from '../services/conversation-read-bounds';
import { requestBounds } from './request-bounds';

export async function authorizeLocalBeta(env: Env, scope: VerifiedTenantScope, principal?: BetaPrincipal): Promise<void> {
  if (!localBetaEnabled(env)) return;
  const kind = scope.roles.includes('integration') ? 'api-key' : scope.roles.includes('customer') ? 'customer' : 'staff';
  await createLocalBetaAdmission(env, scope, principal ?? { kind, id: scope.actorId }).authorize();
}

export type BetaRouteClass = 'health' | 'auth' | 'configuration' | 'conversation-read' | 'conversation-write' | 'upload' | 'attachment' | 'disabled';
/** Exact positive inventory: new or unclassified endpoints are disabled in the guarded profile. */
export function localBetaRoute(method: string, path: string): BetaRouteClass {
  if (method === 'OPTIONS') return 'configuration';
  if (method === 'GET' && path === '/health') return 'health';
  if ((method === 'POST' && /^\/api\/auth\/(login|logout|mfa\/(verify|setup|confirm|disable))$/.test(path)) || (method === 'GET' && path === '/api/auth/me') ||
    (method === 'POST' && /^\/api\/v1\/customer\/auth\/(request|verify|logout)$/.test(path)) || (method === 'GET' && path === '/api/v1/customer/auth/me')) return 'auth';
  if (method === 'GET' && path === '/api/v1/customer/config') return 'configuration';
  if (method === 'GET' && /^\/api(?:\/v1(?:\/customer)?)?\/tickets(?:\/[^/]+(?:\/history)?)?$/.test(path)) return 'conversation-read';
  if (method === 'GET' && /^\/api\/(stats|ticket-fields|users\/agents|groups|settings(?:\/filters(?:\/[^/]+)?)?\/?|permissions\/?|realtime)$/.test(path)) return 'conversation-read';
  if (method === 'GET' && /^\/api(?:\/v1\/customer)?\/attachments\/[^/]+\/download$/.test(path)) return 'attachment';
  if (method === 'POST' && /^\/api(?:\/v1\/customer)?\/attachments\/upload$/.test(path)) return 'upload';
  if ((method === 'POST' && /^\/api(?:\/v1(?:\/customer)?)?\/tickets$/.test(path)) ||
    (method === 'POST' && /^\/api(?:\/v1)?\/tickets\/[^/]+\/articles$/.test(path)) ||
    (method === 'POST' && /^\/api\/v1\/customer\/tickets\/[^/]+\/messages$/.test(path)) ||
    (method === 'PATCH' && /^\/api(?:\/v1)?\/tickets\/[^/]+$/.test(path))) return 'conversation-write';
  return 'disabled';
}

/** These existing authenticated actions deliberately ignore an empty POST payload. */
function permitsEmptyAuthAction(method: string, path: string): boolean {
  return method === 'POST' && [
    '/api/auth/logout',
    '/api/auth/mfa/setup',
    '/api/auth/mfa/disable',
    '/api/v1/customer/auth/logout',
  ].includes(path);
}

export const localBetaGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.LOCAL_BETA_ENABLED === undefined || c.env.LOCAL_BETA_ENABLED === 'false') return next();
  const invalidRuntime = !localBetaEnabled(c.env) || c.env.ENVIRONMENT !== 'local'
    || !c.env.emailTransport || !isLocalAuthCaptureTransport(c.env.emailTransport);
  const externalProvider = c.env.RESEND_API_KEY || c.env.CLOUDFLARE_API_TOKEN
    || c.env.CLOUDFLARE_ACCOUNT_ID || c.env.INBOUND_EMAIL_AUTH_VERIFIED === 'true';
  if (invalidRuntime || externalProvider) {
    return c.json({ code: 'beta_admission_unavailable', error: 'Local beta configuration is invalid' }, 503);
  }
  const route = localBetaRoute(c.req.method, c.req.path);
  if (route === 'disabled') {
    return c.json({ code: 'feature_disabled', error: 'This feature is disabled in the local beta.' }, 503);
  }
  // The guarded profile never falls through without initialized durable policy.
  const runtimePolicy = createLocalBetaRuntimeRepository(c.env);
  let revision = 0;
  try {
    const policy = await runtimePolicy.currentPolicy();
    if (!policy) throw new Error('Unavailable');
    revision = Number(policy.revision);
    if (policy.state !== 'running') c.env.betaDiagnostics?.reset();
  } catch {
    return c.json({
      code: 'beta_admission_unavailable',
      error: 'Local beta policy is unavailable. Initialize it with the local operator command.',
    }, 503);
  }
  if (route === 'configuration' && c.req.method === 'GET' && c.req.path === '/api/v1/customer/config') {
    const key = c.req.header('X-Widget-Key') || c.req.query('key');
    if (key) {
      const resolved = await createCustomerAuthResolvers(c.env).widget.resolveTenantByKey(key.trim());
      if (resolved) {
        const admitted = await runtimePolicy.admitsTenant(resolved.tenantId);
        if (!admitted) return c.json({ error: 'Widget configuration not found' }, 404);
      }
    }
  }
  try {
    parseListPage({ page: c.req.query('page'), limit: c.req.query('limit') });
  } catch (error) {
    if (error instanceof ConversationReadError) return c.json({ code: error.code, error: error.message }, error.status);
    throw error;
  }
  const requestLimit = route === 'upload' ? 10 * 1024 * 1024 + 50000 : 64 * 1024;
  return requestBounds(requestLimit)(c, async () => {
    if (['POST', 'PATCH', 'PUT'].includes(c.req.method) && route !== 'upload' && c.req.raw.body) {
      const rawBody = await c.req.raw.clone().arrayBuffer();
      if (!(permitsEmptyAuthAction(c.req.method, c.req.path) && rawBody.byteLength === 0)) {
        if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') || '')) {
          c.res = c.json({ code: 'unsupported_media_type', error: 'Content-Type must be application/json' }, 415);
          return;
        }
        try {
          const value = JSON.parse(new TextDecoder().decode(rawBody));
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            c.res = c.json({ code: 'invalid_json', error: 'A single JSON object is required' }, 400);
            return;
          }
        } catch {
          c.res = c.json({ code: 'invalid_json', error: 'Invalid JSON request body' }, 400);
          return;
        }
      }
    }
    try {
      await next();
      // Mutation input/snapshots are bounded before commit; never reject a committed write here.
      const boundedRead = c.req.method === 'GET' && route !== 'attachment'
        && c.res.headers.get('Content-Type')?.includes('application/json') && c.res.body;
      if (boundedRead) {
        const reader = boundedRead.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024 * 1024) {
              await reader.cancel();
              c.res = c.json({
                code: 'conversation_page_too_large',
                error: 'This response exceeds the local beta limit. Request a smaller page or contact the operator.',
              }, 413);
              break;
            }
            chunks.push(value);
          }
          if (size <= 1024 * 1024) {
            c.res = new Response(new Blob(chunks), { status: c.res.status, headers: c.res.headers });
          }
        } finally {
          reader.releaseLock();
        }
      }
      c.env.betaDiagnostics?.record(route, c.res.status < 400 ? 'accepted' : 'rejected', revision);
    } catch (error) {
      if (error instanceof BetaAdmissionError) {
        c.res = c.json({ code: error.code, error: error.message }, error.status);
        return;
      }
      throw error;
    }
  });
};
