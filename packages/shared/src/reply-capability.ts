import { ARTICLE_BODY_FORMATS, type ArticleBodyFormat } from '../index';

/** Reply capability names the persisted article formats accepted by the server. */
export const REPLY_ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const;

export type ReplyAttachmentContentType = typeof REPLY_ATTACHMENT_CONTENT_TYPES[number];

export const REPLY_ATTACHMENT_RULES = {
  maxCount: 10,
  maxBytesPerFile: 10_485_760,
  contentTypes: REPLY_ATTACHMENT_CONTENT_TYPES,
} as const;

export type ReplyModeCapability = Readonly<{
  visibility: 'public' | 'internal';
  channel: 'email' | 'internal';
  delivery: 'email_attempted' | 'recorded_only';
  recipient: 'ticket_customer' | null;
  record: 'ticket_article';
  body: Readonly<{ maxCharacters: 16000; acceptedFormats: readonly ArticleBodyFormat[] }>;
  attachments: typeof REPLY_ATTACHMENT_RULES;
}>;

export type ReplyCapabilityV1 = Readonly<{
  version: 1;
  ticketId: string;
  modes: readonly ReplyModeCapability[];
}>;
