import { localBetaEnabled, type BetaPrincipal } from '../types/local-beta';
import { LocalBetaRuntimeRepository } from '../repositories/local-beta-runtime.repository';
import type { Env } from '../bindings';
import { LocalBetaAdmissionRepository } from '../repositories/local-beta-admission.repository';
import { BoundedConversationReadRepository } from '../repositories/bounded-conversation-read.repository';
import { LocalBetaAttachmentStorage } from '../storage/local-beta-attachments';
import type { BetaCredential } from '../types/local-beta';
import { ConversationAuditRepository } from '../repositories/conversation-audit.repository';
import { TicketMutationReplayRepository } from '../repositories/ticket-mutation-replay.repository';
import { Context, Next } from 'hono';
import { TicketMutationReplayService, type MutationPrincipal } from '../services/ticket-mutation-replay.service';
import { VerifiedTenantScope } from '../types/tenant';
import { Repositories } from '../repositories/interfaces';
import { createRepositories } from '../repositories';
import { TenantAttachmentStorage, LegacyArticleBodyStorage, TenantVectorStorage } from '../storage/adapters';

export type TenantRequestDeps = {
  scope: VerifiedTenantScope;
  betaAdmission?: LocalBetaAdmissionRepository;
  boundedConversationRead?: BoundedConversationReadRepository;
  conversationAudit: ConversationAuditRepository;
  ticketMutations: TicketMutationReplayRepository;
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
  const deps = createTenantRequestDeps(scope, c.env, credential);

  c.set('tenantDeps', deps);
  await next();
};


export function createTenantRequestDeps(scope: VerifiedTenantScope, env: any, credential?: BetaCredential): TenantRequestDeps {
  const guarded = localBetaEnabled(env);
  const kind = scope.roles.includes('integration') ? 'api-key'
    : scope.roles.includes('customer') ? 'customer' : 'staff';
  const betaAdmission = guarded
    ? new LocalBetaAdmissionRepository(env.DB, scope, { kind, id: scope.actorId }, credential)
    : undefined;
  const repositories = createRepositories(scope, env.DB, betaAdmission);
  const attachmentStorage = betaAdmission
    ? new LocalBetaAttachmentStorage(scope, env.ATTACHMENTS_BUCKET, betaAdmission)
    : new TenantAttachmentStorage(scope, env.ATTACHMENTS_BUCKET);
  const legacyArticleStorage = scope.tenantId === 'default-tenant' ? new LegacyArticleBodyStorage(scope, env.ATTACHMENTS_BUCKET) : undefined;
  const vectorStorage = new TenantVectorStorage(scope, env.VECTOR_INDEX);

  return {
    scope,
    betaAdmission,
    boundedConversationRead: betaAdmission ? new BoundedConversationReadRepository(env.DB, scope) : undefined,
    conversationAudit: new ConversationAuditRepository(env.DB, scope, betaAdmission),
    ticketMutations: new TicketMutationReplayRepository(env.DB, scope, betaAdmission),
    repositories,
    attachmentStorage,
    legacyArticleStorage,
    vectorStorage,
    ticketMutationReplay: principal => {
      const replayCredential = principal.kind === 'customer'
        ? { sessionVersion: principal.sessionVersion, expiresAt: principal.expiresAt } : undefined;
      const admission = guarded
        ? new LocalBetaAdmissionRepository(env.DB, scope, principal, replayCredential) : undefined;
      return new TicketMutationReplayService(env.DB, scope, principal, admission);
    },
  };
}

import { InboundTenantResolver } from '../auth/inbound-resolver';
export function createInboundResolver(env: any): InboundTenantResolver {
  return new InboundTenantResolver(env.DB);
}

import { UserAuthResolver } from '../auth/user-auth-resolver';
import { WidgetTenantResolver } from '../auth/widget-tenant-resolver';
export function createCustomerAuthResolvers(env: any) {
  if (!env.DB) throw new Error('Authentication database unavailable');
  return { widget: new WidgetTenantResolver(env.DB), identity: new UserAuthResolver(env.DB) };
}

/** Local policy is composed at the same trusted D1 boundary as tenant request repositories. */
export function createLocalBetaRuntimeRepository(env: Env): LocalBetaRuntimeRepository {
  return new LocalBetaRuntimeRepository(env.DB);
}

export function createLocalBetaAdmission(env: Env, scope: VerifiedTenantScope, principal: BetaPrincipal) {
  return new LocalBetaAdmissionRepository(env.DB, scope, principal);
}
