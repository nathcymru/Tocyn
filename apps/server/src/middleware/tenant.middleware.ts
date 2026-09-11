import { observeD1 } from '../repositories/observed-d1';
import { createResourceOperationEmitter, type ResourceOperationEmitter } from '../observability/resource-operation';
import { CapabilityPolicyService } from '../repositories/capability-policy.repository';
import { localBetaEnabled, type BetaPrincipal } from '../types/local-beta';
import { LocalBetaRuntimeRepository } from '../repositories/local-beta-runtime.repository';
import type { Env } from '../bindings';
import { LocalBetaAdmissionRepository } from '../repositories/local-beta-admission.repository';
import { BoundedConversationReadRepository } from '../repositories/bounded-conversation-read.repository';
import { LocalBetaAttachmentStorage } from '../storage/local-beta-attachments';
import type { BetaCredential } from '../types/local-beta';
import { ConversationAuditRepository } from '../repositories/conversation-audit.repository';
import { TicketMutationReplayRepository } from '../repositories/ticket-mutation-replay.repository';
import { OperationalMetricsRepository } from '../repositories/operational-metrics.repository';
import { OperatorActivityRepository } from '../repositories/operator-activity.repository';
import { Context, Next } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { TicketMutationReplayService, type MutationPrincipal } from '../services/ticket-mutation-replay.service';
import { VerifiedTenantScope } from '../types/tenant';
import { Repositories } from '../repositories/interfaces';
import { createRepositories } from '../repositories';
import { TenantAttachmentStorage, LegacyArticleBodyStorage, TenantVectorStorage } from '../storage/adapters';
import type { RequestCanonicalMutationSli } from '../observability/request-canonical-mutation-sli';
import type { OwnerIngressRequestAdmission } from '../budgets/owner-ingress-admission.service';
import { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';

export type TenantRequestDeps = {
  /** Request-observed D1 boundary for fixed, server-composed mutation services. */
  database: D1Database;
  emitResourceOperation?: ResourceOperationEmitter;
  canonicalMutationSli?: RequestCanonicalMutationSli;
  scope: VerifiedTenantScope;
  capabilityPolicy: CapabilityPolicyService;
  betaAdmission?: LocalBetaAdmissionRepository;
  /** Session claims accepted by authentication; never re-read as a new credential. */
  credential?: BetaCredential;
  boundedConversationRead?: BoundedConversationReadRepository;
  conversationAudit: ConversationAuditRepository;
  ticketMutations: TicketMutationReplayRepository;
  operationalMetrics: OperationalMetricsRepository;
  operatorActivity: OperatorActivityRepository;
  repositories: Repositories;
  attachmentStorage: TenantAttachmentStorage;
  legacyArticleStorage?: LegacyArticleBodyStorage;
  vectorStorage: TenantVectorStorage;
  ticketMutationReplay: (principal: MutationPrincipal) => TicketMutationReplayService;
};

export const tenantMiddleware = async (c: Context, next: Next) => {
  const scope = c.get('tenantScope') as VerifiedTenantScope | undefined;

  if (!scope) {
    return c.json({ error: "Unauthorized: Missing verified tenant scope" }, 401);
  }

  // Trusted composition boundary
  const payload = c.get('jwtPayload') as { session_version?: number; exp?: number ;} | undefined;
  const credential = payload?.exp ? { sessionVersion: payload.session_version ?? 0, expiresAt: payload.exp } : undefined;
  const deps = createTenantRequestDeps(scope, c.env, credential, c.get('requestCanonicalMutationSli'), c.get('resourceOperationEmitter'), c.get('ownerIngressAdmission'));

  c.set('tenantDeps', deps);
  await next();
};


export function createTenantRequestDeps(scope: VerifiedTenantScope, env: any, credential?: BetaCredential, canonicalMutationSli?: RequestCanonicalMutationSli, sharedEmitter?: ResourceOperationEmitter, ownerIngressAdmission?: OwnerIngressRequestAdmission): TenantRequestDeps {
  const emitResourceOperation = sharedEmitter ?? createResourceOperationEmitter(env);
  const db = observeD1(env.DB, emitResourceOperation);
  const guarded = localBetaEnabled(env);
  const kind = scope.roles.includes('integration') ? 'api-key'
    : scope.roles.includes('customer') ? 'customer' : 'staff';
  const betaAdmission = guarded
    ? new LocalBetaAdmissionRepository(db, scope, { kind, id: scope.actorId }, credential)
    : undefined;
  const repositories = createRepositories(scope, db, betaAdmission, canonicalMutationSli, env.DB, ownerIngressAdmission);
  const attachmentStorage = betaAdmission
    ? new LocalBetaAttachmentStorage(scope, env.ATTACHMENTS_BUCKET, betaAdmission, emitResourceOperation)
    : new TenantAttachmentStorage(scope, env.ATTACHMENTS_BUCKET, emitResourceOperation);
  const legacyArticleStorage = scope.tenantId === 'default-tenant' ? new LegacyArticleBodyStorage(scope, env.ATTACHMENTS_BUCKET, emitResourceOperation) : undefined;
  const vectorStorage = new TenantVectorStorage(scope, env.VECTOR_INDEX);
  const operatorActivity = new OperatorActivityRepository(scope, db, env.JWT_SECRET);

  return {
    database: db,
    emitResourceOperation,
    scope,
    capabilityPolicy: new CapabilityPolicyService(db, scope),
    betaAdmission,
    credential,
    boundedConversationRead: betaAdmission ? new BoundedConversationReadRepository(db, scope) : undefined,
    conversationAudit: new ConversationAuditRepository(db, scope, betaAdmission, canonicalMutationSli),
    canonicalMutationSli,
    ticketMutations: new TicketMutationReplayRepository(db, scope, betaAdmission, canonicalMutationSli),
    operationalMetrics: new OperationalMetricsRepository(db, scope),
    operatorActivity,
    repositories,
    attachmentStorage,
    legacyArticleStorage,
    vectorStorage,
    ticketMutationReplay: principal => {
      const replayCredential = principal.kind === 'customer'
        ? { sessionVersion: principal.sessionVersion, expiresAt: principal.expiresAt } : undefined;
      const admission = guarded
        ? new LocalBetaAdmissionRepository(db, scope, principal, replayCredential) : undefined;
      return new TicketMutationReplayService(db, scope, principal, admission, canonicalMutationSli, operatorActivity);
    },
  };
}

import { InboundTenantResolver } from '../auth/inbound-resolver';
export function createInboundResolver(env: any): InboundTenantResolver {
  return new InboundTenantResolver(env.DB);
}

import { UserAuthResolver } from '../auth/user-auth-resolver';
import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';
export function createCustomerAuthResolvers(env: any, emit?: ResourceOperationEmitter) {
  if (!env.DB) throw new Error('Authentication database unavailable');
  const db = observeD1(env.DB, emit);
  return { widget: new WidgetTenantResolver(db), identity: new UserAuthResolver(db) };
}

/** Local policy is composed at the same trusted D1 boundary as tenant request repositories. */
export function createLocalBetaRuntimeRepository(env: Env, emit?: ResourceOperationEmitter): LocalBetaRuntimeRepository {
  return new LocalBetaRuntimeRepository(observeD1(env.DB, emit));
}

export function createLocalBetaAdmission(env: Env, scope: VerifiedTenantScope, principal: BetaPrincipal, emit?: ResourceOperationEmitter) {
  return new LocalBetaAdmissionRepository(observeD1(env.DB, emit), scope, principal);
}

/** Server-only deployment authority composition; no request tenant is accepted. */
export function createOwnerIngressBudgetAuthority(env: Env, emit?: ResourceOperationEmitter): BudgetAuthorityRepository {
  if (!env.DB) throw new Error('Budget authority database unavailable');
  return new BudgetAuthorityRepository(observeD1(env.DB, emit), undefined, env.DB);
}
