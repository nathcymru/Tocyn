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

export class ConversationAuditRepository {
  constructor(private db: D1Database, private scope: VerifiedTenantScope, private admission?: LocalBetaAdmissionRepository, private canonicalMutationSli?: RequestCanonicalMutationSli) {}

  async history(ticketId: string, publicOnly: boolean, limit: number, cursor?: string) {
    const visible = publicOnly ? `AND e.visibility='public' AND e.kind IN ('ticket.intake','message.reply')
      AND ((e.kind='ticket.intake' AND e.article_id IS NULL) OR EXISTS
        (SELECT 1 FROM articles a WHERE a.tenant_id=e.tenant_id AND a.id=e.article_id AND a.ticket_id=e.ticket_id AND a.is_internal=0))` : '';
    let after = 0;
    if (cursor) {
      const row = await this.db.prepare(`SELECT e.sequence FROM conversation_events e
        WHERE e.tenant_id=? AND e.ticket_id=? AND e.id=? ${visible}`)
        .bind(this.scope.tenantId,ticketId,cursor).first<{ sequence: number }>();
      if (!row) return null;
      after = row.sequence;
    }
    const result = await this.db.prepare(`SELECT e.* FROM conversation_events e
      WHERE e.tenant_id=? AND e.ticket_id=? AND e.sequence>? ${visible} ORDER BY e.sequence LIMIT ?`)
      .bind(this.scope.tenantId,ticketId,after,limit+1).all<ConversationEvent>();
    const more = result.results.length > limit;
    const rows = result.results.slice(0,limit);
    return { rows, nextCursor: more ? rows[rows.length-1].id : null };
  }

  async references(ticketId: string, articleIds?: readonly string[]) {
    if (articleIds && articleIds.length > 50) throw new Error('Bounded reference page required');
    // Intake belongs to the conversation, even when its initial message is on another page.
    const visibleIntake = `(kind='ticket.intake' AND (article_id IS NULL OR EXISTS (
      SELECT 1 FROM articles a WHERE a.tenant_id=conversation_events.tenant_id
      AND a.ticket_id=conversation_events.ticket_id AND a.id=conversation_events.article_id AND a.is_internal=0)))`;
    const selectedArticles = articleIds?.length ? ` OR article_id IN (${articleIds.map(() => '?').join(',')})` : '';
    const boundedReferences = articleIds ? `AND (${visibleIntake}${selectedArticles})` : '';
    const result = await this.db.prepare(`SELECT id,article_id,kind FROM conversation_events
      WHERE tenant_id=? AND ticket_id=? AND kind IN ('ticket.intake','message.reply') AND visibility='public'
      ${boundedReferences} ORDER BY sequence ${articleIds ? 'LIMIT 51' : ''}`)
      .bind(this.scope.tenantId, ticketId, ...(articleIds ?? []))
      .all<Pick<ConversationEvent, 'id' | 'article_id' | 'kind'>>();
    return result.results;
  }

  async updateWithEvents(id: string, data: AuditedTicketUpdate, actor: ConversationActor, retainSystemNote = false): Promise<AuditedTicketUpdateOutcome> {
    const statements: D1PreparedStatement[] = [...(this.admission?.ticketChangeStatements(id,data)??[])];
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
      statements.push(this.db.prepare(`INSERT INTO conversation_events (${columns})
        SELECT t.tenant_id,?,t.id,NULL,${sequence},?,?,?,?,?,'internal',
          json_object('before',json_object(${before}),'after',json_object(${after}))
        FROM tickets t WHERE t.tenant_id=? AND t.id=? AND (${changes.map(key => `t.${key} IS NOT ?`).join(' OR ')})`)
        .bind(eventId,category.kind,actor.kind,actor.id,provenance(actor),actor.source,
          ...category.keys.filter(key => data[key] !== undefined).map(value),this.scope.tenantId,id,...changes.map(value)));
    }
    // The compatibility note is generated only from transaction-captured changes.
    if (retainSystemNote && eventIds.length) {
      statements.push(this.db.prepare(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal)
        SELECT ?,?,?,?,'system',group_concat(CASE kind WHEN 'ticket.assignment_changed' THEN 'Assignment updated'
          ELSE trim(
            CASE WHEN json_extract(facts,'$.before.status') IS NOT json_extract(facts,'$.after.status')
              THEN 'Status changed from ' || json_extract(facts,'$.before.status') || ' to ' || json_extract(facts,'$.after.status') || '. ' ELSE '' END ||
            CASE WHEN json_extract(facts,'$.before.priority') IS NOT json_extract(facts,'$.after.priority')
              THEN 'Priority changed from ' || json_extract(facts,'$.before.priority') || ' to ' || json_extract(facts,'$.after.priority') || '.' ELSE '' END)
          END,'; '),1
        FROM conversation_events WHERE tenant_id=? AND ticket_id=? AND id IN (${eventIds.map(() => '?').join(',')}) HAVING count(*)>0`)
        .bind(this.scope.tenantId,crypto.randomUUID(),id,actor.id,this.scope.tenantId,id,...eventIds));
    }
    if (retainSystemNote && data.custom_fields !== undefined) {
      statements.push(this.db.prepare(`INSERT INTO articles (tenant_id,id,ticket_id,sender_id,sender_type,body,is_internal)
        SELECT tenant_id,?,id,?,'system','Custom fields updated',1 FROM tickets
        WHERE tenant_id=? AND id=? AND custom_fields IS NOT ?`)
        .bind(crypto.randomUUID(),actor.id,this.scope.tenantId,id,value('custom_fields')));
    }
    const updateIndex = supplied.length ? statements.length : undefined;
    if (updateIndex !== undefined) {
      statements.push(this.db.prepare(`UPDATE tickets SET ${supplied.map(key => `${key}=?`).join(',')},updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND id=? AND (${supplied.map(key => `${key} IS NOT ?`).join(' OR ')}) RETURNING id`)
        .bind(...supplied.map(value),this.scope.tenantId,id,...supplied.map(value)));
    }
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
