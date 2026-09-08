import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { digest, hashTree, verifyReleaseArtifact } from './verify-release-artifact.mjs';
import { assertManifestSet, prepareRelease } from './isolated-release.mjs';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const environment = {
  TOCYN_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111',
  TOCYN_D1_DATABASE_NAME: 'tocyn-preview-db',
  TOCYN_ATTACHMENTS_BUCKET: 'tocyn-preview-attachments',
  TOCYN_PORTAL_ORIGIN: 'https://portal.preview.example.test',
  TOCYN_DASHBOARD_ORIGIN: 'https://dashboard.preview.example.test',
  TOCYN_API_ORIGIN: 'https://api.preview.example.test'
};

function withEnvironment(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test('preview and beta manifests are explicit, isolated, and default-deny optional services', () => {
  assert.doesNotThrow(assertManifestSet);
});

test('release configuration accepts only exact isolated preview values', () => {
  const output = mkdtempSync(join(tmpdir(), 'tocyn-release-'));
  try {
    const { configuration, bindingManifest } = withEnvironment(environment, () => prepareRelease({ target: 'preview', revision, output, verifySource: false }));
    assert.equal(configuration.name, 'tocyn-api-preview');
    assert.equal(configuration.workers_dev, false);
    assert.equal(configuration.preview_urls, false);
    assert.deepEqual(configuration.routes, []);
    assert.deepEqual(configuration.triggers, { crons: [] });
    assert.deepEqual(configuration.vars.CORS_ORIGINS.split(','), [environment.TOCYN_PORTAL_ORIGIN, environment.TOCYN_DASHBOARD_ORIGIN]);
    assert.equal(configuration.vars.INBOUND_EMAIL_AUTH_VERIFIED, 'false');
    assert.equal(configuration.vars.DISABLE_RATE_LIMIT, 'false');
    for (const binding of ['ai', 'vectorize', 'workflows', 'queues', 'email']) assert.equal(Object.hasOwn(configuration, binding), false);
    assert.equal(bindingManifest.resources.d1DatabaseId, environment.TOCYN_D1_DATABASE_ID);
    assert.equal(readFileSync(join(output, 'wrangler.source.json'), 'utf8').includes('luminatick'), false);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('release configuration rejects a cross-environment resource, inherited identity, non-HTTPS origin, and non-SHA revision', () => {
  const output = mkdtempSync(join(tmpdir(), 'tocyn-release-'));
  try {
    assert.throws(() => withEnvironment({ ...environment, TOCYN_D1_DATABASE_NAME: 'tocyn-beta-db' }, () => prepareRelease({ target: 'preview', revision, output, verifySource: false })), /does not match/);
    assert.throws(() => withEnvironment({ ...environment, TOCYN_ATTACHMENTS_BUCKET: 'luminatick-attachments' }, () => prepareRelease({ target: 'preview', revision, output, verifySource: false })), /prohibited/);
    assert.throws(() => withEnvironment({ ...environment, TOCYN_PORTAL_ORIGIN: 'http://portal.preview.example.test' }, () => prepareRelease({ target: 'preview', revision, output, verifySource: false })), /HTTPS/);
    assert.throws(() => withEnvironment(environment, () => prepareRelease({ target: 'preview', revision: 'a'.repeat(40), output })), /checked-out HEAD/);
    assert.throws(() => withEnvironment(environment, () => prepareRelease({ target: 'preview', revision, output, mode: 'rehearse', verifySource: false })), /restricted ingress/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});


// A real miniature git checkout exercises the production CLI/source checks without
// asserting that synthetic bundle bytes demonstrate a real application build.
async function fixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'tocyn-packaging-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const source = join(temporary, 'checkout');
  const output = join(temporary, 'artifact');
  mkdirSync(join(source, 'scripts', 'deployment'), { recursive: true });
  for (const name of ['isolated-release.mjs', 'verify-release-artifact.mjs']) cpSync(new URL(name, import.meta.url), join(source, 'scripts', 'deployment', name));
  cpSync(new URL('../../deployment', import.meta.url), join(source, 'deployment'), { recursive: true });
  const put = (name, contents) => { mkdirSync(join(source, name, '..'), { recursive: true }); writeFileSync(join(source, name), contents); };
  put('.gitignore', 'dist/\n');
  put('apps/server/migrations/0001.sql', 'CREATE TABLE fixture (id TEXT);\n');
  put('apps/server/src/isolated-index.ts', 'export default {};\n');
  put('apps/dashboard/dist/index.html', '<main>Synthetic dashboard</main>');
  put('apps/portal/dist/index.html', '<main>Synthetic portal</main>');
  const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'fixture']); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Synthetic release fixture']);
  const fixtureRevision = git(['rev-parse', 'HEAD']);
  const api = await import(pathToFileURL(join(source, 'scripts/deployment/isolated-release.mjs')));
  const options = { target: 'preview', revision: fixtureRevision, output };
  withEnvironment(environment, () => api.prepareRelease(options));
  mkdirSync(join(output, 'worker'));
  writeFileSync(join(output, 'worker', 'isolated-index.js'), 'export default {};\n//# sourceMappingURL=isolated-index.js.map\n');
  writeFileSync(join(output, 'worker', 'isolated-index.js.map'), JSON.stringify({ sources: [join(source, 'apps/server/src/isolated-index.ts')] }));
  writeFileSync(join(output, 'worker', 'README.md'), `Built at ${Date.now()}`);
  writeFileSync(join(output, 'worker-meta.json'), JSON.stringify({ inputs: { 'apps/server/src/isolated-index.ts': {} } }));
  return { source, output, api, options, put, git };
}

test('production packaging accepts public environment values and is byte-reproducible across checkout roots', async t => {
  const first = await fixture(t); const second = await fixture(t);
  const a = withEnvironment(environment, () => first.api.packageRelease(first.options));
  const b = withEnvironment(environment, () => second.api.packageRelease(second.options));
  assert.equal(a.releaseDigest, b.releaseDigest);
  assert.equal(hashTree(first.output), hashTree(second.output));
  assert.equal(verifyReleaseArtifact(first.output, 'preview').provenance.releaseDigest, a.releaseDigest);
  const relocated = join(first.source, '..', 'relocated');
  cpSync(first.output, relocated, { recursive: true });
  assert.doesNotThrow(() => verifyReleaseArtifact(relocated, 'preview'));
  assert.throws(() => verifyReleaseArtifact(relocated, 'beta'), /environment/);
  assert.throws(() => first.api.packageRelease(first.options), /already packaged/);
});

test('packaging rejects source edits after preparation and conflicting package identity', async t => {
  const f = await fixture(t);
  f.put('apps/server/src/isolated-index.ts', 'export default { changed: true };');
  assert.throws(() => f.api.packageRelease(f.options), /source tree is not clean/);
  f.git(['restore', 'apps/server/src/isolated-index.ts']);
  assert.throws(() => f.api.packageRelease({ ...f.options, target: 'beta' }), /prepared release identity/);
  assert.throws(() => f.api.packageRelease({ ...f.options, mode: 'rehearse' }), /prepared release identity/);
});

test('packaging scans declared secrets throughout artifact bytes, including short secrets', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.output, 'worker', 'isolated-index.js'), 'export const leaked = "s3cr3t";');
  assert.throws(() => withEnvironment({ ...environment, JWT_SECRET: 's3cr3t' }, () => f.api.packageRelease(f.options)), /process secret/);
});

