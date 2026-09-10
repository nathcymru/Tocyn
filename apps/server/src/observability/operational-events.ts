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

const SENSITIVE_KEY = /authorization|cookie|token|otp|magic|api.?key|secret|password|credential|body|content|prompt|output|attachment/i;

/** Runtime diagnostics accept only their explicit envelope; arbitrary request data is never serialized. */
export function operationalEvent(input: Omit<OperationalEvent, 'version' | 'type'>): OperationalEvent {
  return Object.freeze({
    version: OPERATIONAL_EVENT_VERSION,
    type: 'http.request',
    correlationId: input.correlationId,
    route: input.route,
    method: input.method,
    outcome: input.outcome,
    status: input.status,
    latencyMs: input.latencyMs,
  });
}

export function redactOperationalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOperationalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactOperationalValue(entry)]));
}

export function observabilityEnabled(env: { ENVIRONMENT?: string; LOCAL_BETA_ENABLED?: string; OBSERVABILITY_MODE?: string }): boolean {
  return env.ENVIRONMENT !== 'production' && env.LOCAL_BETA_ENABLED === 'true' && env.OBSERVABILITY_MODE === 'isolated-evidence';
}
