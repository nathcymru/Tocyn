import type { SendEmailOptions } from '../../types';
import { estimateProviderEmailRequestBytes, OutboundEmailPreparationError, MAX_TICKET_EMAIL_ATTACHMENTS, type EmailAttachmentEnvelope } from './request-envelope';

export const TICKET_EMAIL_STREAM_LIMIT = 2;
export const TICKET_EMAIL_BINARY_CHUNK = 48 * 1024;
export const TICKET_EMAIL_JSON_CHUNK = 16 * 1024;
const RESPONSE_BYTES = 16 * 1024;
const SEND_TIMEOUT_MS = 30_000;
let activeStreams = 0; // One counter per isolate. No tenant registry, queued work or credentials.

export interface TicketEmailSource extends EmailAttachmentEnvelope {
  open(): Promise<{ size: number; contentType: string | undefined; body: ReadableStream<Uint8Array> }>;
}
export type TicketEmailOptions = Omit<SendEmailOptions, 'attachments'>;
export class TicketEmailBusyError extends Error {
  readonly recoverable = true;
  constructor() { super('Email delivery temporarily busy'); }
}
export class TicketEmailDeliveryError extends Error {
  constructor() { super('Email delivery could not be confirmed'); }
}

const ascii = (text: string) => new TextEncoder().encode(text);

/** JSON string escaping without allocating the whole escaped string or UTF-8 body. */
function* stringChunks(value: string): Generator<Uint8Array> {
  let buffer = new Uint8Array(TICKET_EMAIL_JSON_CHUNK); let length = 0;
  buffer[length++] = 34;
  for (let i = 0; i < value.length; i++) {
    if (length > buffer.length - 6) { yield buffer.subarray(0, length); buffer = new Uint8Array(TICKET_EMAIL_JSON_CHUNK); length = 0; }
    let code = value.charCodeAt(i);
    if (code === 34 || code === 92) { buffer[length++] = 92; buffer[length++] = code; }
    else if (code === 8 || code === 9 || code === 10 || code === 12 || code === 13) {
      buffer[length++] = 92; buffer[length++] = ({ 8: 98, 9: 116, 10: 110, 12: 102, 13: 114 } as Record<number, number>)[code];
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      code = 0x10000 + ((code - 0xd800) << 10) + value.charCodeAt(++i) - 0xdc00;
      buffer[length++] = 0xf0 | (code >> 18); buffer[length++] = 0x80 | ((code >> 12) & 63);
      buffer[length++] = 0x80 | ((code >> 6) & 63); buffer[length++] = 0x80 | (code & 63);
    } else if (code < 32 || (code >= 0xd800 && code <= 0xdfff)) {
      buffer[length++] = 92; buffer[length++] = 117;
      for (let shift = 12; shift >= 0; shift -= 4) buffer[length++] = '0123456789abcdef'.charCodeAt((code >> shift) & 15);
    } else if (code < 128) buffer[length++] = code;
    else if (code < 2048) { buffer[length++] = 0xc0 | (code >> 6); buffer[length++] = 0x80 | (code & 63); }
    else { buffer[length++] = 0xe0 | (code >> 12); buffer[length++] = 0x80 | ((code >> 6) & 63); buffer[length++] = 0x80 | (code & 63); }
  }
  if (length === buffer.length) { yield buffer; buffer = new Uint8Array(TICKET_EMAIL_JSON_CHUNK); length = 0; }
  buffer[length++] = 34;
  yield buffer.subarray(0, length);
}

export function* ticketJsonChunks(value: unknown, depth = 0): Generator<Uint8Array> {
  if (depth > 5) throw new OutboundEmailPreparationError();
  if (typeof value === 'string') { yield* stringChunks(value); return; }
  if (value === null) { yield ascii('null'); return; }
  if (Array.isArray(value)) {
    yield ascii('[');
    for (let i = 0; i < value.length; i++) { if (i) yield ascii(','); yield* ticketJsonChunks(value[i] ?? null, depth + 1); }
    yield ascii(']'); return;
  }
  if (value && typeof value === 'object') {
    yield ascii('{'); let entries = 0;
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key]; if (item === undefined) continue;
      if (entries++) yield ascii(','); yield* stringChunks(key); yield ascii(':'); yield* ticketJsonChunks(item, depth + 1);
    }
    yield ascii('}'); return;
  }
  throw new OutboundEmailPreparationError();
}

const BASE64 = ascii('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
export function encodeTicketBase64(bytes: Uint8Array, final: boolean): Uint8Array {
  if (bytes.byteLength > TICKET_EMAIL_BINARY_CHUNK || (!final && bytes.byteLength % 3)) throw new OutboundEmailPreparationError();
  const result = new Uint8Array(Math.ceil(bytes.length / 3) * 4); let output = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    result[output++] = BASE64[a >> 2]; result[output++] = BASE64[((a & 3) << 4) | (b >> 4)];
    result[output++] = i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : 61;
    result[output++] = i + 2 < bytes.length ? BASE64[c & 63] : 61;
  }
  return result;
}

