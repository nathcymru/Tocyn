import { REPLY_ATTACHMENT_RULES, type ReplyCapabilityV1 } from '@luminatick/shared';

/** Current dashboard reply behavior, without provider or recipient disclosure. */
export function replyCapability(ticketId: string): ReplyCapabilityV1 {
  return {
    version: 1,
    ticketId,
    modes: [
      {
        visibility: 'public',
        channel: 'email',
        delivery: 'email_attempted',
        recipient: 'ticket_customer',
        record: 'ticket_article',
        body: { format: 'stored_text', maxCharacters: 16000 },
        attachments: REPLY_ATTACHMENT_RULES,
      },
      {
        visibility: 'internal',
        channel: 'internal',
        delivery: 'recorded_only',
        recipient: null,
        record: 'ticket_article',
        body: { format: 'stored_text', maxCharacters: 16000 },
        attachments: REPLY_ATTACHMENT_RULES,
      },
    ],
  };
}
