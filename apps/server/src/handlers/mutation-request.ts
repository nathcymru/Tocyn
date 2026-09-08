import { Context } from 'hono';
import { z } from 'zod';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~-]{1,128}$/;

export class MutationInputError extends Error {
  constructor(
    public readonly status: 400 | 415,
    public readonly code: 'invalid_idempotency_key' | 'invalid_json' | 'unsupported_media_type',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads a mutation body only after the caller's normal auth checks. Routes using
 * this helper are protected by requestBounds(64 KiB), which enforces streamed
 * body limits before JSON parsing.
 */
export async function readMutationJson(c: Context): Promise<unknown> {
  const contentType = c.req.header('Content-Type');
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new MutationInputError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  try {
    return await c.req.json();
  } catch {
    throw new MutationInputError(400, 'invalid_json', 'Invalid JSON request body');
  }
}

/** Optional retry key. It identifies a retry namespace; it never authorises it. */
export function readIdempotencyKey(c: Context): string | undefined {
  const key = c.req.header('Idempotency-Key');
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new MutationInputError(400, 'invalid_idempotency_key', 'Invalid Idempotency-Key');
  }
  return key;
}

export function mutationInputErrorBody(error: MutationInputError) {
  return { error: error.message, code: error.code };
}

const customFields = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
const attachmentReference = z.object({
  storageKey: z.string().min(1).max(1024).optional(),
  key: z.string().min(1).max(1024).optional(),
  filename: z.string().min(1).max(255),
}).refine(value => Boolean(value.storageKey || value.key), { message: 'Attachment key is required' });

export const apiTicketCreateSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(300),
  customer_email: z.string().email('Invalid email address').max(254),
  body: z.string().max(16000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'pending', 'resolved', 'closed']).default('open'),
  group_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  custom_fields: customFields.optional(),
});

export const apiTicketReplySchema = z.object({
  body: z.string().min(1, 'Message is required').max(16000),
  sender_type: z.enum(['customer', 'agent', 'system']).optional(),
  is_internal: z.boolean().optional(),
});

export const portalTicketCreateSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(300),
  message: z.string().min(1, 'Message is required').max(16000),
  custom_fields: customFields.optional(),
  turnstileToken: z.string().max(4096).optional(),
});

export const portalTicketReplySchema = z.object({
  message: z.string().min(1, 'Message is required').max(16000),
  attachments: z.array(attachmentReference).max(10).optional(),
});

export type NormalizedAttachmentReference = { storageKey: string; filename: string };

/** Preserve attachment list order for the replay fingerprint and validate it later against R2. */
export function normalizeAttachmentReferences(
  attachments: z.infer<typeof portalTicketReplySchema>['attachments'],
): NormalizedAttachmentReference[] {
  return (attachments || []).map(attachment => ({
    storageKey: attachment.storageKey || attachment.key!,
    filename: attachment.filename.replace(/^.*[\\/]/, '').replace(/[\r\n]/g, ''),
  }));
}
