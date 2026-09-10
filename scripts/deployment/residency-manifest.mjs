const STATUSES = new Set(['guaranteed', 'best-effort', 'unrestricted', 'unsupported', 'unknown']);
const REQUIRED_COMPONENTS = [
  'd1', 'r2', 'durableObjects', 'vectorize', 'workersAi', 'queues',
  'cron', 'workflows', 'workerHttp', 'logsTraces', 'externalProviders',
];
const HARD_PROFILES = new Set(['hard', 'eu-hard', 'us-hard', 'fedramp-hard']);

function error(code, message) {
  const e = new Error(`${code}: ${message}`);
  e.code = code;
  return e;
}

function isDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function checkEvidence(component, capability) {
  if (!isDate(capability.evidenceCheckedAt)) {
    throw error('RESIDENCY_EVIDENCE_DATE_REQUIRED', `${component} requires evidenceCheckedAt`);
  }
  if (!Array.isArray(capability.sources) || capability.sources.length === 0 || capability.sources.some((source) => typeof source !== 'string' || !/^https:\/\//.test(source))) {
    throw error('RESIDENCY_EVIDENCE_SOURCE_REQUIRED', `${component} requires HTTPS source URLs`);
  }
}

function checkCapability(component, capability, profile) {
  if (!capability || typeof capability !== 'object') throw error('RESIDENCY_COMPONENT_REQUIRED', `${component} capability is required`);
  for (const field of ['storage', 'processing']) {
    const status = capability[field];
    if (!STATUSES.has(status)) throw error('RESIDENCY_STATUS_INVALID', `${component}.${field} has unsupported status`);
  }
  checkEvidence(component, capability);
  if (capability.enabled !== false && (capability.storage === 'unsupported' || capability.processing === 'unsupported')) {
    throw error('RESIDENCY_ENABLED_UNSUPPORTED', `${component} is enabled but a capability is unsupported`);
  }
  if (HARD_PROFILES.has(profile) && capability.enabled !== false && (capability.storage !== 'guaranteed' || capability.processing !== 'guaranteed')) {
    throw error('RESIDENCY_HARD_CLAIM_UNPROVEN', `${component} cannot support a hard residency claim`);
  }
}

function checkImmutable(component, resource, policy) {
  if (!resource || typeof resource !== 'object') throw error('RESIDENCY_RESOURCE_REQUIRED', `${component} resource is required`);
  if (policy.profile && HARD_PROFILES.has(policy.profile) && resource.enabled !== false) {
    if (resource.jurisdiction !== policy.jurisdiction) throw error('RESIDENCY_RESOURCE_JURISDICTION_MISMATCH', `${component} jurisdiction does not match policy`);
    if (resource.immutableAtCreation !== true) throw error('RESIDENCY_IMMUTABILITY_UNVERIFIED', `${component} must record creation-time immutability`);
    if (typeof resource.migrationPlan !== 'string' || !resource.migrationPlan.trim()) throw error('RESIDENCY_MIGRATION_PLAN_REQUIRED', `${component} requires migration/re-provisioning consequences`);
  }
}

/** Validate a source-only deployment manifest. No network calls or resource writes occur. */
export function validateResidencyManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw error('RESIDENCY_MANIFEST_REQUIRED', 'manifest must be an object');
  if (manifest.schemaVersion !== 1) throw error('RESIDENCY_SCHEMA_UNSUPPORTED', 'schemaVersion 1 is required');
  const policy = manifest.policy;
  if (!policy || typeof policy.profile !== 'string') throw error('RESIDENCY_POLICY_REQUIRED', 'deployment policy is required');
  if (HARD_PROFILES.has(policy.profile) && typeof policy.jurisdiction !== 'string') throw error('RESIDENCY_JURISDICTION_REQUIRED', 'hard profile requires jurisdiction');
  if (manifest.tenant || manifest.tenantJurisdiction || manifest.requestJurisdiction) throw error('RESIDENCY_TENANT_AUTHORITY_FORBIDDEN', 'tenant/request jurisdiction cannot select a deployment resource');
  const capabilities = manifest.capabilities;
  const resources = manifest.resources;
  if (!capabilities || !resources) throw error('RESIDENCY_MATRIX_REQUIRED', 'capabilities and resources are required');
  for (const component of REQUIRED_COMPONENTS) checkCapability(component, capabilities[component], policy.profile);
  for (const component of ['d1', 'r2', 'durableObjects']) checkImmutable(component, resources[component], policy);
  if (Array.isArray(policy.incompatibleTenantRequirements) && policy.incompatibleTenantRequirements.length > 1) {
    const jurisdictions = new Set(policy.incompatibleTenantRequirements.map((item) => item?.jurisdiction).filter(Boolean));
    if (jurisdictions.size > 1) throw error('RESIDENCY_SEPARATE_DEPLOYMENT_REQUIRED', 'incompatible hard residency requirements require separate deployments');
  }
  return { valid: true, profile: policy.profile, jurisdiction: policy.jurisdiction ?? null, components: REQUIRED_COMPONENTS.length };
}

/** Request data is deliberately not consulted for residency selection. */
export function rejectRequestJurisdiction(request = {}) {
  const inspect = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const normalised = key.toLowerCase();
      if (normalised === 'jurisdiction' || normalised.endsWith('jurisdiction')) throw error('RESIDENCY_REQUEST_JURISDICTION_FORBIDDEN', 'request jurisdiction is not an authority input');
      inspect(child);
    }
  };
  inspect(request);
  return true;
}

export const RESIDENCY_COMPONENTS = Object.freeze([...REQUIRED_COMPONENTS]);
export const RESIDENCY_STATUSES = Object.freeze([...STATUSES]);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const fs = await import('node:fs/promises');
  const input = JSON.parse(await fs.readFile(process.argv[2] ?? '-', 'utf8'));
  console.log(JSON.stringify(validateResidencyManifest(input), null, 2));
}
