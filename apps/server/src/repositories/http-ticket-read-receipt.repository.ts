import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import type { CustomerBudgetCredential } from './customer-current-credential.repository';
import { budgetCommitConstraint, budgetGrantOperationStatements } from './budget-commit-fence';

export class HttpTicketReadCompletionError extends Error {
  constructor() { super('Ticket read completion authority unavailable'); }
}

/** Exact terminal evidence only; no ticket, article or customer content enters the ledger. */
export class HttpTicketReadReceiptRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async complete(authority: BudgetCommitAuthority, credential: SessionBudgetCredential | CustomerBudgetCredential, ticketId: string): Promise<void> {
    if (credential.tenantId !== this.scope.tenantId || credential.actorId !== this.scope.actorId
      || credential.sessionVersion !== this.scope.authVersion || !this.scope.roles.includes(credential.role)
      || !Number.isSafeInteger(credential.sessionVersion) || !Number.isSafeInteger(credential.expiresAt)
      || (credential.role !== 'customer' && credential.mfaVerified !== true)) throw new HttpTicketReadCompletionError();
    const budget = budgetCommitConstraint(authority, this.scope.tenantId);
    // These live predicates mirror SessionBudgetAuthorityRepository and
    // CustomerCurrentCredentialRepository, now inside the same batch as the link.
    const customer = credential.role === 'customer';
    const target = customer
      ? `lower(trim(actor.email))=? AND lower(trim(ticket.customer_email))=?
        AND (ticket.customer_id IS NULL OR ticket.customer_id=actor.id)`
      : `actor.mfa_enabled=1 AND (actor.role='admin' OR ticket.group_id IS NULL
        OR EXISTS (SELECT 1 FROM user_groups membership WHERE membership.tenant_id=actor.tenant_id
          AND membership.user_id=actor.id AND membership.group_id=ticket.group_id))`;
    const email = customer ? credential.email.trim().toLowerCase() : undefined;
    const guard = this.db.prepare(`INSERT INTO budget_mutation_assertion(tenant_id,accepted)
      VALUES (?,CASE WHEN ${budget.sql} AND unixepoch()<? AND EXISTS (
        SELECT 1 FROM users actor JOIN tickets ticket ON ticket.tenant_id=actor.tenant_id AND ticket.id=?
        WHERE actor.tenant_id=? AND actor.id=? AND actor.role=? AND actor.session_version=? AND ${target}
      ) THEN 1 ELSE 0 END) ON CONFLICT(tenant_id) DO UPDATE SET accepted=excluded.accepted`)
      .bind(this.scope.tenantId, ...budget.values, credential.expiresAt, ticketId, this.scope.tenantId,
        credential.actorId, credential.role, credential.sessionVersion, ...(customer ? [email, email] : []));
    try {
      const results = await this.db.batch([guard, ...budgetGrantOperationStatements(this.db, this.scope, authority),
        this.db.prepare('SELECT accepted FROM budget_mutation_assertion WHERE tenant_id=?').bind(this.scope.tenantId)]);
      if ((results.at(-1)?.results?.[0] as { accepted?: number } | undefined)?.accepted !== 1) throw new HttpTicketReadCompletionError();
    } catch { throw new HttpTicketReadCompletionError(); }
  }
}
