import { TenantRequestDeps } from '../middleware/tenant.middleware';

export class AttachmentReferenceError extends Error {}

/** Validate the complete list before the caller creates an article or attachment rows. */
export async function validateAttachmentReferences(deps: TenantRequestDeps, prefix: string, input: unknown) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 10) throw new AttachmentReferenceError('Invalid attachments');
  const seen = new Set<string>();
  const result = [];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'];
  for (const item of input) {
    const key = item?.storageKey || item?.key;
    if (typeof key !== 'string' || !key.startsWith(prefix) || seen.has(key) || typeof item.filename !== 'string') throw new AttachmentReferenceError('Invalid attachment reference');
    const filename = item.filename.replace(/^.*[\\/]/, '').replace(/[\r\n]/g, '');
    if (!filename || filename.length > 255) throw new AttachmentReferenceError('Invalid attachment filename');
    seen.add(key);
    const object = await deps.attachmentStorage.getAttachment(key);
    if (!object) throw new AttachmentReferenceError('Attachment not found');
    await object.body?.cancel();
    const size = object.size;
    const contentType = object.httpMetadata?.contentType;
    if (!Number.isInteger(size) || size < 0 || size > 10 * 1024 * 1024 || !allowedTypes.includes(contentType)) throw new AttachmentReferenceError('Invalid stored attachment');
    result.push({ storageKey: key, filename, size, contentType });
  }
  return result;
}
