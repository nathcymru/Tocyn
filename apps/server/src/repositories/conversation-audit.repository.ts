import { BetaAdmissionError } from '../types/local-beta';
import type { LocalBetaAdmissionRepository } from './local-beta-admission.repository';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';
import type { Ticket } from '../types';
import type { AuditedTicketUpdate, ConversationActor, ConversationEvent } from '../types/conversation-audit';
import type { RequestCanonicalMutationSli } from '../observability/request-canonical-mutation-sli';

const provenance = (actor: ConversationActor) => actor.kind === 'staff' ? 'mfa-staff' : actor.kind === 'customer' ? 'authenticated-customer' : 'api-key';
const sequence = '(SELECT COALESCE(MAX(e.sequence),0)+1 FROM conversation_events e WHERE e.tenant_id=t.tenant_id AND e.ticket_id=t.id)';
const columns = 'tenant_id,id,ticket_id,article_id,sequence,kind,actor_kind,actor_id,actor_provenance,source,visibility,facts';
/** Fixed intake/reply statement, used only within the owning mutation's D1 batch. */
export function conversationMutationEvent(db: D1Database, scope: VerifiedTenantScope, input: {
  id: string; ticketId: string; articleId?: string; actor: ConversationActor; intake: boolean; internal: boolean;
}): D1PreparedStatement {
  const facts = input.intake
    ? "json_object('initial',json_object('status',t.status,'priority',t.priority,'assignedTo',t.assigned_to,'groupId',t.group_id))"
    : "json_object()";
  return db.prepare(`INSERT INTO conversation_events (${columns})
    SELECT t.tenant_id,?,t.id,?,${sequence},?,?,?,?,?,?,${facts}
    FROM tickets t WHERE t.tenant_id=? AND t.id=?`)
    .bind(input.id,input.articleId ?? null,input.intake ? 'ticket.intake' : 'message.reply',
      input.actor.kind,input.actor.id,provenance(input.actor),input.actor.source,input.internal ? 'internal' : 'public',scope.tenantId,input.ticketId);
}

export type AuditedTicketUpdateOutcome = Readonly<{ ticket: Ticket | null; changed: boolean }>;

/**
 * The update event statements are shared by ordinary audited PATCH and the
 * replay-protected API PATCH. The caller places its authority and receipt
 * fences around this exact sequence in one D1 batch.
 */
