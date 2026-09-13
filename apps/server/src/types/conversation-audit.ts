import type { Ticket } from './index';

export type ConversationActor = {
  kind: 'api-key' | 'customer' | 'staff';
  id: string;
  source: Extract<Ticket['source'], 'api' | 'portal' | 'widget' | 'dashboard'>;
} | { kind: 'system'; id: 'inbound-email'; source: 'email' };
export type ConversationEventKind = 'ticket.intake' | 'message.reply' | 'ticket.assignment_changed' | 'ticket.state_changed';
export type ConversationEvent = {
  tenant_id: string; id: string; ticket_id: string; article_id: string | null; sequence: number;
  schema_version: 1; kind: ConversationEventKind; recorded_at: string;
  actor_kind: ConversationActor['kind']; actor_id: string | null;
  actor_provenance: 'api-key' | 'authenticated-customer' | 'mfa-staff' | 'gateway-email';
  source: ConversationActor['source']; visibility: 'public' | 'internal'; facts: string;
};
export type ConversationAuditReference = { eventId: string; articleId: string | null };
export type AuditedTicketUpdate = Pick<Partial<Ticket>, 'status' | 'priority' | 'assigned_to' | 'group_id'> & {
  custom_fields?: Ticket['custom_fields'] | null;
};
