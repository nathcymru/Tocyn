import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIDENCY_COMPONENTS, validateResidencyManifest, rejectRequestJurisdiction } from './residency-manifest.mjs';

const sources = ['https://developers.cloudflare.com/d1/'];
function manifest(overrides = {}) {
  const capabilities = Object.fromEntries(RESIDENCY_COMPONENTS.map((name) => [name, { storage: 'unrestricted', processing: 'unrestricted', evidenceCheckedAt: '2026-09-10T00:00:00Z', sources }]));
  const resources = Object.fromEntries(['d1', 'r2', 'durableObjects'].map((name) => [name, { jurisdiction: 'none', immutableAtCreation: true, migrationPlan: 're-provision and migrate under approved cutover' }]));
  return { schemaVersion: 1, policy: { profile: 'unrestricted' }, capabilities, resources, ...overrides };
}

test('accepts synthetic unrestricted deployment matrix', () => {
  assert.deepEqual(validateResidencyManifest(manifest()).valid, true);
});

test('accepts a fully evidenced constrained synthetic deployment', () => {
  const m = manifest({ policy: { profile: 'eu-hard', jurisdiction: 'eu' } });
  for (const name of RESIDENCY_COMPONENTS) m.capabilities[name] = { ...m.capabilities[name], storage: 'guaranteed', processing: 'guaranteed' };
  for (const name of ['d1', 'r2', 'durableObjects']) m.resources[name] = { jurisdiction: 'eu', immutableAtCreation: true, migrationPlan: 'create eu resource and migrate with cutover' };
  assert.equal(validateResidencyManifest(m).jurisdiction, 'eu');
});

test('fails hard claim when a service is unknown or unrestricted', () => {
  const m = manifest({ policy: { profile: 'eu-hard', jurisdiction: 'eu' } });
  for (const name of RESIDENCY_COMPONENTS) m.capabilities[name] = { ...m.capabilities[name], storage: 'guaranteed', processing: 'guaranteed' };
  m.capabilities.vectorize.processing = 'unknown';
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_HARD_CLAIM_UNPROVEN' });
});

test('fails enabled unsupported capability and missing evidence date', () => {
  const m = manifest();
  m.capabilities.workersAi.processing = 'unsupported';
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_ENABLED_UNSUPPORTED' });
  m.capabilities.workersAi.processing = 'unrestricted';
  delete m.capabilities.workersAi.evidenceCheckedAt;
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_EVIDENCE_DATE_REQUIRED' });
});

test('fails immutable resource jurisdiction mismatch and missing migration plan', () => {
  const m = manifest({ policy: { profile: 'eu-hard', jurisdiction: 'eu' } });
  for (const name of RESIDENCY_COMPONENTS) m.capabilities[name] = { ...m.capabilities[name], storage: 'guaranteed', processing: 'guaranteed' };
  m.resources.d1.jurisdiction = 'us';
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_RESOURCE_JURISDICTION_MISMATCH' });
  m.resources.d1.jurisdiction = 'eu';
  delete m.resources.d1.migrationPlan;
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_MIGRATION_PLAN_REQUIRED' });
});

test('rejects request jurisdiction as authority and separates incompatible tenants', () => {
  assert.throws(() => rejectRequestJurisdiction({ path: '/deployments', body: { tenant: { jurisdiction: 'eu' } } }), { code: 'RESIDENCY_REQUEST_JURISDICTION_FORBIDDEN' });
  const m = manifest({ policy: { profile: 'unrestricted', incompatibleTenantRequirements: [{ jurisdiction: 'eu' }, { jurisdiction: 'us' }] } });
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_SEPARATE_DEPLOYMENT_REQUIRED' });
});
