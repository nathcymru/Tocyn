import { describe, expect, it } from 'vitest';
import { REPLY_ATTACHMENT_RULES } from '@luminatick/shared';
import { parseReplyCapability } from '../hooks/useReplyCapability';

const capability = () => ({ version: 1, ticketId: 'ticket', modes: [
  { visibility: 'public', channel: 'email', delivery: 'email_attempted', recipient: 'ticket_customer', record: 'ticket_article', body: { acceptedFormats: ['plain', 'markdown-v1'], maxCharacters: 16000 }, attachments: { ...REPLY_ATTACHMENT_RULES } },
  { visibility: 'internal', channel: 'internal', delivery: 'recorded_only', recipient: null, record: 'ticket_article', body: { acceptedFormats: ['plain', 'markdown-v1'], maxCharacters: 16000 }, attachments: { ...REPLY_ATTACHMENT_RULES } },
] });

describe('reply capability boundary', () => {
  it('accepts the bounded declared current ticket contract', () => {
    expect(parseReplyCapability(capability(), 'ticket').modes).toHaveLength(2);
  });
  it.each([
    (v: ReturnType<typeof capability>) => { v.ticketId = 'foreign'; },
    (v: ReturnType<typeof capability>) => { v.version = 2; },
    (v: ReturnType<typeof capability>) => { v.modes[0].body.acceptedFormats = ['html']; },
    (v: ReturnType<typeof capability>) => { v.modes[0].body.maxCharacters = 16001; },
    (v: ReturnType<typeof capability>) => { v.modes[1].visibility = 'public'; },
    (v: ReturnType<typeof capability>) => { v.modes[1].recipient = 'ticket_customer'; },
  ])('rejects a foreign, unsupported or contradictory capability', change => {
    const value = capability(); change(value);
    expect(() => parseReplyCapability(value, 'ticket')).toThrow('Reply options are unavailable');
  });
  it('rejects malformed MIME data rather than coercing it into an accepted string', () => {
    const value = JSON.parse(JSON.stringify(capability()));
    value.modes[0].attachments.contentTypes = [['text/plain']];
    expect(() => parseReplyCapability(value, 'ticket')).toThrow();
  });
});

it('accepts internal mentions only as the bounded advertised capability', () => {
  const value = capability();
  Object.assign(value, { internalMentions: { version: 1, protocol: 'internal-activity-v1', maxRecipients: 16 } });
  expect(parseReplyCapability(value, 'ticket').internalMentions).toEqual(value.internalMentions);
  Object.assign(value, { internalMentions: { version: 1, protocol: 'internal-activity-v1', maxRecipients: 17 } });
  expect(() => parseReplyCapability(value, 'ticket')).toThrow('Reply options are unavailable');
});
