export function localBetaEnabled(env: { LOCAL_BETA_ENABLED?: string }): boolean {
  return env.LOCAL_BETA_ENABLED === 'true';
}

export type BetaPrincipal = Readonly<{ kind: 'customer' | 'staff' | 'api-key'; id: string; }>;
export type BetaCredential = Readonly<{ sessionVersion: number; expiresAt: number; }>;
/**
 * `configuration` has a separate intake ceiling so operational recovery
 * conversations retain their reserved capacity.
 */
export type BetaOperation = 'create' | 'configuration' | 'conversation' | 'upload';
export type BetaState = 'running' | 'intake_stopped' | 'writes_stopped';
export type BetaPolicy = Readonly<{
  run_id: string; revision: number; state: BetaState;
  ticket_limit: number; mutation_limit: number; recovery_reserve: number; upload_limit: number;
  tickets: number; mutations: number; upload_attempts: number;
}>;
export type BetaDenialCode = 'beta_not_invited' | 'beta_mutation_limit' | 'beta_upload_limit' | 'beta_intake_stopped' | 'beta_admission_unavailable';
export class BetaAdmissionError extends Error {
  constructor(readonly code: BetaDenialCode, readonly status: 403 | 429 | 503) {
    super({
      beta_not_invited: 'This account is not invited to the local beta.',
      beta_mutation_limit: 'The local beta write limit has been reached. Accepted conversations remain available; contact the operator.',
      beta_upload_limit: 'The local beta upload attempt limit has been reached. Existing attachments remain available; contact the operator.',
      beta_intake_stopped: 'The operator has stopped this local beta action. Accepted conversations remain available.',
      beta_admission_unavailable: 'Local beta admission is unavailable. Contact the operator.',
    }[code]);
  }
}
export const DEFAULT_BETA_LIMITS = Object.freeze({ ticketLimit: 100, mutationLimit: 1000, recoveryReserve: 200, uploadLimit: 100 });
export type BetaLimits = { ticketLimit: number; mutationLimit: number; recoveryReserve: number; uploadLimit: number; };
export type BetaInitialization = Readonly<{
  runId: string;
  tenants: readonly string[];
  invitations: readonly (BetaPrincipal & { tenantId: string; })[];
  limits?: Partial<BetaLimits>;
}>;
export function validateBetaInitialization(input: BetaInitialization) {
  const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value);
  if (!identifier(input.runId) || input.tenants.length !== 2 || new Set(input.tenants).size !== 2 || !input.tenants.every(identifier)) throw new Error('Exactly two distinct local beta tenants and a valid run ID are required');
  const limits = { ...DEFAULT_BETA_LIMITS, ...input.limits };
  for (const key of Object.keys(DEFAULT_BETA_LIMITS) as (keyof BetaLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > DEFAULT_BETA_LIMITS[key]) throw new Error('Local beta limits must be positive integers no higher than the conservative defaults');
  }
  if (limits.recoveryReserve >= limits.mutationLimit) throw new Error('A mutation limit must retain both intake and recovery capacity');
  if (!input.invitations.length || input.invitations.length > 100) throw new Error('Local beta requires 1 to 100 explicit invitations');
  const keys = new Set<string>();
  for (const invitation of input.invitations) {
    if (!input.tenants.includes(invitation.tenantId) || !identifier(invitation.id) || !['customer', 'staff', 'api-key'].includes(invitation.kind)) throw new Error('Invalid local beta invitation');
    const key = JSON.stringify([invitation.tenantId, invitation.kind, invitation.id]);
    if (keys.has(key)) throw new Error('Duplicate local beta invitation');
    keys.add(key);
  }
  return { ...input, limits };
}
