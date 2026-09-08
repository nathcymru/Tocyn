import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactFiles, digest, hashTree, portableSourceConfiguration, verifyReleaseArtifact } from './verify-release-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestDirectory = join(root, 'deployment');
const environments = new Set(['preview', 'beta']);
const releaseModes = new Set(['park', 'rehearse']);
const disabledBindings = new Set(['ai', 'vectorize', 'workflows', 'queues', 'email']);
const requiredSecrets = ['JWT_SECRET', 'MFA_ENCRYPTION_KEY', 'APP_MASTER_KEY', 'OUTBOUND_EMAIL_RECIPIENT_ALLOWLIST'];

function fail(message) {
  throw new Error(`Isolated release configuration rejected: ${message}`);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function assertCheckedOutRevision(revision, { clean = true } = {}) {
  if (git(['rev-parse', 'HEAD']) !== revision) fail('checked-out HEAD does not match the declared revision');
  if (clean && git(['status', '--porcelain', '--untracked-files=all'])) fail('release source tree is not clean');
}

function readManifest(target) {
  if (!environments.has(target)) fail(`unknown environment ${JSON.stringify(target)}`);
  const manifest = JSON.parse(readFileSync(join(manifestDirectory, `${target}.json`), 'utf8'));
  if (manifest.environment !== target) fail(`manifest/environment mismatch for ${target}`);
  return manifest;
}

function exactHttpsOrigin(name, value) {
  if (!value) fail(`${name} is required`);
  let url;
  try { url = new URL(value); } catch { fail(`${name} must be an HTTPS origin`); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.origin !== value) {
    fail(`${name} must be an exact HTTPS origin without a path, credentials, query, or fragment`);
  }
  return url.origin;
}

function requireEnvironmentValue(name) {
  const value = process.env[name];
  if (!value || value.trim() !== value) fail(`${name} is required`);
  if (/luminatick|production/i.test(value)) fail(`${name} contains a prohibited inherited or production identifier`);
  return value;
}

function d1Id() {
  const value = requireEnvironmentValue('TOCYN_D1_DATABASE_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    fail('TOCYN_D1_DATABASE_ID must be a concrete D1 UUID');
  }
  return value;
}

export function assertManifestSet() {
  const manifests = [...environments].map(readManifest);
  const identities = new Set();
  for (const manifest of manifests) {
    if (JSON.stringify(manifest.requiredSecrets) !== JSON.stringify(requiredSecrets)) fail(`${manifest.environment} has an unexpected secret manifest`);
    if (manifest.ingress?.workersDev !== false || !Array.isArray(manifest.ingress?.routes) || manifest.ingress.routes.length !== 0) {
      fail(`${manifest.environment} must have public ingress disabled until the owner approves an access boundary`);
    }
    for (const capability of ['ai', 'vectorize', 'vectorizeWorkflow', 'emailRouting', 'cron', 'queues', 'webhooks']) {
      if (!manifest.disabledCapabilities.includes(capability)) fail(`${manifest.environment} enables ${capability}`);
    }
    for (const [kind, identity] of Object.entries(manifest.resources)) {
      if (!identity || /luminatick|production/i.test(identity)) fail(`${manifest.environment} has an unsafe ${kind} identity`);
      if (identities.has(identity)) fail(`resource identity ${identity} is shared between isolated environments`);
      identities.add(identity);
    }
  }
}

function runtimeValues(manifest) {
  const portalOrigin = exactHttpsOrigin('TOCYN_PORTAL_ORIGIN', requireEnvironmentValue('TOCYN_PORTAL_ORIGIN'));
  const dashboardOrigin = exactHttpsOrigin('TOCYN_DASHBOARD_ORIGIN', requireEnvironmentValue('TOCYN_DASHBOARD_ORIGIN'));
  const apiOrigin = exactHttpsOrigin('TOCYN_API_ORIGIN', requireEnvironmentValue('TOCYN_API_ORIGIN'));
  if (new Set([portalOrigin, dashboardOrigin, apiOrigin]).size !== 3) fail('portal, dashboard, and API origins must be distinct');
  const d1DatabaseName = requireEnvironmentValue('TOCYN_D1_DATABASE_NAME');
  const attachmentsBucket = requireEnvironmentValue('TOCYN_ATTACHMENTS_BUCKET');
  if (d1DatabaseName !== manifest.resources.d1Database) fail('TOCYN_D1_DATABASE_NAME does not match the selected environment manifest');
  if (attachmentsBucket !== manifest.resources.r2AttachmentsBucket) fail('TOCYN_ATTACHMENTS_BUCKET does not match the selected environment manifest');
  return { portalOrigin, dashboardOrigin, apiOrigin, d1DatabaseName, attachmentsBucket, databaseId: d1Id() };
}

function restrictedIngress(values) {
  if (process.env.TOCYN_RESTRICTED_INGRESS_APPROVED !== 'true') fail('restricted ingress requires an explicit protected-environment approval value');
  return { route: values.apiOrigin };
}

function workerConfiguration(manifest, values, mode) {
  const configuration = {
    name: manifest.resources.apiWorker,
    main: resolve(root, 'apps/server/src/isolated-index.ts'),
    compatibility_date: '2026-09-08',
    compatibility_flags: ['nodejs_compat'],
    minify: true,
    workers_dev: false,
    preview_urls: false,
    routes: [],
    d1_databases: [{ binding: 'DB', database_name: values.d1DatabaseName, database_id: values.databaseId, migrations_dir: resolve(root, 'apps/server/migrations') }],
    r2_buckets: [{ binding: 'ATTACHMENTS_BUCKET', bucket_name: values.attachmentsBucket }],
    durable_objects: { bindings: [{ name: 'NOTIFICATION_DO', class_name: 'NotificationDO' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['NotificationDO'] }],
    triggers: { crons: [] },
    vars: {
      ENVIRONMENT: manifest.environment,
      PORTAL_URL: values.portalOrigin,
      DASHBOARD_URL: values.dashboardOrigin,
      CORS_ORIGINS: [values.portalOrigin, values.dashboardOrigin].join(','),
      INBOUND_EMAIL_AUTH_VERIFIED: 'false',
      DISABLE_RATE_LIMIT: 'false'
    },
    observability: { enabled: false }
  };
  if (mode === 'rehearse') {
    const ingress = restrictedIngress(values);
    configuration.routes = [{ pattern: new URL(ingress.route).hostname, custom_domain: true }];
  }
  return configuration;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || values.has(key)) fail('arguments must be named once');
    values.set(key, value);
  }
  return values;
}

