import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ResourceAmounts } from '@luminatick/shared';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetAuthorityRepository } from '../repositories/budget-authority.repository';
import type { SessionBudgetAuthorityRepository, SessionBudgetCredential, SessionBudgetRequirements } from '../repositories/session-budget-authority.repository';
import { IsolateBudgetAdmissionCache, type CanonicalBudgetIntent } from './isolate-admission.service';

/**
 * Session credential adapter only; it does not introduce a route permission,
 * authenticate JWTs, commit work, or represent an active dashboard integration.
 * Callers supply verified token facts and the canonical authorization target.
 */
export class SessionBudgetAdmissionService {
  constructor(private readonly cache: IsolateBudgetAdmissionCache) {}

  async admit(input: {
    repository: BudgetAuthorityRepository; sessions: SessionBudgetAuthorityRepository; namespace: DurableObjectNamespace;
    scope: VerifiedTenantScope; credential: SessionBudgetCredential; requirements: SessionBudgetRequirements;
    intent: CanonicalBudgetIntent; business: ResourceAmounts; now: () => number;
  }) {
    // A digest keeps the full credential/capability/group fence bounded without
    // retaining a JWT or allowing caller mutation while asynchronous work runs.
    const credential = structuredClone(input.credential);
    const requirements = structuredClone(input.requirements);
    const intent = structuredClone(input.intent);
    const business = structuredClone(input.business);
    const serialized = JSON.stringify([credential, requirements]);
    if (new TextEncoder().encode(serialized).byteLength > 16_384) return { status: 'rejected' as const, reason: 'stale-policy' as const };
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const credentialKey = `session:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    return this.cache.admit({ repository: input.repository, namespace: input.namespace, scope: input.scope,
      credentialKey, intent, business, now: input.now,
      authorization: { authorize: scope => scope.tenantId === input.scope.tenantId && scope.actorId === input.scope.actorId
        ? input.sessions.authorize(credential, requirements, input.now()) : Promise.resolve(null) },
    });
  }
}
