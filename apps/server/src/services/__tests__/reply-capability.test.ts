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
          body: { maxCharacters: 16000, acceptedFormats: ['plain', 'markdown-v1'] },
          attachments: REPLY_ATTACHMENT_RULES,
        },
        {
          visibility: 'internal', channel: 'internal', delivery: 'recorded_only', recipient: null, record: 'ticket_article',
          body: { maxCharacters: 16000, acceptedFormats: ['plain', 'markdown-v1'] },
          attachments: REPLY_ATTACHMENT_RULES,
        },
      ],
    });
    expect(capability.modes.every(mode => mode.body.acceptedFormats.includes('markdown-v1'))).toBe(true);
    expect(REPLY_ATTACHMENT_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv']);
  });
});

it('advertises bounded internal mentions only when the current route enforces the durable activity contract', () => {
  const mentions = { version: 1 as const, protocol: 'internal-activity-v1' as const, maxRecipients: 16 as const };
  expect(replyCapability('ticket-1', undefined, mentions).internalMentions).toEqual(mentions);
  expect(replyCapability('ticket-1').internalMentions).toBeUndefined();
});
