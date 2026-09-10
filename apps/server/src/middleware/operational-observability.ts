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
  let measurement: { correlationId: string; started: number } | undefined;
  try {
    if (observabilityEnabled(c.env)) measurement = { correlationId: crypto.randomUUID(), started: Date.now() };
  } catch { /* Diagnostic initialization cannot prevent the request. */ }
  let failed = false;
  try {
    await next();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Never return from finally: doing so would suppress a downstream error
    // whenever diagnostics are disabled. Even event construction is optional.
    try {
      if (measurement) {
        const { correlationId, started } = measurement;
        const status = failed ? 500 : c.res.status;
        const outcome = status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'success';
        console.log(JSON.stringify(operationalEvent({ correlationId, route: safeRoute(c.req.path), method: c.req.method, outcome, status, latencyMs: Date.now() - started })));
      }
    } catch { /* Telemetry cannot affect authorization, isolation, or request recovery. */ }
  }
}
