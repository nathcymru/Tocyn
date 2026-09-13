import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { SessionBudgetAuthorityRepository, SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { BudgetGrantRecoveryService } from './budget-grant-recovery.service';
import { IsolateBudgetAdmissionCache, type CanonicalBudgetIntent, type TargetWriteRecoveryDescriptor } from './isolate-admission.service';

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
    emailDeliveryPartition?: 'ticket-email-v1';
    singleOperationGrant?: 'target-write-v1';
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
    const singleOperation = input.singleOperationGrant !== undefined;
    const sharedRead = input.readScopePartition !== undefined;
    const sharedEmail = input.emailDeliveryPartition !== undefined;
    const validTarget = (value: unknown): value is string => typeof value === 'string' && value.length > 0
      && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
    if (singleOperation && (input.singleOperationGrant !== 'target-write-v1' || sharedRead || sharedEmail
      || !/^(dashboard\.ticket\.(reply|update|sla\.initialize|support-state\.transition)):[0-9a-f]{64}$/.test(intent.workScopeKey)
      || Object.keys(requirements).some(key => key !== 'ticket' && key !== 'capability')
      || !requirements.ticket || Object.keys(requirements.ticket).length !== 2
      || !validTarget(requirements.ticket.id)
      || (requirements.ticket.groupId !== null && !validTarget(requirements.ticket.groupId)))) {
      return { status: 'rejected' as const, reason: 'invalid-request' as const };
    }
    if (sharedEmail && (sharedRead || input.emailDeliveryPartition !== 'ticket-email-v1'
      || intent.workScopeKey !== 'ticket-email.delivery' || Object.keys(requirements).length !== 1
      || !requirements.ticket || Object.keys(requirements.ticket).length !== 2
      || !validTarget(requirements.ticket.id)
      || (requirements.ticket.groupId !== null && !validTarget(requirements.ticket.groupId)))) {
      return { status: 'rejected' as const, reason: 'invalid-request' as const };
    }
    if (sharedRead && (input.readScopePartition !== 'ticket-read-v1'
      || !['dashboard.ticket.detail', 'dashboard.ticket.history', 'workspace.draft.read'].includes(intent.workScopeKey)
      || Object.keys(requirements).length !== 1
      || typeof requirements.readTicketId !== 'string' || requirements.readTicketId.length === 0
      || requirements.readTicketId.length > 256 || /[\u0000-\u001f\u007f]/.test(requirements.readTicketId))) {
      return { status: 'rejected' as const, reason: 'invalid-request' as const };
    }
    const serialized = JSON.stringify(sharedRead
      ? ['session-ticket-read-partition-v1', credential, intent.workScopeKey]
      : sharedEmail ? ['session-ticket-email-partition-v1', credential, intent.workScopeKey]
        : [credential, requirements]);
    if (new TextEncoder().encode(serialized).byteLength > 16_384) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const credentialKey = `session:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const authorization = { authorize: (scope: VerifiedTenantScope) => scope.tenantId === input.scope.tenantId && scope.actorId === input.scope.actorId
      ? input.sessions.authorize(credential, requirements, input.now()) : Promise.resolve(null) };
    const recovery = input.database ? new BudgetGrantRecoveryService(input.database, input.repository, input.namespace, input.scope,
      { credentialKey, authorization }) : undefined;
    const groupHash = recovery ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['session-recovery-group-v1', credential]))) : undefined;
    const groupKey = groupHash ? `session-recovery:${Array.from(new Uint8Array(groupHash), byte => byte.toString(16).padStart(2, '0')).join('')}` : undefined;
    return this.cache.admit({ repository: input.repository, namespace: input.namespace, scope: input.scope,
      credentialKey, intent, business, now: input.now, authorization,
      ...(singleOperation ? { maxBlockOperations: 1 as const } : {}),
      ...(recovery && groupKey ? { sessionRecovery: {
        groupKey,
        ...(singleOperation ? { descriptor: { credential, requirements, credentialKey, recoveryGroupKey: groupKey } } : {}),
        recover: (sealed: Parameters<BudgetGrantRecoveryService['recover']>[0], original: TargetWriteRecoveryDescriptor, now: number) => {
          // Use this request's repositories, clock and observation context. The
          // retained data supplies only the ORIGINAL target authorization facts.
          const originalAuthorization = { authorize: (scope: VerifiedTenantScope) => scope.tenantId === original.credential.tenantId && scope.actorId === original.credential.actorId
            ? input.sessions.authorize(original.credential, original.requirements, input.now()) : Promise.resolve(null) };
          return new BudgetGrantRecoveryService(input.database!, input.repository, input.namespace, input.scope,
            { credentialKey: original.credentialKey, authorization: originalAuthorization }).recover(sealed, now);
        },
      } } : {}),
      ...(recovery ? { recoverGrant: (sealed: Parameters<BudgetGrantRecoveryService['recover']>[0], now: number) => recovery.recover(sealed, now) } : {}),
    });
  }
}
