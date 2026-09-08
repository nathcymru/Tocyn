import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyRestrictedIngress } from './verify-restricted-ingress.mjs';

test('restricted ingress probes every discovered Pages alias anonymously and with the synthetic Access identity', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'restricted-ingress-'));
  try {
    const aliasesPath = join(temp, 'aliases.json');
    writeFileSync(aliasesPath, JSON.stringify({ pages: { dashboard: { aliases: ['dashboard-hash.tocyn-dashboard-preview.pages.dev'] }, portal: { aliases: ['portal-hash.tocyn-portal-preview.pages.dev'] } } }));
    const requested = [];
    await verifyRestrictedIngress({
      release: temp,
      environment: 'preview',
      aliasesPath,
      env: { TOCYN_ACCESS_CLIENT_ID: 'synthetic-id', TOCYN_ACCESS_CLIENT_SECRET: 'synthetic-secret' },
      verifyArtifact: () => ({ bindings: { origins: { api: 'https://api.preview.example.test', portal: 'https://portal.preview.example.test', dashboard: 'https://dashboard.preview.example.test' } } }),
      fetchImpl: async (url, options) => {
        requested.push([url, Boolean(options.headers['CF-Access-Client-Id'])]);
        return { status: options.headers['CF-Access-Client-Id'] ? 200 : 403, body: { cancel: async () => {} } };
      }
    });
    for (const alias of ['https://dashboard-hash.tocyn-dashboard-preview.pages.dev', 'https://portal-hash.tocyn-portal-preview.pages.dev']) {
      assert.deepEqual(requested.filter(([url]) => url === alias).map(([, authorised]) => authorised), [false, true]);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
