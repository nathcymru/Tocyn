import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/isolated-environments.yml', import.meta.url), 'utf8');

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
