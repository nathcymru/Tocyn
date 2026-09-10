const STATUSES = new Set(['guaranteed', 'best-effort', 'unrestricted', 'unsupported', 'unknown']);
const PROFILES = new Set(['unrestricted', 'best-effort', 'hard']);
const VERIFICATIONS = new Set(['pending', 'verified']);
const REQUIRED_COMPONENTS = ['d1', 'r2', 'durableObjects', 'vectorize', 'workersAi', 'queues', 'cron', 'workflows', 'workerHttp', 'logsTraces', 'externalProviders'];
const RESOURCE_COMPONENTS = ['d1', 'r2', 'durableObjects'];
const LIMITS = Object.freeze({ bytes: 262144, depth: 16, nodes: 5000 });

function error(code, message) { const e = new Error(code + ': ' + message); e.code = code; return e; }
function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('RESIDENCY_OBJECT_REQUIRED', name + ' must be an object'); return value; }
function exact(value, allowed, name) { for (const key of Object.keys(value)) if (!allowed.has(key)) throw error('RESIDENCY_FIELD_UNKNOWN', name + '.' + key + ' is not allowed'); }
function bounded(value) {
  const seen = new WeakSet(); let nodes = 0;
  const visit = (item, depth) => {
    if (!item || typeof item !== 'object') return;
    if (depth > LIMITS.depth) throw error('RESIDENCY_INPUT_TOO_DEEP', 'manifest exceeds maximum nesting depth');
    if (seen.has(item)) throw error('RESIDENCY_INPUT_CYCLIC', 'manifest contains a cycle');
    seen.add(item); nodes += 1;
    if (nodes > LIMITS.nodes) throw error('RESIDENCY_INPUT_TOO_LARGE', 'manifest exceeds maximum object count');
    for (const child of Object.values(item)) visit(child, depth + 1);
    seen.delete(item);
  };
  visit(value, 0);
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); } catch { throw error('RESIDENCY_INPUT_INVALID', 'manifest cannot be serialised'); }
  if (bytes > LIMITS.bytes) throw error('RESIDENCY_INPUT_TOO_LARGE', 'manifest exceeds maximum size');
}
function nonEmpty(value, name) { if (typeof value !== 'string' || !value.trim()) throw error('RESIDENCY_VALUE_REQUIRED', name + ' must be non-empty'); return value.trim(); }
function jurisdiction(value, name) { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value)) throw error('RESIDENCY_JURISDICTION_INVALID', name + ' must be a canonical jurisdiction identifier'); return value; }
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().replace('.000Z', 'Z') === value && date.valueOf() <= Date.now();
}
function evidenceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
function checkEvidence(component, dimension) {
  exact(dimension, new Set(['status', 'jurisdiction', 'evidenceCheckedAt', 'sources', 'verification']), component + ' dimension');
  if (!STATUSES.has(dimension.status)) throw error('RESIDENCY_STATUS_INVALID', component + ' has unsupported status');
  if (!Object.hasOwn(dimension, 'jurisdiction')) throw error('RESIDENCY_JURISDICTION_INVALID', component + ' requires explicit jurisdiction or null');
  if (dimension.jurisdiction !== null) jurisdiction(dimension.jurisdiction, component + '.jurisdiction');
  if (!isDate(dimension.evidenceCheckedAt)) throw error('RESIDENCY_EVIDENCE_DATE_REQUIRED', component + ' requires an ISO evidenceCheckedAt');
  if (!Array.isArray(dimension.sources) || dimension.sources.length === 0 || dimension.sources.some((source) => typeof source !== 'string' || !evidenceUrl(source))) throw error('RESIDENCY_EVIDENCE_SOURCE_REQUIRED', component + ' requires HTTPS source URLs');
  if (!VERIFICATIONS.has(dimension.verification)) throw error('RESIDENCY_VERIFICATION_REQUIRED', component + ' requires pending or verified verification metadata');
}
function checkCapability(component, capability, policy, disabledCapabilities) {
  object(capability, 'capabilities.' + component); exact(capability, new Set(['enabled', 'storage', 'processing']), 'capabilities.' + component);
  if (typeof capability.enabled !== 'boolean') throw error('RESIDENCY_ENABLED_REQUIRED', component + '.enabled must be explicit');
  const aliases = { workersAi: ['ai'], workflows: ['vectorizeWorkflow'] }[component] ?? [];
  const listedDisabled = disabledCapabilities.has(component) || aliases.some((name) => disabledCapabilities.has(name));
  if (listedDisabled === capability.enabled) throw error('RESIDENCY_ENABLED_MISMATCH', component + '.enabled disagrees with disabledCapabilities');
  for (const dimension of ['storage', 'processing']) {
    object(capability[dimension], 'capabilities.' + component + '.' + dimension); checkEvidence(component + '.' + dimension, capability[dimension]);
    if (!capability.enabled && !['unsupported', 'unknown'].includes(capability[dimension].status)) throw error('RESIDENCY_DISABLED_STATUS_INVALID', component + ' disabled capability must be unsupported or unknown');
    if (capability.enabled && capability[dimension].status === 'unsupported') throw error('RESIDENCY_ENABLED_UNSUPPORTED', component + ' is enabled but unsupported');
    if (policy.profile === 'hard' && capability.enabled && (capability[dimension].status !== 'guaranteed' || capability[dimension].verification !== 'verified' || capability[dimension].jurisdiction !== policy.jurisdiction)) throw error('RESIDENCY_HARD_CLAIM_UNPROVEN', component + '.' + dimension + ' lacks matching verified hard evidence');
  }
}
function checkResource(component, resource, policy) {
  object(resource, 'resources.' + component); exact(resource, new Set(['selectedJurisdiction', 'verifiedJurisdiction', 'immutableAtCreation', 'migrationPlan', 'verification']), 'resources.' + component);
  jurisdiction(resource.selectedJurisdiction, component + '.selectedJurisdiction');
  if (!VERIFICATIONS.has(resource.verification)) throw error('RESIDENCY_VERIFICATION_REQUIRED', component + ' resource verification is required');
  if (resource.verification === 'pending' && resource.verifiedJurisdiction !== null) throw error('RESIDENCY_RESOURCE_PENDING', component + ' pending verification must not claim a verified jurisdiction');
  if (resource.verification === 'verified' && resource.selectedJurisdiction !== resource.verifiedJurisdiction) throw error('RESIDENCY_RESOURCE_VERIFICATION_MISMATCH', component + ' selected and verified jurisdiction differ');
  if (policy.profile === 'hard') {
    if (resource.verification !== 'verified') throw error('RESIDENCY_RESOURCE_PENDING', component + ' hard residency requires resource verification');
    if (resource.verifiedJurisdiction !== policy.jurisdiction) throw error('RESIDENCY_RESOURCE_JURISDICTION_MISMATCH', component + ' jurisdiction does not match policy');
    if (resource.immutableAtCreation !== true) throw error('RESIDENCY_IMMUTABILITY_UNVERIFIED', component + ' must record creation-time immutability');
    if (typeof resource.migrationPlan !== 'string' || !resource.migrationPlan.trim()) throw error('RESIDENCY_MIGRATION_PLAN_REQUIRED', component + ' requires migration/re-provisioning consequences');
  } else if (typeof resource.immutableAtCreation !== 'boolean' || typeof resource.migrationPlan !== 'string' || !resource.migrationPlan.trim()) throw error('RESIDENCY_RESOURCE_METADATA_REQUIRED', component + ' requires resource metadata');
}
export function validateResidencyManifest(manifest) {
  object(manifest, 'manifest'); bounded(manifest); exact(manifest, new Set(['schemaVersion', 'policy', 'capabilities', 'resources', 'disabledCapabilities']), 'manifest');
  if (manifest.schemaVersion !== 1) throw error('RESIDENCY_SCHEMA_UNSUPPORTED', 'schemaVersion 1 is required');
  const policy = object(manifest.policy, 'policy'); exact(policy, new Set(['profile', 'jurisdiction', 'incompatibleTenantRequirements']), 'policy');
  if (!PROFILES.has(policy.profile)) throw error('RESIDENCY_PROFILE_INVALID', 'profile must be unrestricted, best-effort, or hard');
  if (policy.profile === 'hard') { nonEmpty(policy.jurisdiction, 'policy.jurisdiction'); jurisdiction(policy.jurisdiction, 'policy.jurisdiction'); }
  else if (policy.jurisdiction !== undefined && policy.jurisdiction !== null) throw error('RESIDENCY_JURISDICTION_UNEXPECTED', 'only hard profiles may select a jurisdiction');
  if (policy.incompatibleTenantRequirements !== undefined) {
    if (!Array.isArray(policy.incompatibleTenantRequirements) || policy.incompatibleTenantRequirements.some((item) => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => key !== 'jurisdiction'))) throw error('RESIDENCY_REQUIREMENT_INVALID', 'incompatible requirements must contain only jurisdiction');
    for (const item of policy.incompatibleTenantRequirements) { nonEmpty(item.jurisdiction, 'incompatibleTenantRequirements.jurisdiction'); jurisdiction(item.jurisdiction, 'incompatibleTenantRequirements.jurisdiction'); }
    if (new Set(policy.incompatibleTenantRequirements.map((item) => item.jurisdiction.trim())).size > 1) throw error('RESIDENCY_SEPARATE_DEPLOYMENT_REQUIRED', 'incompatible hard residency requirements require separate deployments');
    if (policy.incompatibleTenantRequirements.some(item => policy.profile !== 'hard' || item.jurisdiction !== policy.jurisdiction)) throw error('RESIDENCY_REQUIREMENT_UNSATISFIED', 'deployment does not satisfy its declared hard requirement');
  }
  if (Object.hasOwn(manifest, 'tenant') || Object.hasOwn(manifest, 'tenantJurisdiction') || Object.hasOwn(manifest, 'requestJurisdiction')) throw error('RESIDENCY_TENANT_AUTHORITY_FORBIDDEN', 'tenant/request jurisdiction cannot select a deployment resource');
  const capabilities = object(manifest.capabilities, 'capabilities'); exact(capabilities, new Set(REQUIRED_COMPONENTS), 'capabilities');
  const resources = object(manifest.resources, 'resources'); exact(resources, new Set(RESOURCE_COMPONENTS), 'resources');
  if (!(manifest.disabledCapabilities === undefined || (Array.isArray(manifest.disabledCapabilities) && manifest.disabledCapabilities.every((item) => typeof item === 'string')))) throw error('RESIDENCY_DISABLED_CAPABILITIES_INVALID', 'disabledCapabilities must be a string array');
  const disabled = new Set(manifest.disabledCapabilities ?? []);
  const supportedDisabled = new Set([...REQUIRED_COMPONENTS, 'ai', 'vectorizeWorkflow', 'emailRouting', 'webhooks']);
  if (disabled.size !== (manifest.disabledCapabilities ?? []).length || [...disabled].some(name => !supportedDisabled.has(name))) throw error('RESIDENCY_DISABLED_CAPABILITIES_INVALID', 'disabled capabilities must be unique known identifiers');
  for (const component of REQUIRED_COMPONENTS) checkCapability(component, capabilities[component], policy, disabled);
  for (const component of RESOURCE_COMPONENTS) checkResource(component, resources[component], policy);
  for (const component of RESOURCE_COMPONENTS) if (!capabilities[component].enabled) throw error('RESIDENCY_RESOURCE_CAPABILITY_MISMATCH', component + ' is a mandatory resource in this deployment contract');
  return { valid: true, profile: policy.profile, jurisdiction: policy.jurisdiction ?? null, components: REQUIRED_COMPONENTS.length };
}
export function rejectRequestJurisdiction(request = {}) {
  object(request, 'request'); bounded(request);
  const inspect = (value) => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { const normalised = key.toLowerCase(); if (normalised === 'jurisdiction' || normalised.endsWith('jurisdiction')) throw error('RESIDENCY_REQUEST_JURISDICTION_FORBIDDEN', 'request jurisdiction is not an authority input'); inspect(child); } };
  inspect(request); return true;
}
export const RESIDENCY_COMPONENTS = Object.freeze([...REQUIRED_COMPONENTS]);
export const RESIDENCY_STATUSES = Object.freeze([...STATUSES]);
if (process.argv[1] === new URL(import.meta.url).pathname) { const fs = await import('node:fs/promises'); const input = JSON.parse(await fs.readFile(process.argv[2] ?? '-', 'utf8')); console.log(JSON.stringify(validateResidencyManifest(input), null, 2)); }
