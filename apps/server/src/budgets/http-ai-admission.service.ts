import type { ResourceAmounts } from '@luminatick/shared';
import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import type { JWTPayload } from '../types';
import { CustomerCurrentCredentialRepository, type CustomerBudgetCredential } from '../repositories/customer-current-credential.repository';
import { SessionBudgetAuthorityRepository, type SessionBudgetCredential } from '../repositories/session-budget-authority.repository';
import { apiTicketBudgetCache, sessionTicketBudgetAdmission, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { estimateDiagnosticEnvelope } from '../observability/resource-envelope';

export type HttpAiOperation = 'widget.chat' | 'dashboard.ticket.ai-suggest';

/**
 * These are documented provider maxima, expressed in the catalogue's integer
 * micro-neuron unit.  Cloudflare lists BGE Large at 18,582 neurons/M input
 * tokens and Llama 3 8B at 25,608 input / 75,147 output neurons/M tokens.
 * Reserving the full Llama context window plus requested output is deliberately
 * conservative: no tokenizer or provider usage response is trusted for an
 * admission decision.  BGE Large is documented as a 1,024-dimension, 512-token
 * embedding model.  See docs/cost-resource-catalogue.md (cf-2026-09-10).
 */
export const HTTP_AI_EMBEDDING_DIMENSIONS = 1_024;
const BGE_MAX_INPUT_TOKENS = 512;
const BGE_MICRONEURONS_PER_MILLION_INPUT_TOKENS = 18_582;
const LLAMA_MAX_INPUT_TOKENS = 7_968;
const LLAMA_INPUT_MICRONEURONS_PER_MILLION_TOKENS = 25_608;
const LLAMA_OUTPUT_MICRONEURONS_PER_MILLION_TOKENS = 75_147;

function microNeurons(inputTokens: number, inputRate: number, outputTokens = 0, outputRate = 0): number {
  // One neuron is one million micro-neurons, cancelling the provider's
  // per-million-token denominator exactly. Keep the arithmetic explicit so a
  // rate change cannot silently switch the catalogue unit.
  const value = inputTokens * inputRate + outputTokens * outputRate;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid AI resource conversion');
  return value;
}

const EMBEDDING_MICRONEURONS = microNeurons(BGE_MAX_INPUT_TOKENS, BGE_MICRONEURONS_PER_MILLION_INPUT_TOKENS);

function envelope(outputTokens: number, r2ClassBOperations: number): Readonly<ResourceAmounts> {
  return Object.freeze({
    // One pre-admitted HTTP execution. The isolate holder independently
    // reserves bounded current-credential/authority attempts before work.
    workerRequests: 1,
    // The route performs no unbounded scans. This includes the bounded current
    // authority reads plus ticket/document visibility reads after admission.
    d1RowsRead: 2_560,
    r2ClassBOperations,
    aiMicroNeurons: EMBEDDING_MICRONEURONS + microNeurons(
      LLAMA_MAX_INPUT_TOKENS,
      LLAMA_INPUT_MICRONEURONS_PER_MILLION_TOKENS,
      outputTokens,
      LLAMA_OUTPUT_MICRONEURONS_PER_MILLION_TOKENS,
    ),
    vectorQueriedDimensions: HTTP_AI_EMBEDDING_DIMENSIONS,
    ...estimateDiagnosticEnvelope({ httpRequests: 1, canonicalMutationRequests: 0 }),
  });
}

/** Widget retrieval hydrates at most the three selected current public answers. */
export const WIDGET_CHAT_AI_ENVELOPE = envelope(512, 3);
/** Suggestions hydrate at most five recent message bodies; retrieval is metadata-only. */
export const STAFF_SUGGESTION_AI_ENVELOPE = envelope(1_024, 5);

export type HttpAiAdmission = Readonly<{
  status: 'disabled' | 'admitted' | 'rejected';
  reason?: 'exhausted' | 'unavailable';
}>;

type AdmissionInput = Readonly<{
  env: Env;
  deps: TenantRequestDeps;
  payload: JWTPayload;
  operation: HttpAiOperation;
  targetId?: string;
  now: () => number;
}>;

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function digest(parts: readonly unknown[]): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(parts));
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * AI has no legacy unmetered mode. `off` deliberately returns a caller-owned
 * manual fallback; every other non-combined setting rejects before retrieval.
 * Combined mode is the existing approved active HTTP admission boundary.
 */
