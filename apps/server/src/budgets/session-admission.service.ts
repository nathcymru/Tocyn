import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { SessionBudgetAuthorityRepository, SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { BudgetGrantRecoveryService } from './budget-grant-recovery.service';
import { IsolateBudgetAdmissionCache, type CanonicalBudgetIntent } from './isolate-admission.service';

/**
 * Session credential adapter only; it does not introduce a route permission,
 * authenticate JWTs, commit work, or represent an active dashboard integration.
 * Callers supply verified token facts and the canonical authorization target.
 * Successful spends carry the exact commitAuthority for an atomic mutation
 * fence; the staff adapter retains that result privately in its prepared attempt.
 */
export class SessionBudgetAdmissionService {
  constructor(private readonly cache: IsolateBudgetAdmissionCache) {}

  async admit(input: {
    repository: BudgetAuthorityRepository; sessions: SessionBudgetAuthorityRepository; namespace: DurableObjectNamespace;
    scope: VerifiedTenantScope; credential: SessionBudgetCredential; requirements: SessionBudgetRequirements;
    database?: D1Database;
    readScopePartition?: 'ticket-read-v1';
    intent: CanonicalBudgetIntent; business: ResourceAmounts; now: () => number;
  }) {
    // A digest keeps the full credential/capability/group fence bounded without
    // retaining a JWT or allowing caller mutation while asynchronous work runs.
    const credential = structuredClone(input.credential);
    const requirements = structuredClone(input.requirements);
    const intent = structuredClone(input.intent);
    const business = structuredClone(input.business);
    // This trusted opt-in changes accounting partitioning only. The complete
    // original target requirements still authorize every request and recovery.
    const sharedRead = input.readScopePartition !== undefined;
    if (sharedRead && (input.readScopePartition !== 'ticket-read-v1'
      || !['dashboard.ticket.detail', 'dashboard.ticket.history', 'workspace.draft.read'].includes(intent.workScopeKey)
      || Object.keys(requirements).length !== 1
      || typeof requirements.readTicketId !== 'string' || requirements.readTicketId.length === 0
      || requirements.readTicketId.length > 256 || /[\u0000-\u001f\u007f]/.test(requirements.readTicketId))) {
      return { status: 'rejected' as const, reason: 'invalid-request' as const };
    }
    const serialized = JSON.stringify(sharedRead
      ? ['session-ticket-read-partition-v1', credential, intent.workScopeKey]
      : [credential, requirements]);
    if (new TextEncoder().encode(serialized).byteLength > 16_384) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const credentialKey = `session:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const authorization = { authorize: (scope: VerifiedTenantScope) => scope.tenantId === input.scope.tenantId && scope.actorId === input.scope.actorId
      ? input.sessions.authorize(credential, requirements, input.now()) : Promise.resolve(null) };
    const recovery = input.database ? new BudgetGrantRecoveryService(input.database, input.repository, input.namespace, input.scope,
      { credentialKey, authorization }) : undefined;
    return this.cache.admit({ repository: input.repository, namespace: input.namespace, scope: input.scope,
      credentialKey, intent, business, now: input.now, authorization,
      ...(recovery ? { recoverGrant: (sealed: Parameters<BudgetGrantRecoveryService['recover']>[0], now: number) => recovery.recover(sealed, now) } : {}),
    });
  }
}
