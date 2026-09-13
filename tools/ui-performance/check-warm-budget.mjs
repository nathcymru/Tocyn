import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WARM_RULE = Object.freeze({
  version: 1, condition: 'tiny-m3-ac-1280x800-reduced',
  metric: 'return-to-A-useful-render-ms', statistic: 'nearest-rank-p95', samples: 20, maximumMs: 80,
});
const sourcePaths = [
  'tools/ui-performance/authenticated-navigation.ts', 'apps/server/scripts/ui-authenticated-navigation.test.ts',
  'apps/dashboard/src/pages/InboxWorkspacePage.tsx', 'apps/dashboard/src/pages/TicketDetailPage.tsx',
  'apps/portal/src/pages/TicketListPage.tsx', 'apps/portal/src/pages/TicketDetailPage.tsx',
];
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function exact(value, expected, message) { requireValue(isDeepStrictEqual(value, expected), message); }
function validProvenance(value) {
  requireValue(value && /^[a-f0-9]{40}$/.test(value.revision) && typeof value.dirty === 'boolean', 'Invalid expected source revision');
  exact(Object.keys(value.sourceHashes ?? {}).sort(), [...sourcePaths].sort(), 'Incomplete source hashes');
  requireValue(Object.values(value.sourceHashes).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)), 'Invalid source hash');
  exact(Object.keys(value.artifacts ?? {}).sort(), ['dashboard', 'portal'], 'Incomplete build hashes');
  requireValue(Object.values(value.artifacts).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)), 'Invalid build hash');
}

/** Expected provenance must come from the trusted build/run handoff, not the receipt under test. */
export function checkWarmBudget(receipt, expectedProvenance, rule = WARM_RULE) {
  exact(rule, WARM_RULE, 'Unsupported metric or budget rule');
  validProvenance(expectedProvenance);
  requireValue(receipt?.version === 1 && receipt.kind === 'tocyn-local-authenticated-ticket-navigation', 'Unsupported receipt');
  const provenance = { revision: receipt.revision, dirty: receipt.dirty, sourceHashes: receipt.sourceHashes, artifacts: receipt.artifacts };
  validProvenance(provenance);
  exact(provenance, expectedProvenance, 'Receipt source/build provenance differs from expected handoff');
  const environment = receipt.environment;
  requireValue(environment?.platform === 'darwin' && environment.headless === true && environment.reducedMotion === 'reduce'
    && environment.remoteBindings === 0 && environment.synthetic === true, 'Unsupported execution condition');
  requireValue(environment.browser === '151.0.7922.34' && environment.playwright === '1.62.1'
    && environment.node === 'v22.19.0', 'Unsupported recorded browser/runtime');
  exact(environment.viewport, { width: 1280, height: 800 }, 'Unsupported viewport');
  const warm = receipt.warmSwitches;
  requireValue(warm?.condition === 'same-context-previsited' && warm.cycles === 20 && warm.warmupVisits === 3, 'Unsupported warm condition');
  requireValue(warm.hardware === 'Apple M3; 16 GiB RAM' && typeof warm.power === 'string' && warm.power.startsWith('AC attached;'), 'Unsupported declared hardware/power');
  if (warm.profile !== undefined) exact(warm.profile, {name:'tiny',articlesPerTicket:1,bytesPerArticle:35}, 'Unsupported workload profile');
  requireValue(Array.isArray(warm.tickets) && warm.tickets.length === 2 && new Set(warm.tickets.map(ticket => ticket.id)).size === 2
    && warm.tickets.every(ticket => typeof ticket.id === 'string' && ticket.id.length > 0 && ticket.articles === 1 && ticket.bodyBytes === 35), 'Unsupported tiny fixture');
  requireValue(Array.isArray(warm.samples) && warm.samples.length === 40, 'Expected twenty samples for each warm leg');
  const seen = new Set(); const returns = [];
  for (const sample of warm.samples) {
    requireValue(Number.isInteger(sample.cycle) && sample.cycle >= 0 && sample.cycle < 20
      && ['A-to-B', 'B-to-A'].includes(sample.leg), 'Invalid cycle or leg');
    const identity = `${sample.cycle}:${sample.leg}`;
    requireValue(!seen.has(identity), 'Duplicate warm sample'); seen.add(identity);
    requireValue(typeof sample.usefulRenderMs === 'number' && Number.isFinite(sample.usefulRenderMs) && sample.usefulRenderMs >= 0, 'Invalid raw timing');
    requireValue(Array.isArray(sample.detailReads) && sample.detailReads.length <= 64
      && sample.detailReads.every(read => read.status === 200 && typeof read.completionFromClickDriverMs === 'number'
        && Number.isFinite(read.completionFromClickDriverMs) && read.completionFromClickDriverMs >= 0), 'Invalid observed detail response');
    if (sample.leg === 'B-to-A') returns.push(sample.usefulRenderMs);
  }
  requireValue(returns.length === rule.samples, 'Expected twenty return-to-A samples');
  returns.sort((a, b) => a - b);
  const p95Ms = returns[Math.ceil(returns.length * 0.95) - 1];
  // Stored summaries are deliberately ignored; only raw observations determine the result.
  return Object.freeze({ passed: p95Ms <= rule.maximumMs, metric: rule.metric, samples: returns.length,
    p95Ms, maximumMs: rule.maximumMs, condition: rule.condition, thresholdEvaluated: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireValue(process.argv.length === 4, 'Usage: node check-warm-budget.mjs RECEIPT.json EXPECTED-PROVENANCE.json');
    const boundedJson = path => {
      const bytes = readFileSync(path); requireValue(bytes.length <= 1024 * 1024, 'Receipt/provenance exceeds 1 MiB');
      return JSON.parse(bytes.toString('utf8'));
    };
    const result = checkWarmBudget(boundedJson(process.argv[2]), boundedJson(process.argv[3]));
    console.log(JSON.stringify(result)); process.exitCode = result.passed ? 0 : 1;
  } catch (error) { console.error(error instanceof Error ? error.message : 'Invalid warm receipt'); process.exitCode = 1; }
}
