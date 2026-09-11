import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateProviderEmailRequestBytes, MAX_PROVIDER_EMAIL_REQUEST_BYTES, OutboundEmailPreparationError } from '../request-envelope';
import { HttpResendTransport, LOCAL_AUTH_CAPTURE_RECIPIENT, LocalAuthCaptureTransport } from '../transport';
import { TenantOutboundEmailService } from '../tenant-outbound.service';

const options = { from: 'support@example.test', to: ['customer@example.test'], subject: 'Subject', html: 'Hello' };
afterEach(() => vi.unstubAllGlobals());

describe('complete outbound request envelope', () => {
  it.each(['ASCII', '漢字😀', 'quote" slash\\ control\u0001\b\t\n\f\r', '\ud800\udc00\ud800\udc01\udfff'])('matches the actual transport UTF-8 body: %s', async text => {
    const fetch = vi.fn(async () => new Response('{"id":"synthetic"}'));
    vi.stubGlobal('fetch', fetch);
    const content = new Uint8Array([0, 1, 2, 3, 4]);
    const message = { ...options, html: text, text, headers: { 'X-Synthetic': text }, attachments: [{ filename: `${text}.txt`, contentType: 'text/plain', content }] };
    const estimated = estimateProviderEmailRequestBytes(message, [{ filename: `${text}.txt`, contentType: 'text/plain', size: content.length }]);
    await new HttpResendTransport().send(message, { apiKey: 'synthetic-key', defaultFrom: options.from });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(estimated).toBe(new TextEncoder().encode(init.body as string).byteLength);
  });

  it('accepts the exact limit and rejects one additional body byte without allocating attachment buffers', () => {
    const attachments = [{ filename: 'a.pdf', contentType: 'application/pdf', size: 10 * 1024 * 1024 },
      { filename: 'b.pdf', contentType: 'application/pdf', size: 10 * 1024 * 1024 },
      { filename: 'c.pdf', contentType: 'application/pdf', size: 0 }];
    let message = { ...options };
    for (let padding = 0; padding < 4; padding++) {
      message = { ...options, subject: options.subject + 'x'.repeat(padding) };
      const remaining = MAX_PROVIDER_EMAIL_REQUEST_BYTES - estimateProviderEmailRequestBytes(message, attachments);
      if (remaining % 4 === 0) { attachments[2].size = remaining / 4 * 3; break; }
    }
    expect(estimateProviderEmailRequestBytes(message, attachments)).toBe(MAX_PROVIDER_EMAIL_REQUEST_BYTES);
    expect(() => estimateProviderEmailRequestBytes({ ...message, html: message.html + 'x' }, attachments)).toThrow(OutboundEmailPreparationError);
  });

  it.each([-1, NaN, Infinity, 0.5, 10 * 1024 * 1024 + 1])('rejects invalid stored size %s', size => {
    expect(() => estimateProviderEmailRequestBytes(options, [{ filename: 'a.pdf', contentType: 'application/pdf', size }])).toThrow(OutboundEmailPreparationError);
  });
});

function serviceFixture() {
  const transport = new LocalAuthCaptureTransport();
  const send = vi.spyOn(transport, 'send');
  const storage = { getAttachment: vi.fn() };
  const channels = { findReplySender: vi.fn(async () => null), findByEmail: vi.fn(async () => null), listSupportEmails: vi.fn() };
  const deps = { repositories: { config: { get: vi.fn(async () => '#') }, channels }, attachmentStorage: storage };
  return { service: new TenantOutboundEmailService(deps as any, undefined, transport, 'local'), storage, send, channels };
}
const ticket = { id: 't', subject: 'Subject', customer_email: LOCAL_AUTH_CAPTURE_RECIPIENT, group_id: 'g' } as any;
const attachment = (size: number) => ({ r2_key: 'private-key', file_name: 'a.pdf', content_type: 'application/pdf', file_size: size }) as any;

describe('pre-read ticket email admission', () => {
  it('rejects ten maximum-size attachments whole before storage or provider work', async () => {
    const f = serviceFixture();
    await expect(f.service.sendTicketReply(ticket, { body: 'Hello' } as any, Array.from({ length: 10 }, () => attachment(10 * 1024 * 1024))))
      .rejects.toThrow('Email exceeds supported delivery size');
    expect(f.storage.getAttachment).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.channels.listSupportEmails).not.toHaveBeenCalled();
  });

  it('rejects metadata mutation before arrayBuffer and cancels the object body', async () => {
    const f = serviceFixture(); const arrayBuffer = vi.fn(); const cancel = vi.fn();
    f.storage.getAttachment.mockResolvedValue({ size: 11, httpMetadata: { contentType: 'application/pdf' }, body: { cancel }, arrayBuffer });
    await expect(f.service.sendTicketReply(ticket, { body: 'Hello' } as any, [attachment(10)])).rejects.toThrow(OutboundEmailPreparationError);
    expect(cancel).toHaveBeenCalledOnce(); expect(arrayBuffer).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  it('preserves all ten valid small attachments and the existing one-email contract', async () => {
    const f = serviceFixture();
    let activeReads = 0; let peakReads = 0;
    f.storage.getAttachment.mockResolvedValue({ size: 3, httpMetadata: { contentType: 'application/pdf' }, arrayBuffer: async () => {
      activeReads++; peakReads = Math.max(peakReads, activeReads);
      await Promise.resolve(); activeReads--;
      return new Uint8Array([1, 2, 3]).buffer;
    } });
    await f.service.sendTicketReply(ticket, { body: 'Hello' } as any, Array.from({ length: 10 }, () => attachment(3)));
    expect(f.storage.getAttachment).toHaveBeenCalledTimes(10); expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0][0].attachments).toHaveLength(10);
    expect(peakReads).toBe(1);
  });
});
