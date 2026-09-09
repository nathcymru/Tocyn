import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/;
const sha = /^[0-9a-f]{40}$/i;
const digest = /^[0-9a-f]{64}$/i;
const requiredTables = Object.freeze([
  'tickets', 'articles', 'conversation_events', 'local_beta_runs',
  'local_beta_policy', 'local_beta_invitations', 'ticket_mutation_receipts',
]);

function fail(message) { throw new Error(`Local same-state fallback rejected: ${message}`); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function natural(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative safe integer`);
  return value;
}
function fullSha(value, name) {
  if (typeof value !== 'string' || !sha.test(value)) fail(`${name} must be a full immutable SHA`);
  return value.toLowerCase();
}
function sha256(value, name) {
  if (typeof value !== 'string' || !digest.test(value)) fail(`${name} must be a SHA-256 digest`);
  return value.toLowerCase();
}

/** Reads only checked-in migration files from a supplied clean local source path. */
export function migrationManifest(source) {
  if (!isAbsolute(source)) fail('source path must be absolute');
  const directory = join(source, 'apps/server/migrations');
  let names;
  try { names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort(); }
  catch { fail('source has no readable server migrations directory'); }
  if (names.length === 0 || names.some(name => !migrationName.test(name))) fail('migration manifest contains an unexpected filename');
  const entries = names.map(name => Object.freeze({ name, digest: hash(readFileSync(join(directory, name)) ) }));
  return Object.freeze({ entries: Object.freeze(entries), digest: hash(JSON.stringify(entries)) });
}

/** A code fallback never opens shared state unless both source migration manifests match exactly. */
export function assertCompatibleMigrations(candidateSource, knownGoodSource) {
  const candidate = migrationManifest(candidateSource);
  const knownGood = migrationManifest(knownGoodSource);
  if (candidate.digest !== knownGood.digest) fail('candidate and known-good migration manifests differ');
  return candidate;
}

export class RuntimeSchemaIncompatibleError extends Error {
  constructor(table) {
    super(`Local same-state fallback rejected: local state lacks required table ${table}`);
    this.name = 'RuntimeSchemaIncompatibleError';
  }
}

/** Only a positively identified schema mismatch becomes an unavailable result. */
export function runtimeSchemaUnavailableReceipt(error, revisions) {
  if (!(error instanceof RuntimeSchemaIncompatibleError)) throw error;
  return unavailableFallbackReceipt({ ...revisions, reason: 'runtime_schema_incompatible' });
}

export function assertRequiredSchemaTables(tables) {
  if (!Array.isArray(tables) || tables.some(table => typeof table !== 'string')) fail('schema table inventory must be a string array');
  const actual = new Set(tables);
  for (const table of requiredTables) if (!actual.has(table)) throw new RuntimeSchemaIncompatibleError(table);
  return Object.freeze([...requiredTables]);
}

/** Stable hashing prevents field order from changing a canonical preservation comparison. */
export function canonicalDigest(value) {
  const visit = input => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail('canonical snapshot contains a non-finite number');
      return JSON.stringify(input);
    }
    if (Array.isArray(input)) return `[${input.map(visit).join(',')}]`;
    if (typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
      return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${visit(input[key])}`).join(',')}}`;
    }
    fail('canonical snapshot contains an unsupported value');
  };
  return hash(visit(value));
}

function snapshot(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  const admission = value.admission;
  if (!admission || typeof admission !== 'object' || Array.isArray(admission)) fail(`${name}.admission must be an object`);
  if (admission.state !== 'running') fail(`${name}.admission state must remain running`);
  return Object.freeze({
    canonical: sha256(value.canonical, `${name}.canonical`),
    tickets: natural(value.tickets, `${name}.tickets`),
    articles: natural(value.articles, `${name}.articles`),
    events: natural(value.events, `${name}.events`),
    admission: Object.freeze({
      state: admission.state,
      revision: natural(admission.revision, `${name}.admission.revision`),
      tickets: natural(admission.tickets, `${name}.admission.tickets`),
      mutations: natural(admission.mutations, `${name}.admission.mutations`),
      uploadAttempts: natural(admission.uploadAttempts, `${name}.admission.uploadAttempts`),
    }),
  });
}

/** Compare only bounded, redacted facts derived from authorized reads and local D1 diagnostics. */
export function assertPreservedFallbackState(candidateSnapshot, knownGoodSnapshot) {
  const candidate = snapshot(candidateSnapshot, 'candidate snapshot');
  const knownGood = snapshot(knownGoodSnapshot, 'known-good snapshot');
  if (JSON.stringify(candidate) !== JSON.stringify(knownGood)) fail('known-good reads or admission counters do not preserve candidate state');
  return candidate;
}

export function passedFallbackReceipt({ candidate, knownGood, migrations, snapshot: value }) {
  const canonical = snapshot(value, 'preserved snapshot');
  return Object.freeze({
    mode: 'local-only-same-state',
    candidate: fullSha(candidate, 'candidate'),
    knownGood: fullSha(knownGood, 'known-good'),
    fallback: 'passed',
    migrationManifest: sha256(migrations, 'migration manifest'),
    canonical: canonical.canonical,
    resources: Object.freeze({ tickets: canonical.tickets, articles: canonical.articles, events: canonical.events }),
    admission: canonical.admission,
  });
}

export function unavailableFallbackReceipt({ candidate, knownGood, reason }) {
  const allowed = new Set(['migration_manifest_incompatible', 'runtime_schema_incompatible', 'loopback_port_unavailable']);
  if (!allowed.has(reason)) fail('fallback unavailability reason is not allowed');
  return Object.freeze({
    mode: 'local-only-same-state',
    candidate: fullSha(candidate, 'candidate'),
    knownGood: fullSha(knownGood, 'known-good'),
    fallback: 'unavailable',
    reason,
  });
}