test('packaging and verification reject symbolic links', async t => {
  const f = await fixture(t);
  symlinkSync(join(f.source, 'apps/server/src/isolated-index.ts'), join(f.output, 'worker', 'linked.txt'));
  assert.throws(() => f.api.packageRelease(f.options), /symbolic link/);
  rmSync(join(f.output, 'worker', 'linked.txt'));
  f.api.packageRelease(f.options);
  symlinkSync(join(f.source, 'apps/server/src/isolated-index.ts'), join(f.output, 'worker', 'linked.txt'));
  assert.throws(() => verifyReleaseArtifact(f.output, 'preview'), /symbolic link/);
});

test('verification detects corruption of every deployable artifact and provenance', async t => {
  const f = await fixture(t);
  f.api.packageRelease(f.options);
  const cases = [
    ['worker/isolated-index.js', 'export default { changed: true };', /Worker/],
    ['migrations/0001.sql', 'DROP TABLE fixture;', /Migration/],
    ['frontend/dashboard/index.html', 'Changed dashboard', /dashboard/],
    ['frontend/portal/index.html', 'Changed portal', /portal/],
    ['wrangler.source.json', '{}', /Source configuration/],
    ['binding-manifest.json', '{}', /environment/],
    ['wrangler.deploy.json', '{}', /Deploy configuration/],
    ['provenance.json', JSON.stringify({ ...JSON.parse(readFileSync(join(f.output, 'provenance.json'))), releaseDigest: '0'.repeat(64) }), /Release digest/]
  ];
  for (const [name, changed, expected] of cases) {
    const path = join(f.output, name); const original = readFileSync(path);
    writeFileSync(path, changed);
    assert.throws(() => verifyReleaseArtifact(f.output, 'preview'), expected, name);
    writeFileSync(path, original);
  }
});

test('verification rejects an escaping entrypoint even with recomputed metadata hashes', async t => {
  const f = await fixture(t); f.api.packageRelease(f.options);
  const configPath = join(f.output, 'wrangler.deploy.json');
  const config = JSON.parse(readFileSync(configPath)); config.main = 'worker/../../outside.js';
  writeFileSync(configPath, JSON.stringify(config));
  const provenancePath = join(f.output, 'provenance.json');
  const provenance = JSON.parse(readFileSync(provenancePath)); provenance.deployConfigurationDigest = digest(config);
  delete provenance.releaseDigest; provenance.releaseDigest = digest(provenance);
  writeFileSync(provenancePath, JSON.stringify(provenance));
  assert.throws(() => verifyReleaseArtifact(f.output, 'preview'), /portable artifact/);
});

test('finalization validates existing artifact and binds raw provider receipt bytes', async t => {
  const f = await fixture(t); f.api.packageRelease(f.options);
  assert.throws(() => f.api.finalizeRelease(f.options), /provider receipt is required/);
  const receiptPath = join(f.output, 'provider-receipt.json');
  writeFileSync(receiptPath, '{"synthetic":true}\n');
  const finalized = f.api.finalizeRelease(f.options);
  assert.equal(finalized.providerReceiptDigest, digest(readFileSync(receiptPath)));
  assert.doesNotThrow(() => verifyReleaseArtifact(f.output, 'preview'));
  writeFileSync(receiptPath, '{"synthetic":false}\n');
  assert.throws(() => verifyReleaseArtifact(f.output, 'preview'), /Provider receipt/);
  assert.throws(() => f.api.finalizeRelease(f.options), /Provider receipt/);
});


test('packaging enforces the Worker browser and development-tooling boundary using build metadata', async t => {
  const f = await fixture(t);
  for (const path of ['apps/dashboard/src/main.tsx', '../apps/portal/src/main.tsx', 'apps/widget/src/widget.ts', '../../node_modules/react/index.js', '.agent-context/index.json', 'tools/agent-context/index.mjs']) {
    writeFileSync(join(f.output, 'worker-meta.json'), JSON.stringify({ inputs: { [path]: {} } }));
    assert.throws(() => f.api.packageRelease(f.options), /browser UI or development-agent tooling/);
  }
});
