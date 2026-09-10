export const OPERATIONAL_EVENT_VERSION = 1 as const;
export type OperationalOutcome = 'success' | 'client_error' | 'server_error' | 'unavailable';
export type OperationalEvent = Readonly<{
  version: typeof OPERATIONAL_EVENT_VERSION;
  type: 'http.request';
  correlationId: string;
  route: string;
  method: string;
  outcome: OperationalOutcome;
  status: number;
  latencyMs: number;
}>;

const ROUTES = new Set(['/health', '/api/auth', '/api/settings', '/api/channels', '/api/permissions', '/api/v1', '/api/realtime', '/api/other', '/other']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Runtime diagnostics accept only their explicit envelope; arbitrary request data is never serialized. */
export function operationalEvent(input: Omit<OperationalEvent, 'version' | 'type'>): OperationalEvent {
  if (typeof input.correlationId !== 'string' || !UUID.test(input.correlationId) || !Number.isInteger(input.status) || input.status < 100 || input.status > 599
    || !Number.isFinite(input.latencyMs) || input.latencyMs < 0) {
    throw new Error('Invalid operational event envelope');
  }
  return Object.freeze({
    version: OPERATIONAL_EVENT_VERSION,
    type: 'http.request',
    correlationId: input.correlationId,
    route: ROUTES.has(input.route) ? input.route : '/other',
    method: METHODS.has(input.method) ? input.method : 'OTHER',
    outcome: input.status >= 500 ? 'server_error' : input.status >= 400 ? 'client_error' : 'success',
    status: input.status,
    latencyMs: input.latencyMs,
  });
}

export function observabilityEnabled(env: { ENVIRONMENT?: string; LOCAL_BETA_ENABLED?: string; OBSERVABILITY_MODE?: string }): boolean {
  return env.ENVIRONMENT !== 'production' && env.OBSERVABILITY_MODE === 'isolated-evidence'
    && (env.LOCAL_BETA_ENABLED === 'true' || env.ENVIRONMENT === 'test');
}
