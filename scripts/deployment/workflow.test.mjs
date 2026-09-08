import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/isolated-environments.yml', import.meta.url), 'utf8');

test('trusted revision CLI checks out a real main commit and rejects malformed, missing and side-branch revisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tocyn-trusted-revision-'));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const script = fileURLToPath(new URL('./verify-trusted-revision.mjs', import.meta.url));
  const verify = revision => spawnSync(process.execPath, [script], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, TOCYN_REVISION: revision }
  });
  try {
    git(['init', '--initial-branch=main']);
    git(['config', 'user.name', 'Synthetic test']);
    git(['config', 'user.email', 'synthetic@example.test']);
    writeFileSync(join(directory, 'fixture.txt'), 'main fixture');
    git(['add', 'fixture.txt']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'main fixture']);
    const trusted = git(['rev-parse', 'HEAD']);
    git(['update-ref', 'refs/remotes/origin/main', trusted]);
    git(['checkout', '-b', 'untrusted']);
    writeFileSync(join(directory, 'fixture.txt'), 'side branch');
    git(['add', 'fixture.txt']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'side fixture']);
    const untrusted = git(['rev-parse', 'HEAD']);
    const valid = verify(trusted);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(git(['rev-parse', 'HEAD']), trusted);
    for (const revision of ['main', 'f'.repeat(40), untrusted]) {
      assert.notEqual(verify(revision).status, 0);
      assert.equal(git(['rev-parse', 'HEAD']), trusted);
    }
    assert.match(verify(untrusted).stderr, /not reachable from trusted origin\/main/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Worker secret verifier rejects a wrong config filename before file or provider access', () => {
  const script = fileURLToPath(new URL('./verify-worker-secrets.mjs', import.meta.url));
  for (const args of [[], ['/missing/wrangler.source.json']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: verify-worker-secrets/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
});

test('isolated release is manual, main-only, and uses hardcoded protected environments', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request_target|pull_request:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: tocyn-preview/);
  assert.match(workflow, /environment: tocyn-beta/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /verify-trusted-revision\.mjs/);
});

test('isolated release never performs provisioning, migrations, seeding, or credential-bearing artifact upload', () => {
  assert.doesNotMatch(workflow, /d1 migrations|--remote|seed:|setup:prod|pull_request_target|self-hosted/);
  const uploadSections = workflow.match(/- name: Upload the redacted release artifact[\s\S]*?(?=\n      - name:|$)/g) || [];
  assert.equal(uploadSections.length, 2);
  for (const section of uploadSections) assert.doesNotMatch(section, /CLOUDFLARE_API_TOKEN|TOCYN_ACCESS_CLIENT_SECRET|secrets\./);
  for (const job of workflow.split(/^  deploy-(?:preview|beta):/m).slice(1)) {
    const jobEnvironment = job.split(/^    steps:/m)[0];
    assert.doesNotMatch(jobEnvironment, /secrets\./);
  }
  assert.match(workflow, /\(cd apps\/server && npx eslint/);
  assert.match(workflow, /\n          npm test\n          npm run build --workspace=apps\/dashboard/);
});

test('parked release removes existing public and scheduled entry points while rehearsal verifies protected ingress', () => {
  assert.match(workflow, /TOCYN_RELEASE_MODE/);
  assert.match(workflow, /publish-pages\.mjs/);
  assert.match(workflow, /verify-restricted-ingress\.mjs/);
  assert.match(workflow, /verify-rollback\.mjs/);
  assert.match(workflow, /verify-release-artifact\.mjs/);
  assert.match(workflow, /TOCYN_ACCESS_READ_API_TOKEN/);
  assert.match(workflow, /TOCYN_PORTAL_PAGES_ALIAS_ACCESS_APPLICATION_IDS/);
  assert.match(workflow, /verify-pages-ingress-boundaries\.mjs/);
  assert.match(workflow, /actions\/download-artifact/);
  assert.match(workflow, /TOCYN_DEPLOY_DIR/);
  assert.match(workflow, /TOCYN_DEPLOY_REVISION/);
  assert.match(workflow, /test "\$TOCYN_REVISION" = "\$TOCYN_KNOWN_GOOD_REVISION"/);
  assert.doesNotMatch(workflow, /wrang\.deploy\.json/);
  assert.equal((workflow.match(/if: env\.TOCYN_OPERATION != 'rollback'/g) || []).length >= 12, true);
  const accessDiscovery = workflow.indexOf('Discover and prove Pages aliases are Access-protected');
  const ingressProbe = workflow.indexOf('Verify protected ingress with the synthetic Access identity');
  assert.ok(accessDiscovery > 0 && ingressProbe > accessDiscovery, 'alias discovery must precede service-token ingress probes');
});
