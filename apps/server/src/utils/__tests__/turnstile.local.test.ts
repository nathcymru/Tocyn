import { describe, expect, it, vi } from 'vitest';
import { encryptString } from '../crypto';
import { verifyTurnstileToken } from '../turnstile';

const masterKey = 'local-turnstile-test-master-key-32chars';
const deps = (secretKey?: string) => ({
  scope: { tenantId: 'synthetic-tenant' },
  repositories: { config: { get: vi.fn(async () => secretKey) } },
});

describe('local Turnstile boundary', () => {
  it('rejects a configured local challenge without decrypting it or fetching Cloudflare', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await verifyTurnstileToken({ ENVIRONMENT: 'local' } as any, deps('stale-encrypted-value') as any, 'synthetic-token');
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the nonlocal verifier behavior unchanged', async () => {
    const encrypted = await encryptString('synthetic-turnstile-secret', masterKey);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyTurnstileToken({ ENVIRONMENT: 'development', APP_MASTER_KEY: masterKey } as any, deps(encrypted) as any, 'synthetic-token')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
