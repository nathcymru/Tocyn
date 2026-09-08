import { describe, expect, it, vi } from 'vitest';
import { EmailHandler } from '../email.handler';

describe('inbound email deployment gate', () => {
  it.each([undefined, '', 'false', 'TRUE'])('rejects before parsing or database access when verification is %s', async flag => {
    const prepare = vi.fn(() => { throw new Error('Must not access database'); });
    const setReject = vi.fn();
    await new EmailHandler({ INBOUND_EMAIL_AUTH_VERIFIED: flag, DB: { prepare } } as any).handleEmail({
      setReject, from: 'synthetic@example.test', to: 'support@example.test',
      headers: new Headers({ 'Authentication-Results': 'spf=pass; dkim=pass; dmarc=pass', 'INBOUND_EMAIL_AUTH_VERIFIED': 'true' }),
      get raw() { throw new Error('Must not parse'); }
    } as any, {} as any);
    expect(setReject).toHaveBeenCalledWith('Inbound email is not enabled');
    expect(prepare).not.toHaveBeenCalled();
  });
});
