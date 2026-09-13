import type { Env } from '../bindings';
import type { TenantRequestDeps } from '../middleware/tenant.middleware';
import { apiTicketBudgetCache, ticketMutationAdmissionMode } from '../middleware/budget-admission.middleware';
import { BudgetGrantRecoveryService } from './budget-grant-recovery.service';
import type { CurrentBudgetAuthorityGate } from './budget-coordinator.service';
import type { BudgetCommitAuthority } from './isolate-admission.service';
import { snapshotSnoozeDueIntent, snoozeDueEnvelope, snoozeDueFingerprint, type SnoozeDueIntent } from './snooze-due-intent';

/** Unwired local due adapter. Existing production scheduled guard is unchanged.
 * Fixed tenant catalogue ownership belongs to the future trusted composition. */
export async function admitSnoozeDue(input: { env: Env; deps: TenantRequestDeps;
  intent: SnoozeDueIntent; now: () => number }): Promise<
  Readonly<{ status: 'admitted'; authority: BudgetCommitAuthority; intent: SnoozeDueIntent;
    finish: (outcome: 'committed' | 'unknown') => void }>
  | Readonly<{ status: 'rejected'; reason: 'exhausted' | 'unavailable' }>> {
  const intent = snapshotSnoozeDueIntent(input.intent), tenantId = input.deps.scope.tenantId;
  if (!intent || ticketMutationAdmissionMode(input.env) !== 'combined' || !input.env.BUDGET_COORDINATOR_DO
    || !input.deps.scope.roles.includes('system') || input.deps.scope.actorId !== 'scheduled-snooze-resurface') {
    return { status: 'rejected', reason: 'unavailable' };
  }
  const business = snoozeDueEnvelope(intent);
  if (!business) return { status: 'rejected', reason: 'unavailable' };
  const namespace = input.env.BUDGET_COORDINATOR_DO;
  const authorization: CurrentBudgetAuthorityGate = { authorize: scope => Promise.resolve(
    scope.tenantId === tenantId && scope.roles.includes('system') && scope.actorId === 'scheduled-snooze-resurface'
      ? { kind: 'system' as const, actor: 'scheduled-snooze-resurface' as const } : null) };
  // Neither a session role nor an old request object is stored as authority.
  const credentialKey = `snooze-due:${tenantId}`;
  const purpose = intent.family === 'read' ? intent.input.purpose : 'new-work';
  try {
    const outcome = await apiTicketBudgetCache.admit({ repository: input.deps.repositories.budgetAuthority,
      namespace, scope: input.deps.scope, credentialKey, authorization,
      intent: { operationId: intent.family === 'read' ? intent.input.readId : intent.input.stepId,
        operationFingerprint: await snoozeDueFingerprint(tenantId,intent), workScopeKey: `scheduled.snooze.${intent.family}` },
      business, purpose, maxBlockOperations: 1, now: input.now,
      recoverGrant: (sealed, now) => new BudgetGrantRecoveryService(input.deps.database,
        input.deps.repositories.budgetAuthority, namespace, input.deps.scope, { credentialKey, authorization }).recover(sealed,now),
    });
    if ((outcome.status !== 'spent' && outcome.status !== 'idempotent') || !outcome.commitAuthority) {
      return { status: 'rejected', reason: outcome.reason === 'exhausted' || outcome.reason === 'capacity-exhausted' ? 'exhausted' : 'unavailable' };
    }
    const authority = outcome.commitAuthority;
    let finished = false;
    return { status: 'admitted', authority, intent, finish: result => {
      if (finished) return;
      finished = true;
      apiTicketBudgetCache.settleOperation(authority,result,input.now());
    } };
  } catch { return { status: 'rejected', reason: 'unavailable' }; }
}