export function prepareRelease({ target, revision, output, mode = 'park', verifySource = true }) {
  assertManifestSet();
  if (!/^[0-9a-f]{40}$/i.test(revision)) fail('revision must be an immutable 40-character SHA');
  if (!releaseModes.has(mode)) fail('mode must be park or rehearse');
  if (verifySource) assertCheckedOutRevision(revision);
  if (!output || !isAbsolute(output) || (resolve(output) === root || root.startsWith(resolve(output) + sep) || resolve(output) === sep)) fail('output must be a specific absolute release directory');
  const manifest = readManifest(target);
  const values = runtimeValues(manifest);
  const configuration = workerConfiguration(manifest, values, mode);
  for (const key of disabledBindings) if (Object.hasOwn(configuration, key)) fail(`generated configuration enables ${key}`);
  rmSync(output, { recursive: true, force: true });
  const bindingManifest = {
    schemaVersion: 1,
    environment: target,
    mode,
    revision,
    resources: { ...manifest.resources, d1DatabaseId: values.databaseId },
    origins: { portal: values.portalOrigin, dashboard: values.dashboardOrigin, api: values.apiOrigin },
    requiredSecrets: manifest.requiredSecrets,
    disabledCapabilities: manifest.disabledCapabilities,
    ingress: manifest.ingress,
    runtime: configuration.vars,
    workerConfigurationDigest: digest(portableSourceConfiguration(configuration))
  };
  writeJson(join(output, 'wrangler.source.json'), configuration);
  writeJson(join(output, 'binding-manifest.json'), bindingManifest);
  return { configuration, bindingManifest };
}

function hashFile(path) { return digest(readFileSync(path)); }

