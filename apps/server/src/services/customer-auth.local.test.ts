import { describe, expect, it } from 'vitest';
import * as jose from 'jose';
import { CustomerAuthService } from './customer-auth.service';
import { LOCAL_AUTH_CAPTURE_RECIPIENT, LocalAuthCaptureTransport } from './email/transport';

const localEnv = {
  ENVIRONMENT: 'local',
  JWT_SECRET: 'local-customer-auth-secret-at-least-32-characters',
  APP_MASTER_KEY: 'unused-by-local-capture',
  PORTAL_URL: 'http://localhost:5174',
};

function customerDeps(tenantId: string, tokenStore: { hash?: string }) {
  const user = { id: `${tenantId}-customer`, tenant_id: tenantId, email: LOCAL_AUTH_CAPTURE_RECIPIENT, full_name: 'Local capture', role: 'customer', session_version: 0 };
  return {
    scope: { tenantId },
    repositories: {
      config: { get: async (key: string) => ({ PORTAL_URL: 'http://localhost:5174', 'widget.public_key': 'local-widget-key' }[key]) },
      users: {
        create: async () => user,
        storeCustomerAuthToken: async (_userId: string, _tokenId: string, hash: string) => { tokenStore.hash = hash; },
        verifyAndConsumeCustomerAuthToken: async (hash: string) => hash === tokenStore.hash ? user : null,
      },
      channels: { listSupportEmails: async () => [] },
    },
  };
}

describe('local customer auth capture', () => {
  it('does not expose a configured local Turnstile site key to the portal', async () => {
    const service = new CustomerAuthService(localEnv as any, {
      scope: { tenantId: 'tenant-a' },
      repositories: { config: { get: async (key: string) => key === 'TURNSTILE_SITE_KEY' ? 'stale-site-key' : '#' } },
    } as any);
    await expect(service.getConfig()).resolves.toEqual({ TICKET_PREFIX: '#' });
  });

  it('covers the CustomerAuthService request and verify logic with repository doubles and no provider credentials', async () => {
    const tokens: { hash?: string } = {};
    const capture = new LocalAuthCaptureTransport();
    const service = new CustomerAuthService(localEnv as any, customerDeps('tenant-a', tokens) as any, capture, {
      resolveCredentialsByEmail: async () => null,
    });
    await service.requestAuth(LOCAL_AUTH_CAPTURE_RECIPIENT);
    const link = capture.list()[0]?.loginLink;
    expect(link).toBeDefined();
    const verified = await service.verifyAuth(new URL(link!).searchParams.get('token')!);
    expect(verified?.user.tenant_id).toBe('tenant-a');
    const payload = await jose.jwtVerify(verified!.token, new TextEncoder().encode(localEnv.JWT_SECRET), { audience: 'widget' });
    expect(payload.payload.tenant_id).toBe('tenant-a');
  });

  it('rejects a customer identity resolved from another tenant before any capture', async () => {
    const capture = new LocalAuthCaptureTransport();
    const service = new CustomerAuthService(localEnv as any, customerDeps('tenant-a', {}) as any, capture, {
      resolveCredentialsByEmail: async () => ({ userId: 'tenant-b-customer', tenantId: 'tenant-b', role: 'customer' }),
    });
    await expect(service.requestAuth(LOCAL_AUTH_CAPTURE_RECIPIENT)).rejects.toThrow('Invalid tenant context');
    expect(capture.list()).toEqual([]);
  });
});
