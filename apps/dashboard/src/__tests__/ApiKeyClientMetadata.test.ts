import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, dashboardApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

const user = { id: 'operator', email: 'operator@example.test', full_name: 'Operator', role: 'admin', mfa_enabled: true };

beforeEach(() => {
  useAuthStore.setState({ token: 'synthetic-session', user: user as any, mfaRequired: false, sessionGeneration: 1 });
});
afterEach(() => { vi.unstubAllGlobals(); useAuthStore.setState({ token: null, user: null, mfaRequired: false }); });

it('exposes only the metadata-only uncertain-key error body to the caller', async () => {
  const key = { id: 'key-u', name: 'Uncertain', prefix: 'fixture', created_at: '2026-09-11' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
    code: 'api_key_plaintext_unavailable', error: 'Plaintext unavailable', key,
  }), { status: 409, headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(new Response(JSON.stringify({
    code: 'idempotency_conflict', error: 'Conflict', private_detail: 'must-not-be-retained',
  }), { status: 409, headers: { 'content-type': 'application/json' } })));

  const uncertain = await dashboardApi.post('/api-keys', { name: 'Uncertain' }, { headers: { 'Idempotency-Key': 'key-1' } })
    .catch(error => error as ApiError);
  expect(uncertain).toMatchObject({ status: 409, code: 'api_key_plaintext_unavailable', body: { key } });

  const conflict = await dashboardApi.post('/api-keys', { name: 'Different' }, { headers: { 'Idempotency-Key': 'key-1' } })
    .catch(error => error as ApiError);
  expect(conflict).toMatchObject({ status: 409, code: 'idempotency_conflict' });
  expect(conflict.body).toBeUndefined();
});
