import type { SendEmailOptions } from '../../types';

// Resend documents 40 MB per email, including Base64 attachments. This also
// bounds the complete submitted JSON; provider MIME processing may still reject
// a message. It is not a memory-safety proof for the buffered transport.
export const MAX_PROVIDER_EMAIL_REQUEST_BYTES = 40_000_000;
export const MAX_TICKET_EMAIL_ATTACHMENTS = 10;
export const MAX_TICKET_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class OutboundEmailPreparationError extends Error {
  constructor() { super('Email exceeds supported delivery size or contains invalid attachment metadata'); }
}

export interface EmailAttachmentEnvelope { filename: string; contentType: string; size: number }

/** Exact JSON UTF-8 size without allocating a second copy of a large body. */
function jsonBytes(value: unknown, depth = 0): number {
  if (depth > 5) throw new OutboundEmailPreparationError();
  const checked = (size: number) => {
    if (!Number.isSafeInteger(size) || size > MAX_PROVIDER_EMAIL_REQUEST_BYTES) throw new OutboundEmailPreparationError();
    return size;
  };
  if (typeof value === 'string') {
    let size = 2;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 34 || code === 92 || (code >= 8 && code <= 10 || code === 12 || code === 13)) size += 2;
      else if (code < 32) size += 6;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
      else if (code >= 0xd800 && code <= 0xdfff) size += 6;
      else size += code < 128 ? 1 : code < 2048 ? 2 : 3;
      checked(size);
    }
    return size;
  }
  if (value === null) return 4;
  if (Array.isArray(value)) {
    let size = 2;
    for (let i = 0; i < value.length; i++) size = checked(size + (i ? 1 : 0) + jsonBytes(value[i] ?? null, depth + 1));
    return size;
  }
  if (typeof value === 'object' && value) {
    let size = 2; let entries = 0;
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      size = checked(size + (entries++ ? 1 : 0) + jsonBytes(key, depth + 1) + 1 + jsonBytes(item, depth + 1));
    }
    return size;
  }
  throw new OutboundEmailPreparationError();
}

/** Mirrors HttpResendTransport's complete request, including omitted optional fields. */
export function estimateProviderEmailRequestBytes(options: SendEmailOptions, attachments: readonly EmailAttachmentEnvelope[]): number {
  if (attachments.length > MAX_TICKET_EMAIL_ATTACHMENTS) throw new OutboundEmailPreparationError();
  let contentBytes = 0;
  for (const attachment of attachments) {
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > MAX_TICKET_ATTACHMENT_BYTES ||
      typeof attachment.filename !== 'string' || !attachment.filename || attachment.filename.length > 255 ||
      typeof attachment.contentType !== 'string' || !attachment.contentType) throw new OutboundEmailPreparationError();
    contentBytes += 4 * Math.ceil(attachment.size / 3);
  }
  const size = jsonBytes({ from: options.from, to: options.to, subject: options.subject, html: options.html,
    text: options.text, headers: options.headers,
    attachments: attachments.map(a => ({ filename: a.filename, content: '', contentType: a.contentType })),
  }) + contentBytes;
  if (size > MAX_PROVIDER_EMAIL_REQUEST_BYTES) throw new OutboundEmailPreparationError();
  return size;
}
