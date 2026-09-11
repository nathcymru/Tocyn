/**
 * Byte ceilings are deliberately below Workers AI's documented token windows.
 * A UTF-8 byte is an upper bound for the number of byte-pair tokens, so these
 * caps remain conservative without depending on an unverified tokenizer.
 */
export const MAX_BGE_REQUEST_BYTES = 512;
export const MAX_WIDGET_CONTEXT_BYTES = 3_072;
export const MAX_WIDGET_MESSAGE_BYTES = 768;
export const MAX_WIDGET_HISTORY_BYTES = 1_024;
export const MAX_STAFF_HISTORY_BYTES = 2_048;
export const MAX_STAFF_CONTEXT_BYTES = 2_048;

export function truncateUtf8(value: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid AI input byte bound');
  let bytes = 0;
  let result = '';
  const encoder = new TextEncoder();
  for (const character of value) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += character;
  }
  return result;
}

/** Preserve the tail so a bounded chronological history retains its newest message. */
export function truncateUtf8Tail(value: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid AI input byte bound');
  let bytes = 0;
  const characters: string[] = [];
  const encoder = new TextEncoder();
  for (const character of Array.from(value).reverse()) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > maxBytes) break;
    bytes += size;
    characters.push(character);
  }
  return characters.reverse().join('');
}

/** Match the provider adapter's delimiter escaping before byte accounting. */
export function boundUntrustedAiText(value: string, maxBytes: number): string {
  return truncateUtf8(value.replace(/</g, '&lt;').replace(/>/g, '&gt;'), maxBytes);
}

/** Preserve the most recent conversation turns within a fixed request envelope. */
export function boundRecentHistory(history: readonly { role: string; content: string }[], maxBytes: number): { role: string; content: string }[] {
  let remaining = maxBytes;
  const selected: { role: string; content: string }[] = [];
  for (let index = history.length - 1; index >= 0 && remaining > 0; index--) {
    const item = history[index];
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    const content = boundUntrustedAiText(item.content, remaining);
    if (!content) continue;
    selected.push({ role: item.role, content });
    remaining -= new TextEncoder().encode(content).byteLength;
  }
  return selected.reverse();
}
