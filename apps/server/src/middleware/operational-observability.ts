import type { Context, Next } from 'hono';
import type { Env } from '../bindings';
import { observabilityEnabled, operationalEvent, type OperationalEvent } from '../observability/operational-events';
import { createRequestAuthSli, type RequestAuthSliSnapshot } from '../observability/request-auth-sli';
import type { AppVariables } from '../types';

export type OperationalEventSink = (event: OperationalEvent) => void | Promise<void>;
export type RequestAuthSliSink = (snapshot: RequestAuthSliSnapshot) => void | Promise<void>;

function safeRoute(path: string): string {
  if (path === '/health') return '/health';
  for (const prefix of ['/api/auth', '/api/settings', '/api/channels', '/api/permissions', '/api/v1', '/api/realtime']) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return prefix;
  }
  return path.startsWith('/api/') ? '/api/other' : '/other';
}

export async function operationalObservability(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next, sink?: OperationalEventSink, authSliSink?: RequestAuthSliSink): Promise<void> {
  let measurement: { correlationId: string; started: number } | undefined;
  let requestAuthSli: AppVariables['requestAuthSli'];
  try {
    if (observabilityEnabled(c.env)) {
      measurement = { correlationId: crypto.randomUUID(), started: Date.now() };
      requestAuthSli = createRequestAuthSli();
      c.set('requestAuthSli', requestAuthSli);
    }
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
        const event = operationalEvent({ correlationId, route: safeRoute(c.req.path), method: c.req.method, outcome, status, latencyMs: Date.now() - started });
        if (sink) {
          const pending = sink(event);
          if (pending) void Promise.resolve(pending).catch(() => {});
        } else console.log(JSON.stringify(event));
      }
    } catch { /* Telemetry cannot affect authorization, isolation, or request recovery. */ }
    if (requestAuthSli?.hasDecision()) {
      try {
        const snapshot = requestAuthSli.snapshot();
        const pending = authSliSink ? authSliSink(snapshot) : console.log(JSON.stringify(snapshot));
        if (pending) void Promise.resolve(pending).catch(() => requestAuthSli?.markObserverFault());
      } catch { requestAuthSli.markObserverFault(); }
    }
  }
}
