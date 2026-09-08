import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { environmentGuard, validIsolatedRuntime } from '../environment-guard';

const preview = {
  ENVIRONMENT: 'preview',
  PORTAL_URL: 'https://portal.preview.example.test',
  DASHBOARD_URL: 'https://dashboard.preview.example.test',
  CORS_ORIGINS: 'https://portal.preview.example.test,https://dashboard.preview.example.test',
  INBOUND_EMAIL_AUTH_VERIFIED: 'false',
  DISABLE_RATE_LIMIT: 'false'
};

describe('isolated environment guard', () => {
  it('allows only a complete preview or beta runtime configuration', () => {
    expect(validIsolatedRuntime(preview as any)).toBe(true);
    expect(validIsolatedRuntime({ ...preview, ENVIRONMENT: 'beta' } as any)).toBe(true);
    expect(validIsolatedRuntime({ ...preview, INBOUND_EMAIL_AUTH_VERIFIED: 'true' } as any)).toBe(false);
    expect(validIsolatedRuntime({ ...preview, DISABLE_RATE_LIMIT: 'true' } as any)).toBe(false);
    expect(validIsolatedRuntime({ ...preview, PORTAL_URL: 'http://portal.preview.example.test' } as any)).toBe(false);
    expect(validIsolatedRuntime({ ...preview, CORS_ORIGINS: preview.PORTAL_URL } as any)).toBe(false);
    expect(validIsolatedRuntime({ ...preview, ENVIRONMENT: undefined } as any)).toBe(false);
    expect(validIsolatedRuntime({ ...preview, ENVIRONMENT: 'preveiw' } as any)).toBe(false);
  });

  it('fails closed before route execution when preview configuration is invalid', async () => {
    const app = new Hono(); let reached = false;
    app.use('*', environmentGuard); app.get('/health', c => { reached = true; return c.text('OK'); });
    expect((await app.request('/health', {}, { ...preview, CORS_ORIGINS: '' })).status).toBe(503);
    expect(reached).toBe(false);
  });
});
