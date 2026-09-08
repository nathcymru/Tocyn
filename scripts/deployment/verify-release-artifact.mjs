import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}
export function artifactFiles(path) {
  const files = [];
  const visit = child => {
    const stat = lstatSync(child);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Artifact contains a symbolic link or special file');
    if (stat.isDirectory()) for (const name of readdirSync(child).sort()) visit(join(child, name));
    else files.push(relative(path, child).split(sep).join('/'));
  };
  visit(path);
  return files;
}
export function hashTree(path) {
  return digest(artifactFiles(path).map(name => [name, digest(readFileSync(join(path, name)))]));
}
export function portableSourceConfiguration(configuration) {
  const portable = structuredClone(configuration);
  portable.main = 'apps/server/src/isolated-index.ts';
  portable.d1_databases[0].migrations_dir = 'apps/server/migrations';
  return portable;
}

export function verifyReleaseArtifact(release, expectedEnvironment) {
  release = resolve(release);
  artifactFiles(release);
  const provenance = JSON.parse(readFileSync(join(release, 'provenance.json'), 'utf8'));
  const bindings = JSON.parse(readFileSync(join(release, 'binding-manifest.json'), 'utf8'));
  const configuration = JSON.parse(readFileSync(join(release, 'wrangler.deploy.json'), 'utf8'));
  const source = JSON.parse(readFileSync(join(release, 'wrangler.source.json'), 'utf8'));
  if (!['preview', 'beta'].includes(expectedEnvironment) || provenance.environment !== expectedEnvironment || bindings.environment !== expectedEnvironment) throw new Error('Artifact environment does not match the protected target');
  if (provenance.schemaVersion !== 1 || bindings.schemaVersion !== 1 || !/^[0-9a-f]{40}$/i.test(provenance.revision || '') || provenance.revision !== bindings.revision || !['park', 'rehearse'].includes(provenance.mode) || provenance.mode !== bindings.mode) throw new Error('Artifact revision or release mode does not match its binding manifest');
  const { releaseDigest, ...unsigned } = provenance;
  if (releaseDigest !== digest(unsigned)) throw new Error('Release digest does not match provenance');
  if (provenance.bindingManifestDigest !== digest(bindings)) throw new Error('Binding manifest digest does not match provenance');
  if (provenance.deployConfigurationDigest !== digest(configuration)) throw new Error('Deploy configuration digest does not match provenance');
  if (provenance.sourceConfigurationDigest !== digest(source) || bindings.workerConfigurationDigest !== digest(source) || digest(source) !== digest(portableSourceConfiguration(configuration))) throw new Error('Source configuration does not match provenance or deployment configuration');
  if (configuration.name !== bindings.resources.apiWorker || !/^worker\/[A-Za-z0-9_-]+\.js$/.test(configuration.main) || configuration.d1_databases?.[0]?.migrations_dir !== 'migrations' || !existsSync(join(release, configuration.main))) throw new Error('Deploy configuration is not a portable artifact for the selected stack');
  if (provenance.workerBundleDigest !== hashTree(join(release, 'worker'))) throw new Error('Worker artifact does not match provenance');
  for (const app of ['dashboard', 'portal']) {
    const directory = join(release, 'frontend', app);
    if (!existsSync(directory) || provenance.frontend?.[app] !== hashTree(directory)) throw new Error(`${app} artifact does not match provenance`);
  }
  if (!existsSync(join(release, 'migrations')) || provenance.migrationsDigest !== hashTree(join(release, 'migrations'))) throw new Error('Migration inputs do not match provenance');
  if (provenance.providerReceiptDigest && provenance.providerReceiptDigest !== digest(readFileSync(join(release, 'provider-receipt.json')))) throw new Error('Provider receipt does not match provenance');
  return { provenance, bindings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [release, environment] = process.argv.slice(2);
  if (!release || !environment) throw new Error('Usage: verify-release-artifact.mjs <release-directory> <preview|beta>');
  verifyReleaseArtifact(release, environment);
}
