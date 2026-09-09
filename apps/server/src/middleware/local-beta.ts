import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../bindings';
import type { VerifiedTenantScope } from '../types/tenant';
import { BetaAdmissionError, type BetaPrincipal } from '../types/local-beta';
import { LocalBetaAdmissionRepository } from '../repositories/local-beta-admission.repository';
import { isLocalAuthCaptureTransport } from '../services/email/transport';
import { ConversationReadError, parseListPage } from '../services/conversation-read-bounds';
import { requestBounds } from './request-bounds';

export function localBetaEnabled(env: Pick<Env,'LOCAL_BETA_ENABLED'>): boolean { return env.LOCAL_BETA_ENABLED === 'true'; }
export async function authorizeLocalBeta(env: Env, scope: VerifiedTenantScope, principal?: BetaPrincipal): Promise<void> {
  if (!localBetaEnabled(env)) return;
  const kind = scope.roles.includes('integration') ? 'api-key' : scope.roles.includes('customer') ? 'customer' : 'staff';
  await new LocalBetaAdmissionRepository(env.DB,scope,principal ?? { kind, id: scope.actorId }).authorize();
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

export const localBetaGuard: MiddlewareHandler<{ Bindings: Env }> = async (c,next) => {
  if (c.env.LOCAL_BETA_ENABLED === undefined || c.env.LOCAL_BETA_ENABLED === 'false') return next();
  if (!localBetaEnabled(c.env) || c.env.ENVIRONMENT !== 'local' || !c.env.emailTransport || !isLocalAuthCaptureTransport(c.env.emailTransport)
      || c.env.RESEND_API_KEY || c.env.CLOUDFLARE_API_TOKEN || c.env.CLOUDFLARE_ACCOUNT_ID || c.env.INBOUND_EMAIL_AUTH_VERIFIED === 'true') return c.json({code:'beta_admission_unavailable',error:'Local beta configuration is invalid'},503);
  const route = localBetaRoute(c.req.method,c.req.path);
  if (route === 'disabled') return c.json({code:'feature_disabled',error:'This feature is disabled in the local beta.'},503);
  // The guarded profile never falls through when the operator has not initialized valid policy.
  let revision=0;
  try {
    const policy = await c.env.DB.prepare(`SELECT p.revision,p.state FROM local_beta_policy p JOIN local_beta_runs r ON r.run_id=p.run_id
      WHERE p.singleton=1 AND (SELECT count(*) FROM local_beta_tenants t WHERE t.run_id=p.run_id)=2`).first();
    if (!policy) throw new Error('Unavailable');
    revision=Number(policy.revision);
    if (policy.state !== 'running') c.env.betaDiagnostics?.reset();
  } catch { return c.json({code:'beta_admission_unavailable',error:'Local beta policy is unavailable. Initialize it with the local operator command.'},503); }
  if (route==='configuration' && c.req.method==='GET' && c.req.path==='/api/v1/customer/config') {
    const key=c.req.header('X-Widget-Key')||c.req.query('key');
    if(key) {
      const resolved=await new WidgetTenantResolver(c.env.DB).resolveTenantByKey(key.trim());
      if(resolved) {
        const admitted=await c.env.DB.prepare(`SELECT 1 FROM local_beta_tenants t JOIN local_beta_policy p ON p.run_id=t.run_id WHERE p.singleton=1 AND t.tenant_id=?`).bind(resolved.tenantId).first();
        if(!admitted)return c.json({error:'Widget configuration not found'},404);
      }
    }
  }
  try { parseListPage({page:c.req.query('page'),limit:c.req.query('limit')}); }
  catch (error) { if (error instanceof ConversationReadError) return c.json({code:error.code,error:error.message},error.status); throw error; }
  return requestBounds(route === 'upload' ? 10*1024*1024+50000 : 64*1024)(c,async () => {
    if (['POST','PATCH','PUT'].includes(c.req.method) && route !== 'upload' && c.req.raw.body) {
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') || '')) { c.res=c.json({code:'unsupported_media_type',error:'Content-Type must be application/json'},415); return; }
      try {
        const value = await c.req.raw.clone().json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) { c.res=c.json({code:'invalid_json',error:'A single JSON object is required'},400); return; }
      } catch { c.res=c.json({code:'invalid_json',error:'Invalid JSON request body'},400); return; }
    }
    try {
      await next();
      if (c.req.method === 'GET' && route !== 'attachment' && c.res.headers.get('Content-Type')?.includes('application/json') && c.res.body) {
        const reader=c.res.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
        try {
          while(true) {
            const {done,value}=await reader.read();if(done)break;
            size+=value.byteLength;
            if(size>1024*1024) {await reader.cancel();c.res=c.json({code:'conversation_page_too_large',error:'This response exceeds the local beta limit. Request a smaller page or contact the operator.'},413);break;}
            chunks.push(value);
          }
          if(size<=1024*1024)c.res=new Response(new Blob(chunks),{status:c.res.status,headers:c.res.headers});
        } finally {reader.releaseLock();}
      }
      c.env.betaDiagnostics?.record(route,c.res.status < 400 ? 'accepted':'rejected',revision);
    }
    catch (error) { if (error instanceof BetaAdmissionError) { c.res=c.json({code:error.code,error:error.message},error.status); return; } throw error; }
  });
};