export function auditedTicketUpdateStatements(db: D1Database, scope: VerifiedTenantScope,
  admission: LocalBetaAdmissionRepository | undefined, id: string, data: AuditedTicketUpdate,
  actor: ConversationActor, retainSystemNote = false): { statements: D1PreparedStatement[]; updateIndex?: number } {
  const statements: D1PreparedStatement[] = [...(admission?.ticketChangeStatements(id,data as unknown as Partial<Pick<Ticket,
    'status' | 'priority' | 'assigned_to' | 'group_id' | 'custom_fields'>>)??[])];
  const eventIds: string[] = [];
  const allKeys = ['status','priority','assigned_to','group_id','custom_fields'] as const;
  const supplied = allKeys.filter(key => data[key] !== undefined);
  const value = (key: typeof allKeys[number]) => key === 'custom_fields' && data[key] !== null && typeof data[key] !== 'string'
    ? JSON.stringify(data[key]) : data[key] ?? null;
  for (const category of [
    { kind: 'ticket.assignment_changed', keys: ['assigned_to','group_id'] as const, names: ['assignedTo','groupId'] },
    { kind: 'ticket.state_changed', keys: ['status','priority'] as const, names: ['status','priority'] },
  ]) {
    const changes = category.keys.filter(key => data[key] !== undefined);
    if (!changes.length) continue;
    const eventId = crypto.randomUUID(); eventIds.push(eventId);
    const before = category.keys.map((key,index) => `'${category.names[index]}',t.${key}`).join(',');
    const after = category.keys.map((key,index) => `'${category.names[index]}',${data[key] === undefined ? `t.${key}` : '?'}`).join(',');
    statements.push(db.prepare(`INSERT INTO conversation_events (${columns})
      SELECT t.tenant_id,?,t.id,NULL,${sequence},?,?,?,?,?,'internal',
        json_object('before',json_object(${before}),'after',json_object(${after}))
      FROM tickets t WHERE t.tenant_id=? AND t.id=? AND (${changes.map(key => `t.${key} IS NOT ?`).join(' OR ')})`)
      .bind(eventId,category.kind,actor.kind,actor.id,provenance(actor),actor.source,
        ...category.keys.filter(key => data[key] !== undefined).map(value),scope.tenantId,id,...changes.map(value)));
  }
  if (retainSystemNote && eventIds.length) {
    statements.push(db.prepare(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal)
      SELECT ?,?,?,?,'system',group_concat(CASE kind WHEN 'ticket.assignment_changed' THEN 'Assignment updated'
        ELSE trim(
          CASE WHEN json_extract(facts,'$.before.status') IS NOT json_extract(facts,'$.after.status')
            THEN 'Status changed from ' || json_extract(facts,'$.before.status') || ' to ' || json_extract(facts,'$.after.status') || '. ' ELSE '' END ||
          CASE WHEN json_extract(facts,'$.before.priority') IS NOT json_extract(facts,'$.after.priority')
            THEN 'Priority changed from ' || json_extract(facts,'$.before.priority') || ' to ' || json_extract(facts,'$.after.priority') || '.' ELSE '' END)
        END,'; '),1
      FROM conversation_events WHERE tenant_id=? AND ticket_id=? AND id IN (${eventIds.map(() => '?').join(',')}) HAVING count(*)>0`)
      .bind(scope.tenantId,crypto.randomUUID(),id,actor.id,scope.tenantId,id,...eventIds));
  }
  if (retainSystemNote && data.custom_fields !== undefined) {
    statements.push(db.prepare(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal)
      SELECT tenant_id,?,id,?,'system','Custom fields updated',1 FROM tickets
      WHERE tenant_id=? AND id=? AND custom_fields IS NOT ?`)
      .bind(crypto.randomUUID(),actor.id,scope.tenantId,id,value('custom_fields')));
  }
  const updateIndex = supplied.length ? statements.length : undefined;
  if (updateIndex !== undefined) {
    statements.push(db.prepare(`UPDATE tickets SET ${supplied.map(key => `${key}=?`).join(',')},updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=? AND id=? AND (${supplied.map(key => `${key} IS NOT ?`).join(' OR ')}) RETURNING id`)
      .bind(...supplied.map(value),scope.tenantId,id,...supplied.map(value)));
  }
  return { statements, updateIndex };
}

export class ConversationAuditRepository {
  constructor(private db: D1Database, private scope: VerifiedTenantScope, private admission?: LocalBetaAdmissionRepository, private canonicalMutationSli?: RequestCanonicalMutationSli) {}

  /** Current full sequence is used only by an explicit, already-authorized draft rebase review. */
  async currentRevision(ticketId: string): Promise<number> {
    const row = await this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS revision FROM conversation_events WHERE tenant_id=? AND ticket_id=?')
      .bind(this.scope.tenantId, ticketId).first<{ revision: number }>();
    return row?.revision ?? 0;
  }

  async history(ticketId: string, publicOnly: boolean, limit: number, cursor?: string) {
    let after = 0;
    if (cursor) {
      const row = publicOnly
        ? await this.db.prepare(`SELECT sequence FROM conversation_public_history
          WHERE tenant_id=? AND ticket_id=? AND event_id=?`).bind(this.scope.tenantId,ticketId,cursor).first<{ sequence: number }>()
        : await this.db.prepare(`SELECT sequence FROM conversation_events
          WHERE tenant_id=? AND ticket_id=? AND id=?`).bind(this.scope.tenantId,ticketId,cursor).first<{ sequence: number }>();
      if (!row) return null;
      after = row.sequence;
    }
    const result = publicOnly
      ? await this.db.prepare(`SELECT e.* FROM conversation_public_history p
          JOIN conversation_events e ON e.tenant_id=p.tenant_id AND e.id=p.event_id
          WHERE p.tenant_id=? AND p.ticket_id=? AND p.sequence>? ORDER BY p.sequence LIMIT ?`)
        .bind(this.scope.tenantId,ticketId,after,limit+1).all<ConversationEvent>()
      : await this.db.prepare(`SELECT e.* FROM conversation_events e
          WHERE e.tenant_id=? AND e.ticket_id=? AND e.sequence>? ORDER BY e.sequence LIMIT ?`)
        .bind(this.scope.tenantId,ticketId,after,limit+1).all<ConversationEvent>();
    const more = result.results.length > limit;
    const rows = result.results.slice(0,limit);
    return { rows, nextCursor: more ? rows[rows.length-1].id : null };
  }

