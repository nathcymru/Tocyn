import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import { budgetCommitConstraint,budgetGrantOperationStatements } from './budget-commit-fence';

/** The existing population/current-credential SELECT must precede count/page in
 * the same transaction. Turn its failure into rollback before linking a grant. */
export function ticketListCompletionStatements(db:D1Database,scope:VerifiedTenantScope,
  authority:BudgetCommitAuthority,assertion:{sql:string;values:readonly unknown[]}) {
  const budget=budgetCommitConstraint(authority,scope.tenantId);
  return [db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
    VALUES (?,CASE WHEN EXISTS (${assertion.sql}) AND (${budget.sql}) THEN 1 ELSE 0 END)
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
    .bind(scope.tenantId,...assertion.values,...budget.values),...budgetGrantOperationStatements(db,scope,authority)];
}
