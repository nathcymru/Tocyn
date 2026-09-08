import { readFileSync } from 'node:fs';
import { verifyReleaseArtifact } from './verify-release-artifact.mjs';

function fail(message) { throw new Error(`Restricted ingress verification failed: ${message}`); }

export async function verifyRestrictedIngress({ release, environment, aliasesPath, env = process.env, fetchImpl = fetch, verifyArtifact = verifyReleaseArtifact }) {
if (!release || !['preview', 'beta'].includes(environment)) fail('a release artifact and protected environment are required');
const { bindings } = verifyArtifact(release, environment);
const receipt = JSON.parse(readFileSync(aliasesPath || `${release}/provider-receipt.json`, 'utf8'));
const aliases = [...(receipt.pages?.dashboard?.aliases || []), ...(receipt.pages?.portal?.aliases || [])].map(host => `https://${host}`);
const origins = [bindings.origins.api, bindings.origins.portal, bindings.origins.dashboard, ...aliases];
if (!origins.every(value => /^https:\/\/[^/?#]+$/i.test(value))) fail('artifact does not contain exact HTTPS origins');
const clientId = env.TOCYN_ACCESS_CLIENT_ID;
const clientSecret = env.TOCYN_ACCESS_CLIENT_SECRET;
if (!clientId || !clientSecret) fail('protected Access service-token credentials are required');

async function request(url, headers = {}) {
  const response = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  await response.body?.cancel();
  return response.status;
}

for (const [index, origin] of origins.entries()) {
  const url = index === 0 ? `${origin}/health` : origin;
  const anonymous = await request(url);
  if (![401, 403].includes(anonymous)) fail(`${url} did not reject anonymous access`);
  const authorised = await request(url, { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret });
  if (authorised !== 200) fail(`${url} did not accept the protected test identity`);
}
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [release, environment, aliasesPath] = process.argv.slice(2);
  await verifyRestrictedIngress({ release, environment, aliasesPath });
}
