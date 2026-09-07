import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpResendTransport } from '../transport';

afterEach(() => vi.unstubAllGlobals());
describe('email provider error redaction', () => {
  it('discards provider response bodies rather than exposing credentials or messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private credential and customer message', { status: 401 })));
    await expect(new HttpResendTransport().send({ to: ['synthetic@example.com'], subject: 'Subject', text: 'Text' }, { apiKey: 'synthetic-secret', defaultFrom: 'support@example.com' })).rejects.toThrow(/^Email provider rejected delivery \(401\)$/);
  });
});
