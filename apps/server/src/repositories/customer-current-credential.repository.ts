import type { D1Database } from '@cloudflare/workers-types';
import type { BudgetAuthorityPrincipal } from './budget-authority.repository';
import type { VerifiedTenantScope } from '../types/tenant';

/** One current identity read plus one exact ticket-owner read for replies. */
export const CUSTOMER_BUDGET_CREDENTIAL_D1_READ_BOUND = 2;
export const CUSTOMER_BUDGET_CURRENT_CREDENTIAL_SQL = `SELECT email,role,session_version FROM users
  WHERE tenant_id=? AND id=? LIMIT 1`;
export const CUSTOMER_BUDGET_TICKET_OWNERSHIP_SQL = `SELECT customer_id,customer_email FROM tickets
  WHERE tenant_id=? AND id=? LIMIT 1`;

export type CustomerBudgetCredential = Readonly<{
  tenantId: string;
  actorId: string;
  role: 'customer';
  sessionVersion: number;
  expiresAt: number;
  email: string;
}>;
export type CustomerBudgetRequirements = Readonly<{
  /** Existing mutation snapshot, retained for its canonical commit fence. */
  ticket?: Readonly<{ id: string; customerId: string | null; customerEmail: string }>;
  /** Read routes supply only an opaque target; current ownership is resolved here before any business read. */
  readTicketId?: string;
}>;

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 320) return null;
  const normalized = value.trim().toLowerCase();
  return normalized && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Current-customer admission gate. It is intentionally independent from the
 * staff session adapter: customers have neither staff roles nor MFA/group
 * requirements, but they do require live tenant, role, session, email and
 * ticket-ownership evidence before a prepaid block may be spent.
 */
export class CustomerCurrentCredentialRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async authorize(credential: CustomerBudgetCredential, requirements: CustomerBudgetRequirements, now: number): Promise<BudgetAuthorityPrincipal | null> {
    const email = normalizedEmail(credential.email);
    if (credential.tenantId !== this.scope.tenantId || credential.actorId !== this.scope.actorId
      || credential.role !== 'customer' || !this.scope.roles.includes('customer')
      || !Number.isSafeInteger(credential.sessionVersion) || credential.sessionVersion < 0
      || credential.sessionVersion !== this.scope.authVersion || !Number.isSafeInteger(credential.expiresAt)
      || !Number.isSafeInteger(now) || now < 0 || credential.expiresAt <= now / 1_000 || !email) return null;

    const user = await this.db.prepare(CUSTOMER_BUDGET_CURRENT_CREDENTIAL_SQL)
      .bind(this.scope.tenantId, this.scope.actorId).first<{ email: string; role: string; session_version: number }>();
    if (!user || user.role !== 'customer' || user.session_version !== credential.sessionVersion
      || normalizedEmail(user.email) !== email) return null;

    if (requirements.ticket && requirements.readTicketId !== undefined) return null;
    if (requirements.ticket) {
      const requiredEmail = normalizedEmail(requirements.ticket.customerEmail);
      if (!safeId(requirements.ticket.id) || !requiredEmail || (requirements.ticket.customerId !== null && requirements.ticket.customerId !== credential.actorId)) return null;
      const ticket = await this.currentOwner(requirements.ticket.id, email);
      if (!ticket || ticket.customer_id !== requirements.ticket.customerId || normalizedEmail(ticket.customer_email) !== requiredEmail) return null;
    }
    if (requirements.readTicketId !== undefined && (!safeId(requirements.readTicketId)
      || !await this.currentOwner(requirements.readTicketId, email))) return null;
    return { kind: 'session', sessionVersion: credential.sessionVersion };
  }

  private async currentOwner(ticketId: string, email: string): Promise<{ customer_id: string | null; customer_email: string } | null> {
    const ticket = await this.db.prepare(CUSTOMER_BUDGET_TICKET_OWNERSHIP_SQL)
      .bind(this.scope.tenantId, ticketId).first<{ customer_id: string | null; customer_email: string }>();
    if (!ticket || normalizedEmail(ticket.customer_email) !== email
      || (ticket.customer_id !== null && ticket.customer_id !== this.scope.actorId)) return null;
    return ticket;
  }
}
