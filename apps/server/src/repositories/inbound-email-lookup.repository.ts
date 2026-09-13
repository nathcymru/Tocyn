import type { D1Database } from '@cloudflare/workers-types';
import type { VerifiedTenantScope } from '../types/tenant';

export type InboundTicketParticipant=Readonly<{id:string;customer_id:string|null;customer_email:string}>;

/** Internal already-admitted lookup path. Only indexed, bounded projections are
 * returned; raw article bodies and ticket custom fields are never loaded. */
export class InboundEmailLookupRepository {
  constructor(private readonly db:D1Database,private readonly scope:VerifiedTenantScope) {
    if(!scope.roles.includes('system') || scope.actorId!=='inbound-email')throw new Error('Invalid inbound lookup scope');
  }

  async ticket(subject:string,references:readonly string[]):Promise<InboundTicketParticipant|null> {
    if(new TextEncoder().encode(subject).byteLength>2048 || references.length>20
      || references.some(value=>value.length>256))throw new Error('Invalid inbound lookup');
    const subjects=await this.db.prepare(`SELECT id,customer_id,customer_email FROM tickets
      INDEXED BY idx_tickets_inbound_subject WHERE tenant_id=? AND subject=? ORDER BY id LIMIT 2`)
      .bind(this.scope.tenantId,subject).all<InboundTicketParticipant>();
    // An ambiguous subject cannot silently choose a different conversation.
    if(subjects.results.length>1)throw new Error('Ambiguous inbound subject');
    if(subjects.results[0])return subjects.results[0];
    for(const reference of references){
      const matches=await this.db.prepare(`SELECT ticket_id FROM articles INDEXED BY idx_articles_inbound_message
        WHERE tenant_id=? AND raw_email_id=? ORDER BY ticket_id LIMIT 2`)
        .bind(this.scope.tenantId,reference).all<{ticket_id:string}>();
      if(matches.results.length>1)throw new Error('Ambiguous inbound reference');
      if(matches.results[0]){
        const ticket=await this.db.prepare('SELECT id,customer_id,customer_email FROM tickets WHERE tenant_id=? AND id=?')
          .bind(this.scope.tenantId,matches.results[0].ticket_id).first<InboundTicketParticipant>();
        if(ticket)return ticket;
      }
    }
    return null;
  }

  async recentSenderLimitReached(sender:string,cutoff:string):Promise<boolean> {
    if(!sender || sender.length>320 || !Number.isFinite(Date.parse(cutoff)))throw new Error('Invalid inbound sender');
    const user=await this.db.prepare('SELECT id FROM users WHERE tenant_id=? AND email=?')
      .bind(this.scope.tenantId,sender).first<{id:string}>();
    if(!user)return false;
    const count=await this.db.prepare(`SELECT count(*) AS count FROM (SELECT 1 FROM articles
      INDEXED BY idx_articles_inbound_customer_time WHERE tenant_id=? AND sender_id=? AND sender_type='customer'
        AND unixepoch(created_at)>unixepoch(?) LIMIT 21)`).bind(this.scope.tenantId,user.id,cutoff).first<{count:number}>();
    return (count?.count??0)>20;
  }
}
