import { Article, Attachment, Ticket } from '.';
import type { ArticleBodyFormat } from '@luminatick/shared';

/** Facts that Tocyn has recorded, rather than assumptions about a channel. */
export type CanonicalFact<T> =
  | { status: 'known'; value: T }
  | { status: 'unknown' | 'not-recorded' | 'not-applicable' };

export type CanonicalParticipant = {
  kind: 'authenticated-customer' | 'declared-requester' | 'tenant-support' | 'recorded-customer' | 'recorded-agent' | 'recorded-system' | 'unknown';
  id: CanonicalFact<string>;
  email: CanonicalFact<string>;
  provenance: 'authenticated-customer' | 'declared-requester' | 'verified-tenant-scope' | 'stored-article' | 'not-recorded';
};

export type CanonicalAttachmentReference = {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  localReference: CanonicalFact<string>;
  contentReference: CanonicalFact<never>;
};

export type CanonicalMessage = {
  id: string;
  conversationId: string;
  localCorrelation: CanonicalFact<{ ticketId: string; articleId: string }>;
  source: CanonicalFact<Ticket['source']>;
  author: CanonicalParticipant;
  recipient: CanonicalParticipant;
  direction: CanonicalFact<'inbound' | 'outbound'>;
  visibility: 'public' | 'internal';
  state: { persistence: 'persisted' };
  content: {
    body: CanonicalFact<string>;
    format: CanonicalFact<ArticleBodyFormat>;
    localReference: CanonicalFact<string>;
  };
  attachments: CanonicalAttachmentReference[];
  identifiers: {
    local: CanonicalFact<{ articleId: string }>;
    emailCompatibility: CanonicalFact<string>;
    external: CanonicalFact<never>;
    correlation: CanonicalFact<{ ticketId: string; articleId: string }>;
  };
  timestamps: {
    persistedAt: CanonicalFact<string>;
    receivedAt: CanonicalFact<string>;
    processedAt: CanonicalFact<string>;
    occurredAt: CanonicalFact<never>;
  };
  delivery: CanonicalFact<never>;
  audit: CanonicalFact<{eventId:string}>;
};

export type CanonicalConversation = {
  conversation: {
    id: string;
    subject: string;
    localCorrelation: CanonicalFact<{ ticketId: string }>;
    ticketNumber: CanonicalFact<number>;
    source: Ticket['source'];
    workflow: { state: Ticket['status']; priority: Ticket['priority'] };
    requester: CanonicalParticipant;
    recipient: CanonicalParticipant;
    identifiers: {
      local: CanonicalFact<{ ticketId: string }>;
      external: CanonicalFact<never>;
      correlation: CanonicalFact<{ ticketId: string }>;
    };
    timestamps: {
      persistedAt: CanonicalFact<string>;
      updatedAt: CanonicalFact<string>;
      intakeReceivedAt: CanonicalFact<string>;
      intakeProcessedAt: CanonicalFact<string>;
      occurredAt: CanonicalFact<never>;
    };
    delivery: CanonicalFact<never>;
    audit: CanonicalFact<{eventId:string}>;
  };
  messages: CanonicalMessage[];
};

export type ArticleWithCanonicalAttachments = Article & { attachments?: Attachment[] };
