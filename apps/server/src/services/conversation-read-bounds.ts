export class ConversationReadError extends Error {
  constructor(readonly status: 400 | 413, readonly code: 'invalid_pagination' | 'conversation_page_too_large', message: string) { super(message); }
}
export function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new ConversationReadError(400, 'invalid_pagination', 'Pagination values must be positive whole numbers.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > maximum) throw new ConversationReadError(400, 'invalid_pagination', `Pagination value must not exceed ${maximum}.`);
  return n;
}
export function parseListPage(query: { page?: string; limit?: string }) {
  return { page: boundedInteger(query.page, 1, 1000), limit: boundedInteger(query.limit, 50, 50) };
}
export type ArticleCursor = { createdAt: string; id: string };
export function encodeArticleCursor(cursor: ArticleCursor): string { return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function decodeArticleCursor(raw?: string): ArticleCursor | undefined {
  if (raw === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw new Error();
    const value = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
    const validDate = value && typeof value.createdAt === 'string'
      && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z?$/.test(value.createdAt);
    const validId = value && typeof value.id === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value.id);
    if (!validDate || !validId || Object.keys(value).length !== 2) throw new Error();
    return value;
  } catch { throw new ConversationReadError(400, 'invalid_pagination', 'Invalid article cursor.'); }
}
export const MAX_CONVERSATION_RESPONSE_BYTES = 1024 * 1024;
export function assertConversationResponseBounds(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_CONVERSATION_RESPONSE_BYTES) {
    throw new ConversationReadError(413, 'conversation_page_too_large',
      'This conversation page exceeds the local beta response limit. Request fewer articles or contact the operator.');
  }
}