  async references(ticketId: string, articleIds?: readonly string[]) {
    // Existing dashboard/customer projections retain their historical full
    // conversation contract until those endpoints adopt an explicit page.
    if (!articleIds) {
      const result = await this.db.prepare(`SELECT id,article_id,kind FROM conversation_events
        WHERE tenant_id=? AND ticket_id=? AND visibility='public'
        ORDER BY sequence`).bind(this.scope.tenantId, ticketId).all<Pick<ConversationEvent, 'id' | 'article_id' | 'kind'>>();
      return result.results;
    }
    if (articleIds.length > 50) throw new Error('Bounded reference page required');
    const placeholders = articleIds.map(() => '?').join(',');
    // The intake is a ticket-level fact: retain it on every article page. The
    // keyed event index finds it without scanning public replies, while the
    // projection point lookup proves its article is still currently public.
    const intake = this.db.prepare(`SELECT e.id,e.article_id,e.kind FROM conversation_events e
      WHERE e.tenant_id=? AND e.ticket_id=? AND e.kind='ticket.intake' AND e.visibility='public'
        AND EXISTS (SELECT 1 FROM conversation_public_history p WHERE p.tenant_id=e.tenant_id AND p.event_id=e.id)
      ORDER BY e.sequence LIMIT 2`).bind(this.scope.tenantId, ticketId);
    const replies = articleIds.length ? this.db.prepare(`SELECT e.id,e.article_id,e.kind FROM conversation_events e
      WHERE e.tenant_id=? AND e.ticket_id=? AND e.kind='message.reply' AND e.article_id IN (${placeholders})
        AND EXISTS (SELECT 1 FROM conversation_public_history p WHERE p.tenant_id=e.tenant_id AND p.event_id=e.id)
      LIMIT 51`).bind(this.scope.tenantId, ticketId, ...articleIds) : null;
    const result = replies ? await this.db.batch([intake, replies]) : await this.db.batch([intake]);
    return result.flatMap(row => row.results as Pick<ConversationEvent, 'id' | 'article_id' | 'kind'>[]);
  }

  async updateWithEvents(id: string, data: AuditedTicketUpdate, actor: ConversationActor, retainSystemNote = false): Promise<AuditedTicketUpdateOutcome> {
    const { statements, updateIndex } = auditedTicketUpdateStatements(this.db,this.scope,this.admission,id,data,actor,retainSystemNote);
    statements.push(this.db.prepare('SELECT * FROM tickets WHERE tenant_id=? AND id=?').bind(this.scope.tenantId,id));
    let result;
    this.canonicalMutationSli?.recordAttempt();
    try { result = await this.db.batch<Ticket>(statements); }
    catch(error) {
      this.canonicalMutationSli?.recordUncertain();
      if(this.admission) { await this.admission.authorize('conversation'); throw new BetaAdmissionError('beta_admission_unavailable',503); }
      throw error;
    }
    if (result.length !== statements.length || !Array.isArray(result[result.length - 1]?.results) || (updateIndex !== undefined && !Array.isArray(result[updateIndex]?.results))) {
      this.canonicalMutationSli?.recordUncertain();
      throw new Error('Audited mutation result unavailable');
    }
    const changed = updateIndex !== undefined && Boolean(result[updateIndex]?.results[0]);
    changed ? this.canonicalMutationSli?.recordDurablyCompleted() : this.canonicalMutationSli?.recordNoOp();
    return { ticket: result[result.length-1]?.results[0] ?? null, changed };
  }
}