export function packageRelease({ target, revision, output, mode = 'park', verifySource = true }) {
  const release = resolve(output);
  if (verifySource) assertCheckedOutRevision(revision);
  assertManifestSet();
  if (!environments.has(target) || !releaseModes.has(mode) || !/^[0-9a-f]{40}$/i.test(revision || '')) fail('invalid release identity');
  artifactFiles(release);
  if (existsSync(join(release, 'provenance.json'))) fail('release is already packaged; prepare a fresh build');
  const metadataPath = join(release, 'worker-meta.json');
  if (!existsSync(metadataPath)) fail('Worker build metadata is required to check bundle boundaries');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (!metadata.inputs || Object.keys(metadata.inputs).length === 0 || Object.keys(metadata.inputs).some(name => /(?:^|\/)apps\/(?:dashboard|portal|widget)\/|(?:^|\/)node_modules\/react(?:-dom)?\/|(?:^|\/)(?:\.agents|\.agent-context|tools\/agent-context)\//.test(name.replaceAll('\\', '/')))) fail('Worker bundle contains browser UI or development-agent tooling');
  const sourceConfig = join(release, 'wrangler.source.json');
  const workerDirectory = join(release, 'worker');
  if (!existsSync(sourceConfig) || !existsSync(workerDirectory)) fail('prepare and worker bundle steps must complete before packaging');
  const workerFiles = readdirSync(workerDirectory).filter(name => name.endsWith('.js'));
  if (workerFiles.length !== 1) fail('worker bundle must contain exactly one JavaScript entrypoint');
  const rawSource = JSON.parse(readFileSync(sourceConfig, 'utf8'));
  if (rawSource.main !== resolve(root, 'apps/server/src/isolated-index.ts') || rawSource.d1_databases?.[0]?.migrations_dir !== resolve(root, 'apps/server/migrations')) fail('prepared source paths no longer match the checked-out build inputs');
  const source = portableSourceConfiguration(rawSource);
  const bindingManifest = JSON.parse(readFileSync(join(release, 'binding-manifest.json'), 'utf8'));
  if (bindingManifest.environment !== target || bindingManifest.revision !== revision || bindingManifest.mode !== mode || bindingManifest.workerConfigurationDigest !== digest(source)) fail('prepared release identity or configuration does not match packaging inputs');
  const deploymentConfig = structuredClone(source);
  // Wrangler emits local debug paths and a timestamped README, neither deployed.
  for (const name of artifactFiles(workerDirectory)) {
    if (name.endsWith('.map') || name === 'README.md') rmSync(join(workerDirectory, name));
  }
  const entrypoint = join(workerDirectory, workerFiles[0]);
  writeFileSync(entrypoint, readFileSync(entrypoint, 'utf8').replace(/\n?\/\/# sourceMappingURL=[^\r\n]+[\r\n]*$/, '\n'));
  rmSync(join(release, 'worker-meta.json'), { force: true });
  rmSync(join(release, '.wrangler'), { recursive: true, force: true });
  writeJson(sourceConfig, source);
  deploymentConfig.main = join('worker', workerFiles[0]);
  deploymentConfig.d1_databases[0].migrations_dir = 'migrations';
  hashTree(join(root, 'apps/server/migrations'));
  rmSync(join(release, 'migrations'), { recursive: true, force: true });
  cpSync(join(root, 'apps/server/migrations'), join(release, 'migrations'), { recursive: true });
  writeJson(join(release, 'wrangler.deploy.json'), deploymentConfig);
  const frontend = {};
  for (const app of ['dashboard', 'portal']) {
    const directory = join(root, 'apps', app, 'dist');
    if (!existsSync(directory)) fail(`${app} build output is missing`);
    const artifactDirectory = join(release, 'frontend', app);
    hashTree(directory);
    rmSync(artifactDirectory, { recursive: true, force: true });
    cpSync(directory, artifactDirectory, { recursive: true });
    frontend[app] = hashTree(artifactDirectory);
  }
  const provenance = {
    schemaVersion: 1,
    environment: target,
    mode,
    revision,
    bindingManifestDigest: digest(bindingManifest),
    sourceConfigurationDigest: digest(source),
    migrationsDigest: hashTree(join(release, 'migrations')),
    workerBundleDigest: hashTree(workerDirectory),
    deployConfigurationDigest: digest(deploymentConfig),
    frontend
  };
  provenance.releaseDigest = digest(provenance);
  for (const name of requiredSecrets) {
    const secret = process.env[name];
    if (!secret) continue;
    if (artifactFiles(release).some(name => readFileSync(join(release, name)).includes(Buffer.from(secret)))) {
      fail('a process secret was written to the release artifact');
    }
  }
  writeJson(join(release, 'provenance.json'), provenance);
  verifyReleaseArtifact(release, target);
  return provenance;
}

export function finalizeRelease({ output }) {
  const provenancePath = join(resolve(output), 'provenance.json');
  const receiptPath = join(resolve(output), 'provider-receipt.json');
  if (!existsSync(provenancePath) || !existsSync(receiptPath)) fail('provider receipt is required before finalizing a deployable release');
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  verifyReleaseArtifact(resolve(output), provenance.environment);
  provenance.providerReceiptDigest = hashFile(receiptPath);
  delete provenance.releaseDigest;
  provenance.releaseDigest = digest(provenance);
  writeJson(provenancePath, provenance);
  return provenance;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArguments(rest);
  const target = args.get('--target'); const revision = args.get('--revision'); const output = args.get('--output'); const mode = args.get('--mode') || 'park';
  const result = command === 'prepare' ? prepareRelease({ target, revision, output, mode }) : command === 'package' ? packageRelease({ target, revision, output, mode }) : command === 'finalize' ? finalizeRelease({ output }) : fail('command must be prepare, package, or finalize');
  if (command === 'package') console.log(JSON.stringify({ environment: result.environment, revision: result.revision, releaseDigest: result.releaseDigest }));
}