interface PumpState { reader?: ReadableStreamBYOBReader; responseReader?: ReadableStreamBYOBReader; aborted: boolean }
async function* requestChunks(options: TicketEmailOptions, sources: readonly TicketEmailSource[], state: PumpState): AsyncGenerator<Uint8Array> {
  const metadata = { from: options.from, to: options.to, subject: options.subject, html: options.html, text: options.text, headers: options.headers };
  yield ascii('{'); let fields = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (fields++) yield ascii(','); yield* ticketJsonChunks(key); yield ascii(':'); yield* ticketJsonChunks(value);
  }
  if (fields) yield ascii(','); yield ascii('"attachments":[');
  for (let i = 0; i < sources.length; i++) {
    if (state.aborted) throw new TicketEmailDeliveryError();
    const source = sources[i];
    if (i) yield ascii(','); yield ascii('{"filename":'); yield* ticketJsonChunks(source.filename); yield ascii(',"content":"');
    const object = await source.open();
    if (state.aborted || object.size !== source.size || object.contentType !== source.contentType) {
      await object.body.cancel(); throw new OutboundEmailPreparationError();
    }
    try { state.reader = object.body.getReader({ mode: 'byob' }); }
    catch { await object.body.cancel(); throw new OutboundEmailPreparationError(); }
    let read = 0;
    try {
      // Native R2 BYOB/readAtLeast support is proved at our compatibility date.
      // A full chunk is divisible by three; a partial chunk is permitted only at
      // EOF. No default-reader fallback may supply an arbitrarily large chunk.
      for (;;) {
        if (state.aborted) throw new TicketEmailDeliveryError();
        const result = await state.reader.readAtLeast(TICKET_EMAIL_BINARY_CHUNK, new Uint8Array(TICKET_EMAIL_BINARY_CHUNK));
        if (result.done) break;
        const chunk = result.value;
        read += chunk.byteLength;
        if (!chunk.byteLength || read > source.size) throw new OutboundEmailPreparationError();
        const final = read === source.size;
        if (!final && chunk.byteLength !== TICKET_EMAIL_BINARY_CHUNK) throw new OutboundEmailPreparationError();
        yield encodeTicketBase64(chunk, final);
      }
      if (read !== source.size) throw new OutboundEmailPreparationError();
    } finally {
      await state.reader.cancel().catch(() => {}); state.reader.releaseLock(); state.reader = undefined;
    }
    yield ascii('","contentType":'); yield* ticketJsonChunks(source.contentType); yield ascii('}');
  }
  yield ascii(']}');
}

async function boundedProviderId(response: Response, state: PumpState): Promise<string> {
  if (!response.body) throw new TicketEmailDeliveryError();
  const reader = response.body.getReader({ mode: 'byob' }); state.responseReader = reader;
  const result = new Uint8Array(RESPONSE_BYTES); let length = 0;
  try {
    for (;;) {
      const next = await reader.readAtLeast(4096, new Uint8Array(4096));
      if (next.done) break;
      if (length + next.value.byteLength > result.length) throw new TicketEmailDeliveryError();
      result.set(next.value, length); length += next.value.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(result.subarray(0, length))) as { id?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 256) throw new TicketEmailDeliveryError();
    return parsed.id;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); state.responseReader = undefined; }
}

/** Ticket-only source ownership; generic caller-owned Uint8Arrays retain their separate API. */
export async function sendTicketSources(options: TicketEmailOptions, sources: readonly TicketEmailSource[],
  credentials: { apiKey: string; defaultFrom: string }, invoke: typeof fetch = fetch): Promise<{ id: string }> {
  if (activeStreams >= TICKET_EMAIL_STREAM_LIMIT) throw new TicketEmailBusyError();
  activeStreams++;
  let writer: WritableStreamDefaultWriter | undefined;
  let response: Response | undefined;
  let pump: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state: PumpState = { aborted: false };
  const abort = new AbortController();
  const cancel = async () => {
    state.aborted = true; abort.abort();
    await Promise.allSettled([state.reader?.cancel(), state.responseReader?.cancel(), writer?.abort(), response?.body?.cancel()]);
  };
  try {
    if (sources.length > MAX_TICKET_EMAIL_ATTACHMENTS || options.to.length !== 1) throw new OutboundEmailPreparationError();
    const prepared = { ...options, from: options.from || credentials.defaultFrom, to: [...options.to], headers: options.headers && { ...options.headers } };
    const saved = sources.map(source => ({ ...source }));
    const bytes = estimateProviderEmailRequestBytes(prepared, saved);
    const fixed = new FixedLengthStream(bytes); writer = fixed.writable.getWriter();
    const output = writer;
    // Attach the rejection handler before starting fetch. The producer does not
    // capture credentials, and every write waits for downstream backpressure.
    pump = (async () => {
      for await (const chunk of requestChunks(prepared, saved, state)) {
        if (state.aborted) throw new TicketEmailDeliveryError();
        await output.write(chunk);
      }
      await output.close(); return true;
    })().catch(async () => {
      state.aborted = true; abort.abort();
      await output.abort().catch(() => {});
      return false;
    });
    timer = setTimeout(() => { void cancel(); }, SEND_TIMEOUT_MS);
    response = await invoke('https://api.resend.com/emails', {
      method: 'POST', redirect: 'manual', signal: abort.signal,
      headers: { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' }, body: fixed.readable,
    });
    if (state.aborted || !response.ok) throw new TicketEmailDeliveryError();
    if (!await pump || state.aborted) throw new TicketEmailDeliveryError();
    const id = await boundedProviderId(response, state);
    if (state.aborted) throw new TicketEmailDeliveryError();
    return { id };
  } catch (error) {
    if (error instanceof OutboundEmailPreparationError) throw error;
    throw new TicketEmailDeliveryError();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await cancel();
    // Never reuse a permit while its source/pump still owns native work.
    await pump;
    writer?.releaseLock(); activeStreams--;
  }
}
