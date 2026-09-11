import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { MutationCandidate } from './ticket-mutation-replay.repository';
import { DRAFT_EXPIRY_SQL } from '../types/operator-draft-retention';

/** The acknowledged draft version a staff reply is allowed to consume. */
export type StaffReplyPrecondition = Readonly<{
  ticketId: string;
  generation: string;
  revision: number;
  baseConversationRevision: number;
}>;

export type StaffReplyPreconditionConstraint = Readonly<{ sql: string; values: readonly unknown[] }>;

/** Raised only after the failed batch is boundedly reread and the retained draft no longer matches. */
export class StaffReplyPreconditionConflictError extends Error {
  constructor() { super('Draft changed before the reply could be committed'); this.name = 'StaffReplyPreconditionConflictError'; }
}

function valid(precondition: StaffReplyPrecondition, candidate: MutationCandidate): boolean {
  return !candidate.ticket && candidate.article !== undefined && candidate.articleId !== undefined
    && precondition.ticketId === candidate.ticketId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(precondition.generation)
    && Number.isSafeInteger(precondition.revision) && precondition.revision > 0
    && Number.isSafeInteger(precondition.baseConversationRevision) && precondition.baseConversationRevision >= 0;
}

/**
 * Derived only from the verified reply candidate. It checks the exact saved draft
 * (including attachment ordering) and rejects material conversation content newer
 * than the draft base. Metadata events deliberately do not require a reread.
 */
export function staffReplyPreconditionConstraint(scope: VerifiedTenantScope, candidate: MutationCandidate,
  precondition: StaffReplyPrecondition): StaffReplyPreconditionConstraint {
  if (!valid(precondition, candidate)) throw new Error('Invalid staff reply precondition');
  const article = candidate.article!;
  const attachments = JSON.stringify(candidate.attachments.map(({ storageKey, filename, size, contentType }) => ({ storageKey, filename, size, contentType })));
  const mode = article.is_internal ? 'internal' : 'public';
  const mentionedUserIds = JSON.stringify(candidate.mentionedUserIds ?? []);
  const sql = `EXISTS (SELECT 1 FROM operator_drafts d WHERE d.tenant_id=? AND d.user_id=? AND d.ticket_id=?
      AND d.generation=? AND d.revision=? AND d.base_conversation_revision=?
      AND d.mode=? AND d.body=? AND d.body_format=? AND d.attachments=? AND d.mentioned_user_ids=?
      AND ${DRAFT_EXPIRY_SQL.replaceAll('expires_at', 'd.expires_at').replaceAll('updated_at', 'd.updated_at')}>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND COALESCE((SELECT MAX(sequence) FROM conversation_events WHERE tenant_id=? AND ticket_id=? AND kind='ticket.intake'),0)<=?
    AND COALESCE((SELECT MAX(sequence) FROM conversation_events WHERE tenant_id=? AND ticket_id=? AND kind='message.reply'),0)<=?`;
  const values = [scope.tenantId, scope.actorId, precondition.ticketId, precondition.generation, precondition.revision,
    precondition.baseConversationRevision, mode, article.body ?? '', article.body_format ?? 'plain', attachments, mentionedUserIds,
    scope.tenantId, precondition.ticketId, precondition.baseConversationRevision,
    scope.tenantId, precondition.ticketId, precondition.baseConversationRevision] as const;
  return { sql, values };
}

/** A single bounded reread distinguishes a retained-draft conflict from a transient D1 failure. */
export async function staffReplyPreconditionMatches(db: D1Database, scope: VerifiedTenantScope, candidate: MutationCandidate,
  precondition: StaffReplyPrecondition): Promise<boolean> {
  const condition = staffReplyPreconditionConstraint(scope, candidate, precondition);
  const row = await db.prepare(`SELECT CASE WHEN ${condition.sql} THEN 1 ELSE 0 END AS accepted`)
    .bind(...condition.values).first<{ accepted: number }>();
  return row?.accepted === 1;
}