export async function admitHttpAi(input: AdmissionInput): Promise<HttpAiAdmission> {
  const mode = ticketMutationAdmissionMode(input.env);
  if (mode === 'disabled') return { status: 'disabled' };
  if (mode !== 'combined' || !input.env.BUDGET_COORDINATOR_DO) return { status: 'rejected', reason: 'unavailable' };

  const { deps, payload } = input;
  if (!validIdentity(deps.scope.tenantId) || !validIdentity(deps.scope.actorId) || payload.sub !== deps.scope.actorId
    || payload.tenant_id !== deps.scope.tenantId || !validIdentity(input.operation)
    || (input.targetId !== undefined && !validIdentity(input.targetId))
    || (input.operation === 'widget.chat' && payload.role !== 'customer')
    || (input.operation === 'dashboard.ticket.ai-suggest' && (payload.role === 'customer' || !validIdentity(input.targetId)))) return { status: 'rejected', reason: 'unavailable' };
  const operationId = crypto.randomUUID();
  const operationFingerprint = await digest(['http-ai-v1', input.operation, deps.scope.tenantId, deps.scope.actorId, input.targetId ?? null]);
  const business = input.operation === 'widget.chat' ? WIDGET_CHAT_AI_ENVELOPE : STAFF_SUGGESTION_AI_ENVELOPE;

  try {
    if (payload.role === 'customer') {
      if (typeof payload.session_version !== 'number' || !Number.isSafeInteger(payload.session_version)
        || !Number.isSafeInteger(payload.exp) || typeof payload.email !== 'string') return { status: 'rejected', reason: 'unavailable' };
      const credential: CustomerBudgetCredential = { tenantId: deps.scope.tenantId, actorId: payload.sub, role: 'customer',
        sessionVersion: payload.session_version, expiresAt: payload.exp, email: payload.email };
      const outcome = await apiTicketBudgetCache.admit({ repository: deps.repositories.budgetAuthority, namespace: input.env.BUDGET_COORDINATOR_DO,
        scope: deps.scope, credentialKey: `customer-ai:${deps.scope.tenantId}:${payload.sub}`,
        intent: { operationId, operationFingerprint, workScopeKey: input.operation }, business, now: input.now,
        authorization: { authorize: scope => scope.tenantId === deps.scope.tenantId && scope.actorId === deps.scope.actorId
          ? new CustomerCurrentCredentialRepository(deps.database, deps.scope).authorize(credential, {}, input.now()) : Promise.resolve(null) },
      });
      return outcome.status === 'spent' || outcome.status === 'idempotent' ? { status: 'admitted' }
        : { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
    }
    if ((payload.role !== 'admin' && payload.role !== 'agent') || payload.mfa_verified !== true
      || typeof payload.session_version !== 'number' || !Number.isSafeInteger(payload.session_version) || !Number.isSafeInteger(payload.exp)) {
      return { status: 'rejected', reason: 'unavailable' };
    }
    const credential: SessionBudgetCredential = { tenantId: deps.scope.tenantId, actorId: payload.sub, role: payload.role,
      sessionVersion: payload.session_version, expiresAt: payload.exp, mfaVerified: true };
    const outcome = await sessionTicketBudgetAdmission.admit({ repository: deps.repositories.budgetAuthority,
      sessions: new SessionBudgetAuthorityRepository(deps.database, deps.scope), namespace: input.env.BUDGET_COORDINATOR_DO,
      scope: deps.scope, credential, requirements: { readTicketId: input.targetId }, intent: { operationId, operationFingerprint, workScopeKey: input.operation },
      business, now: input.now,
    });
    return outcome.status === 'spent' || outcome.status === 'idempotent' ? { status: 'admitted' }
      : { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
  } catch {
    return { status: 'rejected', reason: 'unavailable' };
  }
}
