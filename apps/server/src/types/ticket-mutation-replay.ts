import type { Article, Attachment, Ticket } from './index';

export type MutationOperation = 'api.ticket.create' | 'api.ticket.reply' | 'portal.ticket.create' | 'portal.ticket.reply';
export type MutationPrincipal =
  | { kind: 'api-key'; id: string }
  | { kind: 'customer'; id: string; sessionVersion: number; expiresAt: number };
export type RequestedMutationAttachment = { storageKey: string; filename: string };
export type VerifiedMutationAttachment = RequestedMutationAttachment & { size: number; contentType: string };
export type TicketMutationInput =
  | {
    operation: 'api.ticket.create' | 'portal.ticket.create';
    data: {
      subject: string; customer_email?: string; body?: string;
      status?: Ticket['status']; priority?: Ticket['priority'];
      assigned_to?: string | null; group_id?: string | null; custom_fields?: Ticket['custom_fields'];
    };
  }
  | {
    operation: 'api.ticket.reply' | 'portal.ticket.reply'; ticketId: string;
    data: { body: string; sender_type?: Article['sender_type']; is_internal?: boolean; attachments?: RequestedMutationAttachment[] };
  };
export type MutationOutcome = {
  status: 201; body: Record<string, unknown>; replayed: boolean; keyed: boolean;
  ticketId: string; articleId?: string;
};
export type PreparedTicketMutation = Readonly<{ replay: MutationOutcome | null }>;
export type MutationNamespace = {
  principalKind: MutationPrincipal['kind']; principalId: string; operation: MutationOperation; keyHash: string; payloadHash: string;
};
export type MutationSnapshotV1 = { version: 1; ticket: Ticket; article: Article | null; attachments: Attachment[] };
export type MutationReceipt = {
  operation: MutationOperation; payload_hash: string; fingerprint_version: number; response_version: number;
  lifecycle: 'completed' | 'gone'; result_ticket_id: string | null; result_article_id: string | null;
  response_status: 201; response_snapshot: string | null; created_at: number; expires_at: number;
};
