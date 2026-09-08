import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyProviderResources } from './verify-provider-resources.mjs';
import { verifyRollback } from './verify-rollback.mjs';

const ids = {
  api: '11111111-1111-4111-8111-111111111111', portal: '22222222-2222-4222-8222-222222222222', dashboard: '33333333-3333-4333-8333-333333333333',
  portalAlias: '44444444-4444-4444-8444-444444444444', portalWildcard: '55555555-5555-4555-8555-555555555555', dashboardAlias: '66666666-6666-4666-8666-666666666666', dashboardWildcard: '77777777-7777-4777-8777-777777777777'
};
const bindings = {
  resources: { d1DatabaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', d1Database: 'tocyn-preview-db', r2AttachmentsBucket: 'tocyn-preview-attachments', apiWorker: 'tocyn-api-preview', portalPagesProject: 'tocyn-portal-preview', dashboardPagesProject: 'tocyn-dashboard-preview' },
  origins: { api: 'https://api.preview.example.test', portal: 'https://portal.preview.example.test', dashboard: 'https://dashboard.preview.example.test' }
};
const environment = {
  TOCYN_CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', TOCYN_RESOURCE_READ_API_TOKEN: 'resource-read', TOCYN_ACCESS_READ_API_TOKEN: 'access-read',
  TOCYN_API_ACCESS_APPLICATION_ID: ids.api, TOCYN_PORTAL_ACCESS_APPLICATION_ID: ids.portal, TOCYN_DASHBOARD_ACCESS_APPLICATION_ID: ids.dashboard,
  TOCYN_PORTAL_PAGES_ALIAS_ACCESS_APPLICATION_IDS: `${ids.portalAlias},${ids.portalWildcard}`, TOCYN_DASHBOARD_PAGES_ALIAS_ACCESS_APPLICATION_IDS: `${ids.dashboardAlias},${ids.dashboardWildcard}`
};

function response(result) { return { ok: true, json: async () => ({ success: true, result }) }; }
function provider({ d1 = bindings.resources.d1Database, r2 = bindings.resources.r2AttachmentsBucket, worker = bindings.resources.apiWorker, portalProject = bindings.resources.portalPagesProject, apiDomain = 'api.preview.example.test', portalAlias = 'tocyn-portal-preview.pages.dev', portalDeployment } = {}) {
  const routes = new Map([
    [`/d1/database/${bindings.resources.d1DatabaseId}`, { uuid: bindings.resources.d1DatabaseId, name: d1 }],
    [`/r2/buckets/${bindings.resources.r2AttachmentsBucket}`, { name: r2 }],
    [`/workers/services/${bindings.resources.apiWorker}`, { name: worker }],
    [`/pages/projects/${bindings.resources.portalPagesProject}`, { name: portalProject, subdomain: portalAlias }],
    [`/pages/projects/${bindings.resources.dashboardPagesProject}`, { name: bindings.resources.dashboardPagesProject, subdomain: 'tocyn-dashboard-preview.pages.dev' }],
    [`/pages/projects/${bindings.resources.portalPagesProject}/deployments`, portalDeployment ? [{ url: portalDeployment }] : []],
    [`/pages/projects/${bindings.resources.dashboardPagesProject}/deployments`, []],
    [`/access/apps/${ids.api}`, { type: 'self_hosted', domain: apiDomain }],
    [`/access/apps/${ids.portal}`, { type: 'self_hosted', domain: 'portal.preview.example.test' }],
    [`/access/apps/${ids.dashboard}`, { type: 'self_hosted', domain: 'dashboard.preview.example.test' }],
    [`/access/apps/${ids.portalAlias}`, { type: 'self_hosted', domain: 'tocyn-portal-preview.pages.dev' }],
    [`/access/apps/${ids.portalWildcard}`, { type: 'self_hosted', domain: '*.tocyn-portal-preview.pages.dev' }],
    [`/access/apps/${ids.dashboardAlias}`, { type: 'self_hosted', domain: 'tocyn-dashboard-preview.pages.dev' }],
    [`/access/apps/${ids.dashboardWildcard}`, { type: 'self_hosted', domain: '*.tocyn-dashboard-preview.pages.dev' }]
  ]);
  const calls = [];
  return { calls, fetchImpl: async url => { const path = new URL(url).pathname.replace(/^\/client\/v4\/accounts\/[^/]+/, ''); calls.push(path); return response(routes.get(path)); } };
}

test('provider preflight accepts only the exact isolated provider stack and records aliases', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'provider-preflight-'));
  try {
    const mock = provider();
    const receipt = await verifyProviderResources({ release: temp, environment: 'preview', env: environment, fetchImpl: mock.fetchImpl, verifyArtifact: () => ({ bindings }) });
    assert.deepEqual(receipt.observedPages.portal.aliases, ['tocyn-portal-preview.pages.dev']);
    assert.ok(mock.calls.includes(`/workers/services/${bindings.resources.apiWorker}`));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('rollback provider verification accepts a new covered deployment alias but rejects a changed contract', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'provider-rollback-'));
  try {
    const initial = provider();
    await verifyProviderResources({ release: temp, environment: 'preview', env: environment, fetchImpl: initial.fetchImpl, verifyArtifact: () => ({ bindings }) });
    const next = provider({ portalDeployment: 'https://new-deployment.tocyn-portal-preview.pages.dev' });
    await assert.doesNotReject(verifyProviderResources({ release: temp, environment: 'preview', env: { ...environment, TOCYN_VERIFY_PROVIDER_RECEIPT: 'true' }, fetchImpl: next.fetchImpl, verifyArtifact: () => ({ bindings }), writeReceipt: false }));
    const changed = provider({ apiDomain: 'api.beta.example.test' });
    await assert.rejects(verifyProviderResources({ release: temp, environment: 'preview', env: { ...environment, TOCYN_VERIFY_PROVIDER_RECEIPT: 'true' }, fetchImpl: changed.fetchImpl, verifyArtifact: () => ({ bindings }), writeReceipt: false }), /does not protect/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('provider preflight rejects cross-stack metadata and an unprotected Pages alias before ingress credentials exist', async () => {
  for (const options of [{ d1: 'tocyn-beta-db' }, { r2: 'tocyn-beta-attachments' }, { worker: 'tocyn-api-beta' }, { portalProject: 'tocyn-portal-beta' }, { apiDomain: 'api.beta.example.test' }, { portalDeployment: 'https://public.example.test' }]) {
    const mock = provider(options);
    await assert.rejects(verifyProviderResources({ release: '/not-used', environment: 'preview', env: environment, fetchImpl: mock.fetchImpl, verifyArtifact: () => ({ bindings }), writeReceipt: false }), /D1 metadata|R2 metadata|Worker metadata|Pages project metadata|does not protect|alias/);
    assert.equal(mock.calls.includes('/access/apps/service-token'), false);
  }
});

test('rollback rejects missing provider evidence and never accepts a different immutable revision', () => {
  const temp = mkdtempSync(join(tmpdir(), 'rollback-preflight-'));
  try {
    const path = join(temp, 'provenance.json');
    const base = { revision: 'a'.repeat(40), releaseDigest: 'b'.repeat(64) };
    writeFileSync(path, JSON.stringify(base));
    const env = { TOCYN_RELEASE_TARGET: 'preview', TOCYN_KNOWN_GOOD_REVISION: base.revision, TOCYN_KNOWN_GOOD_RELEASE_DIGEST: base.releaseDigest };
    assert.throws(() => verifyRollback({ provenancePath: path, env, verifyArtifact: () => { throw new Error('must not verify'); } }), /no recorded provider receipt/);
    writeFileSync(path, JSON.stringify({ ...base, providerReceiptDigest: 'c'.repeat(64), revision: 'd'.repeat(40) }));
    assert.throws(() => verifyRollback({ provenancePath: path, env, verifyArtifact: () => { throw new Error('must not verify'); } }), /does not match/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
