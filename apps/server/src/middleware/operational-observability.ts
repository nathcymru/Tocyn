import type { Context, Next } from 'hono';
import type { Env } from '../bindings';
import { observabilityEnabled, operationalEvent } from '../observability/operational-events';

function safeRoute(path: string): string {
  if (path === '/health') return '/health';
  for (const prefix of ['/api/auth', '/api/settings', '/api/channels', '/api/permissions', '/api/v1', '/api/realtime']) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return prefix;
  }
  return path.startsWith('/api/') ? '/api/other' : '/other';
}

export async function operationalObservability(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  const correlationId = crypto.randomUUID();
  const started = Date.now();
  try {
    await next();
  } finally {
    if (!observabilityEnabled(c.env)) return;
    const status = c.res.status;
    const outcome = status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'success';
    try { console.log(JSON.stringify(operationalEvent({ correlationId, route: safeRoute(c.req.path), method: c.req.method, outcome, status, latencyMs: Date.now() - started }))); }
    catch { /* Telemetry cannot affect authorization, isolation, or request recovery. */ }
  }
}
