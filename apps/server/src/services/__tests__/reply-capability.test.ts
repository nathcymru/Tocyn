import { describe, expect, it } from 'vitest';
import { REPLY_ATTACHMENT_CONTENT_TYPES, REPLY_ATTACHMENT_RULES, type ReplyCapabilityV1 } from '@luminatick/shared';
import { replyCapability } from '../reply-capability';

describe('replyCapability', () => {
  it('describes the two current dashboard outcomes without a recipient or format promise', () => {
    const capability: ReplyCapabilityV1 = replyCapability('ticket-1');
    expect(capability).toEqual({
      version: 1,
      ticketId: 'ticket-1',
      modes: [
        {
          visibility: 'public', channel: 'email', delivery: 'email_attempted', recipient: 'ticket_customer', record: 'ticket_article',
          body: { format: 'stored_text', maxCharacters: 16000 },
          attachments: REPLY_ATTACHMENT_RULES,
        },
        {
          visibility: 'internal', channel: 'internal', delivery: 'recorded_only', recipient: null, record: 'ticket_article',
          body: { format: 'stored_text', maxCharacters: 16000 },
          attachments: REPLY_ATTACHMENT_RULES,
        },
      ],
    });
    expect(capability.modes.every(mode => mode.body.format !== 'markdown')).toBe(true);
    expect(REPLY_ATTACHMENT_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv']);
  });
});
