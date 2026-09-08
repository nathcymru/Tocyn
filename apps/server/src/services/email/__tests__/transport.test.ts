import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpResendTransport, LOCAL_AUTH_CAPTURE_RECIPIENT, LOCAL_AUTH_CAPTURE_RECIPIENTS, LocalAuthCaptureTransport } from '../transport';

afterEach(() => vi.unstubAllGlobals());
describe('email provider error redaction', () => {
  it('discards provider response bodies rather than exposing credentials or messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private credential and customer message', { status: 401 })));
    await expect(new HttpResendTransport().send({ to: ['synthetic@example.com'], html: '<p>Synthetic</p>', subject: 'Subject', text: 'Text' }, { apiKey: 'synthetic-secret', defaultFrom: 'support@example.com' })).rejects.toThrow(/^Email provider rejected delivery \(401\)$/);
  });
});

describe('local auth capture transport', () => {
  it('captures only the synthetic recipient with a bounded local login link', async () => {
    let now = Date.parse('2026-09-08T12:00:00.000Z');
    const capture = new LocalAuthCaptureTransport(() => now);
    await capture.send({
      to: [LOCAL_AUTH_CAPTURE_RECIPIENT],
      html: '<p>Synthetic</p>', subject: 'Your Login Link',
      text: 'Use http://localhost:5174/verify?token=synthetic&key=local-key',
    }, capture.credentials);
    expect(capture.list()).toMatchObject([{ to: LOCAL_AUTH_CAPTURE_RECIPIENT, loginLink: 'http://localhost:5174/verify?token=synthetic&key=local-key' }]);
    await capture.send({ to: [LOCAL_AUTH_CAPTURE_RECIPIENT], html: '<p>Synthetic</p>', subject: 'Wrong local port', text: 'http://localhost:8787/verify?token=synthetic' }, capture.credentials);
    expect(capture.list().at(-1)?.loginLink).toBeUndefined();
    for (const recipient of LOCAL_AUTH_CAPTURE_RECIPIENTS) {
      await capture.send({ to: [recipient], html: '<p>Synthetic</p>', subject: 'Allowed', text: 'Synthetic local message' }, capture.credentials);
    }
    expect(capture.list().map(message => message.to)).toEqual(expect.arrayContaining([...LOCAL_AUTH_CAPTURE_RECIPIENTS]));
    await expect(capture.send({ to: ['outside@example.com'], html: '<p>Synthetic</p>', subject: 'No', text: 'No' }, capture.credentials)).rejects.toThrow(LOCAL_AUTH_CAPTURE_RECIPIENT);
    await expect(capture.send({ to: ['tocyn-auth-test-c@example.invalid'], html: '<p>Synthetic</p>', subject: 'No', text: 'No' }, capture.credentials)).rejects.toThrow(LOCAL_AUTH_CAPTURE_RECIPIENT);
    for (let index = 0; index < 10; index += 1) {
      await capture.send({ to: [LOCAL_AUTH_CAPTURE_RECIPIENT], html: '<p>Synthetic</p>', subject: `Captured ${index}`, text: 'Synthetic local message' }, capture.credentials);
    }
    expect(capture.list()).toHaveLength(10);
    capture.reset();
    expect(capture.list()).toEqual([]);
    await capture.send({ to: [LOCAL_AUTH_CAPTURE_RECIPIENT], html: '<p>Synthetic</p>', subject: 'Expiry', text: 'Synthetic local message' }, capture.credentials);
    now += 16 * 60 * 1000;
    expect(capture.list()).toEqual([]);
  });
});
