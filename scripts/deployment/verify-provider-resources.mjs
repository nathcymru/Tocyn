import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyReleaseArtifact } from './verify-release-artifact.mjs';

function fail(message) { throw new Error(`Provider preflight failed: ${message}`); }
function hosts(value) {
  const add = (candidate, output) => {
    if (typeof candidate !== 'string' || !candidate) return;
    try { output.add(new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname.toLowerCase()); } catch { /* provider field is not a URL */ }
  };
  const output = new Set();
  if (typeof value?.subdomain === 'string') add(value.subdomain.includes('.') ? value.subdomain : `${value.subdomain}.pages.dev`, output);
  for (const domain of value?.domains || []) add(typeof domain === 'string' ? domain : domain?.name, output);
  add(value?.latest_deployment?.url, output);
  for (const deployment of value?.deployments || []) add(deployment?.url, output);
  return [...output].sort();
}

function parseIds(value, variable) {
  const ids = (value || '').split(',').map(id => id.trim()).filter(Boolean);
  if (!ids.length || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) fail(`${variable} must contain concrete Access application IDs for every Pages alias`);
  return ids;
}

function appProtectsHost(domain, host) {
  const normalised = String(domain || '').toLowerCase();
  return normalised === host || (normalised.startsWith('*.') && host.endsWith(normalised.slice(1)) && host !== normalised.slice(2));
}

function pagesBaseHost(projectMetadata) {
  const subdomain = projectMetadata?.subdomain;
  if (typeof subdomain !== 'string' || !subdomain) fail('Pages project has no concrete pages.dev subdomain');
  const host = subdomain.includes('.') ? subdomain.toLowerCase() : `${subdomain.toLowerCase()}.pages.dev`;
  if (!host.endsWith('.pages.dev')) fail('Pages project subdomain is not a pages.dev hostname');
  return host;
}

export async function verifyProviderResources({ release, environment, env = process.env, fetchImpl = fetch, verifyArtifact = verifyReleaseArtifact, writeReceipt = true }) {
  const { bindings } = verifyArtifact(release, environment);
  const accountId = env.TOCYN_CLOUDFLARE_ACCOUNT_ID;
  const resourceToken = env.TOCYN_RESOURCE_READ_API_TOKEN;
  const accessToken = env.TOCYN_ACCESS_READ_API_TOKEN;
  if (!/^[0-9a-f]{32}$/i.test(accountId || '') || !resourceToken || !accessToken) fail('protected account ID and read-only resource tokens are required');
  async function api(path, token) {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body?.success) fail(`read-only metadata request failed for ${path}`);
  return body.result;
}
async function access(origin, variable) {
  const id = env[variable];
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) fail(`${variable} must be a concrete Access application ID`);
  const result = await api(`/access/apps/${id}`, accessToken);
  if (result.type !== 'self_hosted' || result.domain !== new URL(origin).hostname) fail(`${variable} does not protect the selected artifact origin`);
  return { id, domain: result.domain };
}

async function pages(project, variable, selectedOrigin) {
  const projectMetadata = await api(`/pages/projects/${project}`, resourceToken);
  if (projectMetadata.name && projectMetadata.name !== project) fail(`Pages project metadata does not match ${project}`);
  const deployments = await api(`/pages/projects/${project}/deployments`, resourceToken);
  const base = pagesBaseHost(projectMetadata);
  const aliases = hosts({ ...projectMetadata, deployments: Array.isArray(deployments) ? deployments : [] }).filter(host => host !== new URL(selectedOrigin).hostname);
  if (!aliases.length) fail(`${project} has no discoverable Pages aliases; refuse publication without an enforceable alias boundary`);
  const applications = [];
  for (const id of parseIds(env[variable], variable)) {
    const result = await api(`/access/apps/${id}`, accessToken);
    if (result.type !== 'self_hosted' || !result.domain) fail(`${variable} includes an invalid Access application`);
    applications.push({ id, domain: result.domain });
  }
  if (!applications.some(application => application.domain === base)) fail(`${project} requires an exact Access application for ${base}`);
  if (!applications.some(application => application.domain === `*.${base}`)) fail(`${project} requires a wildcard Access application for *.${base}`);
  for (const alias of aliases) if (!applications.some(application => appProtectsHost(application.domain, alias))) fail(`${project} alias ${alias} is not protected by a selected Access application`);
  return { project, aliases, base, requiredWildcard: `*.${base}`, applications };
}

const database = await api(`/d1/database/${bindings.resources.d1DatabaseId}`, resourceToken);
if (database.uuid !== bindings.resources.d1DatabaseId || database.name !== bindings.resources.d1Database) fail('D1 metadata does not match the selected manifest');
const bucket = await api(`/r2/buckets/${bindings.resources.r2AttachmentsBucket}`, resourceToken);
if (bucket.name !== bindings.resources.r2AttachmentsBucket) fail('R2 metadata does not match the selected manifest');
const worker = await api(`/workers/services/${bindings.resources.apiWorker}`, resourceToken);
if (worker.name && worker.name !== bindings.resources.apiWorker) fail('Worker metadata does not match the selected manifest');
const dashboardPages = await pages(bindings.resources.dashboardPagesProject, 'TOCYN_DASHBOARD_PAGES_ALIAS_ACCESS_APPLICATION_IDS', bindings.origins.dashboard);
const portalPages = await pages(bindings.resources.portalPagesProject, 'TOCYN_PORTAL_PAGES_ALIAS_ACCESS_APPLICATION_IDS', bindings.origins.portal);
const receipt = {
  schemaVersion: 1, environment, accountId,
  resources: { d1DatabaseId: database.uuid, d1Database: database.name, r2AttachmentsBucket: bucket.name, apiWorker: bindings.resources.apiWorker, dashboardPagesProject: bindings.resources.dashboardPagesProject, portalPagesProject: bindings.resources.portalPagesProject },
  access: {
    api: await access(bindings.origins.api, 'TOCYN_API_ACCESS_APPLICATION_ID'),
    portal: await access(bindings.origins.portal, 'TOCYN_PORTAL_ACCESS_APPLICATION_ID'),
    dashboard: await access(bindings.origins.dashboard, 'TOCYN_DASHBOARD_ACCESS_APPLICATION_ID')
  },
  pages: {
    dashboard: { project: dashboardPages.project, base: dashboardPages.base, requiredWildcard: dashboardPages.requiredWildcard, applications: dashboardPages.applications },
    portal: { project: portalPages.project, base: portalPages.base, requiredWildcard: portalPages.requiredWildcard, applications: portalPages.applications }
  }
};
const receiptPath = join(release, 'provider-receipt.json');
if (env.TOCYN_VERIFY_PROVIDER_RECEIPT === 'true') {
  if (!existsSync(receiptPath) || JSON.stringify(JSON.parse(readFileSync(receiptPath, 'utf8'))) !== JSON.stringify(receipt)) fail('recorded provider receipt does not match current selected resources');
} else if (writeReceipt) {
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}
  return { ...receipt, observedPages: { dashboard: dashboardPages, portal: portalPages } };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [release, environment] = process.argv.slice(2);
  await verifyProviderResources({ release, environment });
}
