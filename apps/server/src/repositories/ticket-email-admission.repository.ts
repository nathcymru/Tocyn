import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { TicketEmailCanonicalGrant } from '../services/email/ticket-email-admission.service';
import type { BudgetCommitAuthority } from '../budgets/isolate-admission.service';
import type { SessionBudgetCredential } from './session-budget-authority.repository';
import { staffMutationStatements } from './staff-ticket-mutation.repository';
import { budgetGrantOperationStatements } from './budget-commit-fence';

export type TicketEmailDeliveryCommit = Readonly<{
  credential: SessionBudgetCredential;
  source: TicketEmailCanonicalGrant;
  authority: BudgetCommitAuthority;
}>;

export const TICKET_EMAIL_ATTACHMENT_MANIFEST_SQL = `SELECT json_group_array(json_array(id,file_name,file_size,content_type,r2_key)) FROM
      (SELECT id,file_name,file_size,content_type,r2_key FROM attachments INDEXED BY idx_attachments_retention_cursor WHERE tenant_id=? AND article_id=? ORDER BY id COLLATE BINARY LIMIT 11)`;

function exactCanonicalMessage(scope: VerifiedTenantScope, grant: TicketEmailCanonicalGrant): { sql: string; values: unknown[] } {
  const ticket = grant.ticket, article = grant.article;
  const manifest = JSON.stringify([...grant.attachments].sort((left,right)=>left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map(item=>[item.id,item.fileName,item.fileSize,item.contentType,item.r2Key]));
  const sql = `EXISTS (SELECT 1 FROM tickets t JOIN articles a ON a.tenant_id=t.tenant_id AND a.ticket_id=t.id
    WHERE t.tenant_id=? AND t.id=? AND t.ticket_no IS ? AND t.subject=? AND t.customer_email=? AND t.group_id IS ? AND t.source_email IS ?
      AND a.id=? AND a.body=? AND a.body_format=? AND a.is_internal=0)
    AND (${TICKET_EMAIL_ATTACHMENT_MANIFEST_SQL})=?`;
  const values: unknown[] = [scope.tenantId,ticket.id,ticket.ticketNo,ticket.subject,ticket.customerEmail,ticket.groupId,ticket.sourceEmail,
    article.id,article.body,article.bodyFormat,scope.tenantId,article.id,manifest];
  return { sql: `(${sql})`, values };
}

function unclaimedDelivery(scope: VerifiedTenantScope, authority: BudgetCommitAuthority): { sql: string; values: unknown[] } {
  const grant = authority.grant;
  return { sql: `NOT EXISTS (SELECT 1 FROM budget_grant_operations
      WHERE tenant_id=? AND reservation_id=? AND holder_id=? AND operation_id=?)`,
    values: [scope.tenantId,grant?.reservationId ?? '',grant?.holderId ?? '',grant?.operationId ?? ''] };
}

/**
 * Atomically freezes current staff/group/policy authority, the source canonical
 * winner, its exact public message, and the separately reserved delivery
 * operation. A grant can be claimed once even if the D1 acknowledgement is lost.
 */
export class TicketEmailAdmissionRepository {
  constructor(private readonly db: D1Database, private readonly scope: VerifiedTenantScope) {}

  async claim(commit: TicketEmailDeliveryCommit): Promise<void> {
    const canonical = exactCanonicalMessage(this.scope,commit.source);
    const unclaimed = unclaimedDelivery(this.scope,commit.authority);
    const precondition = { sql: `${unclaimed.sql} AND ${canonical.sql}`,
      values: [...unclaimed.values,...canonical.values] };
    const current = staffMutationStatements(this.db,this.scope,{ credential:commit.credential,
      requirements:{ticket:{id:commit.source.ticket.id,groupId:commit.source.ticket.groupId}},authority:commit.authority },precondition)[0];
    await this.db.batch([current,...budgetGrantOperationStatements(this.db,this.scope,commit.authority)]);
  }
}
