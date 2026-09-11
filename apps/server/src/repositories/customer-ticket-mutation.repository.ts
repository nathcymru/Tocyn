import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { CustomerBudgetCommitHandoff } from '../types/customer-budget-admission';
import type { VerifiedTenantScope } from '../types/tenant';
import { budgetCommitConstraint } from './budget-commit-fence';

/** The exact current-customer facts carried only from a successful reservation. */
export type CustomerMutationCommit = CustomerBudgetCommitHandoff;

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 320) return null;
  const normalized = value.trim().toLowerCase();
  return normalized && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

/**
 * A failed CHECK on this assertion row rolls back the complete canonical batch.
 * It repeats current identity and target ownership after warm admission, so a
 * revoked session or changed owner cannot spend an already issued handoff.
 */
export function customerMutationStatement(db: D1Database, scope: VerifiedTenantScope,
  commit: CustomerMutationCommit): D1PreparedStatement {
  const credential = commit.credential;
  const email = normalizedEmail(credential.email);
  const valid = credential.tenantId === scope.tenantId && credential.actorId === scope.actorId
    && credential.role === 'customer' && scope.roles.includes('customer')
    && Number.isSafeInteger(credential.sessionVersion) && credential.sessionVersion >= 0
    && credential.sessionVersion === scope.authVersion && Number.isSafeInteger(credential.expiresAt)
    && email !== null;
  const budget = budgetCommitConstraint(commit.authority, scope.tenantId);
  const sql = [
    '?=1',
    `EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=? AND u.id=? AND u.role='customer'
      AND u.session_version=? AND lower(trim(u.email))=?)`,
    '? > unixepoch()',
    budget.sql,
  ];
  const values: unknown[] = [valid ? 1 : 0, scope.tenantId, credential.actorId, credential.sessionVersion,
    email ?? '', credential.expiresAt, ...budget.values];
  if (commit.requirements.ticket) {
    const ticket = commit.requirements.ticket;
    const ownerEmail = normalizedEmail(ticket.customerEmail);
    sql.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id=? AND t.id=? AND t.customer_id IS ?
      AND lower(trim(t.customer_email))=? AND lower(trim(t.customer_email))=?)`);
    values.push(scope.tenantId, ticket.id, ticket.customerId, ownerEmail ?? '', email ?? '');
  }
  return db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
    VALUES (?,CASE WHEN ${sql.join(' AND ')} THEN 1 ELSE 0 END)
    ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
    .bind(scope.tenantId, ...values);
}
