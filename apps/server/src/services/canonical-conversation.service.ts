import { Article, Attachment, Ticket } from '../types';
import {
  ArticleWithCanonicalAttachments,
  CanonicalAttachmentReference,
  CanonicalConversation,
  CanonicalFact,
  CanonicalMessage,
  CanonicalParticipant,
} from '../types/canonical-conversation';

const known = <T>(value: T): CanonicalFact<T> => ({ status: 'known', value });
const notRecorded = <T = never>(): CanonicalFact<T> => ({ status: 'not-recorded' });
const notApplicable = <T = never>(): CanonicalFact<T> => ({ status: 'not-applicable' });
const unknown = <T = never>(): CanonicalFact<T> => ({ status: 'unknown' });

function ticketRequester(ticket: Ticket): CanonicalParticipant {
  if ((ticket.source === 'portal' || ticket.source === 'widget') && ticket.customer_id) {
    return {
      kind: 'authenticated-customer',
      id: known(ticket.customer_id),
      email: known(ticket.customer_email),
      provenance: 'authenticated-customer',
    };
  }
  return {
    kind: 'declared-requester',
    id: notRecorded(),
    email: ticket.customer_email ? known(ticket.customer_email) : notRecorded(),
    provenance: 'declared-requester',
  };
}

function supportRecipient(): CanonicalParticipant {
  return {
    kind: 'tenant-support',
    id: notRecorded(),
    email: notRecorded(),
    provenance: 'verified-tenant-scope',
  };
}

function unknownParticipant(): CanonicalParticipant {
  return { kind: 'unknown', id: unknown(), email: unknown(), provenance: 'not-recorded' };
}

function messageAuthor(ticket: Ticket, article: Article): CanonicalParticipant {
  if (article.sender_type === 'customer' && article.intake_source === 'portal' && article.sender_id) {
    return {
      kind: 'authenticated-customer',
      id: known(article.sender_id),
      email: ticket.customer_email ? known(ticket.customer_email) : notRecorded(),
      provenance: 'authenticated-customer',
    };
  }
  if (article.sender_type === 'customer' && article.intake_source === 'widget' && article.sender_id) {
    return {
      kind: 'authenticated-customer',
      id: known(article.sender_id),
      email: ticket.customer_email ? known(ticket.customer_email) : notRecorded(),
      provenance: 'authenticated-customer',
    };
  }
  if (article.sender_type === 'customer' && article.intake_source === 'api') {
    return {
      kind: 'declared-requester',
      id: notRecorded(),
      email: ticket.customer_email ? known(ticket.customer_email) : notRecorded(),
      provenance: 'declared-requester',
    };
  }
  const recordedKind = article.sender_type === 'customer'
    ? 'recorded-customer'
    : article.sender_type === 'agent' ? 'recorded-agent'
    : article.sender_type === 'system' ? 'recorded-system'
    : null;
  if (!recordedKind) return unknownParticipant();
  return {
    kind: recordedKind,
    id: article.sender_id ? known(article.sender_id) : notRecorded(),
    email: notRecorded(),
    provenance: 'stored-article',
  };
}

function attachmentReference(attachment: Attachment): CanonicalAttachmentReference {
  return {
    id: attachment.id,
    fileName: attachment.file_name,
    fileSize: attachment.file_size,
    contentType: attachment.content_type,
    localReference: known(attachment.id),
    // An R2 key is an internal storage implementation detail, never a public canonical reference.
    contentReference: notRecorded(),
  };
}

function projectMessage(ticket: Ticket, article: ArticleWithCanonicalAttachments): CanonicalMessage {
  const isSupportedCustomerIntake = article.sender_type === 'customer'
    && (article.intake_source === 'api' || article.intake_source === 'portal' || article.intake_source === 'widget');
  const direction = article.is_internal || !isSupportedCustomerIntake
    ? unknown<'inbound' | 'outbound'>()
    : known<'inbound' | 'outbound'>('inbound');
  const delivery = article.is_internal || isSupportedCustomerIntake
    ? notApplicable()
    : notRecorded();

  return {
    id: article.id,
    conversationId: ticket.id,
    localCorrelation: known({ ticketId: ticket.id, articleId: article.id }),
    source: article.intake_source ? known(article.intake_source) : notRecorded(),
    author: messageAuthor(ticket, article),
    // A customer-originated message has a logical support destination. A
    // public agent/system row alone never proves an external recipient.
    recipient: isSupportedCustomerIntake ? supportRecipient() : unknownParticipant(),
    direction,
    visibility: article.is_internal ? 'internal' : 'public',
    state: { persistence: 'persisted' },
    content: {
      body: typeof article.body === 'string'
        ? known(article.body)
        : article.body_r2_key ? unknown() : notRecorded(),
      localReference: known(article.id),
    },
    attachments: (article.attachments || []).map(attachmentReference),
    identifiers: {
      local: known({ articleId: article.id }),
      emailCompatibility: article.raw_email_id ? known(article.raw_email_id) : notRecorded(),
      external: notRecorded(),
      correlation: known({ ticketId: ticket.id, articleId: article.id }),
    },
    timestamps: {
      persistedAt: known(article.created_at),
      receivedAt: article.received_at ? known(article.received_at) : notRecorded(),
      processedAt: article.processed_at ? known(article.processed_at) : notRecorded(),
      occurredAt: notRecorded(),
    },
    delivery,
    audit: notRecorded(),
  };
}

/**
 * Creates a public, provider-neutral projection from already authorised records.
 * Callers must filter internal articles and authorise attachment metadata first.
 */
export function projectCanonicalConversation(
  ticket: Ticket,
  articles: ArticleWithCanonicalAttachments[],
): CanonicalConversation {
  const local = { ticketId: ticket.id };
  const ticketNumber = Number.isInteger(ticket.ticket_no)
    ? known(ticket.ticket_no)
    : notRecorded<number>();
  return {
    conversation: {
      id: ticket.id,
      subject: ticket.subject,
      localCorrelation: known(local),
      ticketNumber,
      source: ticket.source,
      workflow: { state: ticket.status, priority: ticket.priority },
      requester: ticketRequester(ticket),
      recipient: supportRecipient(),
      identifiers: { local: known(local), external: notRecorded(), correlation: known(local) },
      timestamps: {
        persistedAt: known(ticket.created_at),
        updatedAt: known(ticket.updated_at),
        intakeReceivedAt: ticket.intake_received_at ? known(ticket.intake_received_at) : notRecorded(),
        intakeProcessedAt: ticket.intake_processed_at ? known(ticket.intake_processed_at) : notRecorded(),
        occurredAt: notRecorded(),
      },
      delivery: notApplicable(),
      audit: notRecorded(),
    },
    messages: articles.map(article => projectMessage(ticket, article)),
  };
}
