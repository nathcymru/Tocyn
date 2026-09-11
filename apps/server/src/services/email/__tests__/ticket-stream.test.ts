import { describe, expect, it } from 'vitest';
import { encodeTicketBase64, ticketJsonChunks, TICKET_EMAIL_BINARY_CHUNK, TICKET_EMAIL_JSON_CHUNK } from '../ticket-stream';

const combine = (chunks: Uint8Array[]) => Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
describe('bounded ticket stream encoders', () => {
  it.each([0, 1, 2, 3, 4, 5, 49149, 49150, 49151, 49152])('encodes exactly %s bytes with correct final padding', length => {
    const input = Uint8Array.from({ length }, (_, index) => index % 251);
    const encoded = encodeTicketBase64(input, true);
    expect(Buffer.from(encoded).toString()).toBe(Buffer.from(input).toString('base64'));
    expect(encoded.byteLength).toBeLessThanOrEqual(64 * 1024);
  });
  it('rejects oversized or incomplete non-final binary chunks', () => {
    expect(() => encodeTicketBase64(new Uint8Array(TICKET_EMAIL_BINARY_CHUNK + 1), true)).toThrow();
    expect(() => encodeTicketBase64(new Uint8Array(1), false)).toThrow();
  });
  it('matches JSON escaping across every chunk boundary without emitting an oversized chunk', () => {
    for (const ending of ['😀', '\ud800', '\udfff', '\u0000', '\r\n\t', '漢字', '"\\']) {
      for (let length = TICKET_EMAIL_JSON_CHUNK - 9; length < TICKET_EMAIL_JSON_CHUNK + 9; length++) {
        const value = { from: 'sender', html: 'a'.repeat(length) + ending, headers: { 'X-Fixture': ending }, to: ['recipient'], text: undefined };
        const chunks = [...ticketJsonChunks(value)];
        expect(chunks.every(chunk => chunk.byteLength <= TICKET_EMAIL_JSON_CHUNK)).toBe(true);
        expect(combine(chunks).toString()).toBe(JSON.stringify(value));
      }
    }
  });
});
