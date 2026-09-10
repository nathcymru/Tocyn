import test from 'node:test';
import assert from 'node:assert/strict';
import { RESIDENCY_COMPONENTS, validateResidencyManifest, rejectRequestJurisdiction } from './residency-manifest.mjs';

const disabled = ['ai', 'vectorize', 'vectorizeWorkflow', 'emailRouting', 'cron', 'queues', 'webhooks', 'logsTraces', 'externalProviders'];
const disabledFor = new Set(['vectorize', 'workersAi', 'queues', 'cron', 'workflows', 'externalProviders', 'logsTraces']);
function dimension(enabled, status = enabled ? 'unrestricted' : 'unsupported', jurisdiction = null, verification = 'pending') {
  return { status, jurisdiction, evidenceCheckedAt: '2026-09-10T00:00:00Z', sources: ['https://developers.cloudflare.com/'], verification };
}
function manifest(overrides = {}) {
  const capabilities = Object.fromEntries(RESIDENCY_COMPONENTS.map((name) => [name, {
    enabled: !disabledFor.has(name),
    storage: dimension(!disabledFor.has(name)),
    processing: dimension(!disabledFor.has(name)),
  }]));
  const resources = Object.fromEntries(['d1', 'r2', 'durableObjects'].map((name) => [name, {
    selectedJurisdiction: 'none', verifiedJurisdiction: null, immutableAtCreation: false,
    migrationPlan: 'Owner-approved re-provision and migration required before a hard claim.', verification: 'pending',
  }]));
  return { schemaVersion: 1, policy: { profile: 'unrestricted' }, disabledCapabilities: disabled, capabilities, resources, ...overrides };
}
function hardManifest() {
  const m = manifest({ policy: { profile: 'hard', jurisdiction: 'eu' } });
  for (const name of RESIDENCY_COMPONENTS) m.capabilities[name] = { enabled: true, storage: dimension(true, 'guaranteed', 'eu', 'verified'), processing: dimension(true, 'guaranteed', 'eu', 'verified') };
  for (const name of ['d1', 'r2', 'durableObjects']) m.resources[name] = { selectedJurisdiction: 'eu', verifiedJurisdiction: 'eu', immutableAtCreation: true, migrationPlan: 'create eu resource and migrate with cutover', verification: 'verified' };
  m.disabledCapabilities = [];
  return m;
}
test('accepts explicit synthetic unrestricted matrix with pending verification', () => assert.equal(validateResidencyManifest(manifest()).valid, true));
test('accepts structurally complete synthetic constrained metadata, not a live deployment proof', () => assert.equal(validateResidencyManifest(hardManifest()).jurisdiction, 'eu'));
test('rejects unknown profile, empty jurisdiction, and hard pending proof', () => {
  assert.throws(() => validateResidencyManifest(manifest({ policy: { profile: 'eu-hadr' } })), { code: 'RESIDENCY_PROFILE_INVALID' });
  assert.throws(() => validateResidencyManifest(manifest({ policy: { profile: 'hard', jurisdiction: ' ' } })), { code: 'RESIDENCY_VALUE_REQUIRED' });
  const m = hardManifest(); m.disabledCapabilities = ['vectorize']; assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_ENABLED_MISMATCH' });
});
test('rejects unsupported enabled, missing dimension evidence, and unknown fields', () => {
  const m = manifest(); m.capabilities.d1.processing.status = 'unsupported'; assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_ENABLED_UNSUPPORTED' });
  const n = manifest(); delete n.capabilities.d1.storage.evidenceCheckedAt; assert.throws(() => validateResidencyManifest(n), { code: 'RESIDENCY_EVIDENCE_DATE_REQUIRED' });
  const x = manifest(); x.capabilities.d1.storage.extra = true; assert.throws(() => validateResidencyManifest(x), { code: 'RESIDENCY_FIELD_UNKNOWN' });
});
test('rejects resource verification mismatch, disabled resource, and malformed incompatible requirements', () => {
  const m = hardManifest(); m.resources.d1.verifiedJurisdiction = 'us'; assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_RESOURCE_VERIFICATION_MISMATCH' });
  const n = hardManifest(); n.capabilities.d1.enabled = false; n.capabilities.d1.storage.status = 'unsupported'; n.capabilities.d1.processing.status = 'unsupported'; n.disabledCapabilities = ['d1']; assert.throws(() => validateResidencyManifest(n), { code: 'RESIDENCY_RESOURCE_CAPABILITY_MISMATCH' });
  assert.throws(() => validateResidencyManifest(manifest({ policy: { profile: 'unrestricted', incompatibleTenantRequirements: [{}] } })), { code: 'RESIDENCY_VALUE_REQUIRED' });
  assert.throws(() => validateResidencyManifest(manifest({ policy: { profile: 'unrestricted', incompatibleTenantRequirements: [{ jurisdiction: 'eu' }, { jurisdiction: 'us' }] } })), { code: 'RESIDENCY_SEPARATE_DEPLOYMENT_REQUIRED' });
});
test('bounds cyclic and deeply nested manifests and rejects request jurisdiction', () => {
  const m = manifest(); m.loop = m; assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_INPUT_CYCLIC' });
  assert.throws(() => rejectRequestJurisdiction({ body: { tenantJurisdiction: 'eu' } }), { code: 'RESIDENCY_REQUEST_JURISDICTION_FORBIDDEN' });
});

test('hard residency rejects pending resource and dimension verification independently', () => {
  const resource = hardManifest(); resource.resources.d1.verification = 'pending'; resource.resources.d1.verifiedJurisdiction = null;
  assert.throws(() => validateResidencyManifest(resource), { code: 'RESIDENCY_RESOURCE_PENDING' });
  const path = hardManifest(); path.capabilities.workerHttp.processing.verification = 'pending';
  assert.throws(() => validateResidencyManifest(path), { code: 'RESIDENCY_HARD_CLAIM_UNPROVEN' });
});
test('rejects impossible/future evidence dates and malformed or credential-bearing evidence URLs', () => {
  for (const date of ['2026-02-30T00:00:00Z', '9999-01-01T00:00:00Z']) {
    const m = manifest(); m.capabilities.d1.storage.evidenceCheckedAt = date;
    assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_EVIDENCE_DATE_REQUIRED' });
  }
  for (const source of ['https://', 'https://user:password@example.invalid/']) {
    const m = manifest(); m.capabilities.d1.storage.sources = [source];
    assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_EVIDENCE_SOURCE_REQUIRED' });
  }
});
test('rejects a hard tenant requirement on unrestricted deployment and excessive nesting', () => {
  const m = manifest(); m.policy.incompatibleTenantRequirements = [{ jurisdiction: 'eu' }];
  assert.throws(() => validateResidencyManifest(m), { code: 'RESIDENCY_REQUIREMENT_UNSATISFIED' });
  const input = {}; let cursor = input;
  for (let i = 0; i < 20; i++) { cursor.child = {}; cursor = cursor.child; }
  assert.throws(() => rejectRequestJurisdiction(input), { code: 'RESIDENCY_INPUT_TOO_DEEP' });
});
