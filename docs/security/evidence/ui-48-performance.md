# #48 performance evidence and remaining gates

The first reproducible production-bundle comparison is `ui-48-bundle-fcba36f.json`. It compares candidatefcba36f against local baseline1c684300, whose tree66fa3650113b6302d8bdc49b83615e6598e1c445 matches accepted main6299bfef. Both source trees were tracked-clean when built; Vite8.2.2 and Node22.19.0 were used for both. No new dependency installation was needed for the builds.

| Client | Baseline JS gzip bytes | Candidate JS gzip bytes | Change |
|---|---:|---:|---:|
| Dashboard | 486232 | 521976 | +7.35% |
| Portal | 77808 | 97197 | +24.92% |
| Widget | 143978 | 157150 | +9.15% |

These are sums of individually gzip-level9-compressed JS assets, not initial-route transfer, startup latency or interaction response time. CSS totals, artifact hashes, lockfile hashes, revision/tree and tool metadata are in JSON. The portal increase requires investigation before numeric budgets can be accepted. No pass threshold has been invented or relaxed; the existing large-chunk warning remains.

## Reproduce

In each baseline/candidate checkout, using the same Node/tool environment, run each production client build:

```sh
npm run build --workspace=apps/dashboard -- --manifest
npm run build --workspace=apps/portal -- --manifest
npm run build --workspace=apps/widget -- --manifest
```

Then, from the candidate checkout:

```sh
node tools/ui-performance/bundle-evidence.mjs BASELINE_ROOT CANDIDATE_ROOT > comparison.json
```

Use fresh outputs; the tool does not run builds or attest that ignored dist files match source. Two consecutive measurements of these freshly built outputs matched exactly after removing the generation timestamp. Historical baseline data must stay immutable; capture later candidates separately.

## Outstanding acceptance

- Ratified numeric bundle/startup/interaction regression budgets enforced in CI, after investigating measured growth.
- Controlled real-browser startup/first-usable and retained interaction timing on the same environment for baseline and candidate. Existing Safari focus evidence and JSDOM tests do not supply timing.
- Actual final-revision Worker bundle/import and local runtime evidence. Existing isolated-release metadata validation rejects browser React/client/agent-tool inputs, but its unit tests alone do not prove the current built Worker graph or cold-start timing.
- Full #48 retained-control/accessibility acceptance remains required; themes #66 and wrapper #67 retain separate ownership.

The resumed native worker inspected existing test/harness capabilities read-only and completed. No separate allowance, model switch, Copilot review or runtime measurement is claimed from that investigation.

Validation environment repair: the existing rehearsal tests first failed because this worktree lacked the installed better-sqlite3 native binding. `npm rebuild better-sqlite3 --build-from-source` repaired it without changing dependencies. The repeated isolated-release/rehearsal contract suite passed37tests and direct rehearsal runtime passed3tests. This validates those existing contracts, not current UI timing or an actual Worker graph comparison.

## Portal route split — candidate70a7a35

Fresh manifest builds now distinguish all JS/CSS assets from the initial entrypoint/static-import closure. Dynamic route assets stay included in totals. `ui-48-bundle-70a7a35.json` records clean baseline/candidate revisions and all artifact hashes.

- Portal initial JS gzip:77808 →67502bytes (**−13.24%** versus accepted baseline).
- Portal all-route JS gzip:77808 →99830bytes (**+28.30%** versus accepted baseline; splitting overhead raises the prior candidate total97197bytes).
- The authenticated ticket pages and shared dialog code load when their routes render. Login/verify and the existing authentication-generation checks remain eager and unchanged.
- Loading is announced; a module/render failure focuses a safe message and offers a document reload instead of retrying React's cached lazy rejection. The boundary does not change authentication state.

Portal61tests, TypeScript/build and lint pass. No browser startup/interaction timing or numeric performance-budget pass is inferred. The increased total remains visible and needs acceptance investigation; the initial-payload improvement does not replace that metric.

## Controlled local browser harness

`tools/ui-performance/browser-evidence.mjs` loads fresh production login routes for dashboard and portal in isolated Chromium contexts, with serial alternating baseline/candidate samples. It measures usable-submit observation and native-click-to-visible synthetic-denial recovery, preserving raw samples and nearest-rank p50/p95/p99 alongside revision, artifact and tool metadata. All requests stay on a temporary127.0.0.1 static server; outbound requests are blocked, and authentication/config responses are synthetic. No real credentials, mail or provider are used.

Use the installed Playwright runtime via Node module resolution (for example an explicit `NODE_PATH` to the approved bundled runtime); the harness never downloads browsers. After fresh baseline/candidate builds, run:

```sh
node tools/ui-performance/browser-evidence.mjs BASELINE_ROOT CANDIDATE_ROOT 20 > browser-comparison.json
node --test tools/ui-performance/browser-evidence.test.mjs
```

Limits: warm browser/OS caches, fresh browser contexts, no-store uncompressed assets, no throttling, shared machine load, reduced motion, startup observation overhead and two-animation-frame rendering approximation. This is a login-only performance scenario, not cold-start, backend authentication, authenticated workspace, widget or full accessibility acceptance. Numeric CI budgets remain open until the measured regression profile is assessed; the harness does not declare a performance pass.

## Chromium login measurement — candidate3e08914

Fresh production manifest builds for all three clients on both clean source trees passed. Twenty recorded samples per side/client (80 total), after one warmup per side, are in `ui-48-browser-3e08914.json`. Baseline remains1c684300, tree-equivalent to accepted main6299bfef. Playwright1.62.1, Chromium151.0.7922.34, Node22.19.0, macOS arm64.

| Scenario (milliseconds) | Baseline p50 / p95 / p99 | Candidate p50 / p95 / p99 |
|---|---:|---:|
| dashboard startupMs | 157.6 / 163.9 / 163.9 | 162.0 / 174.8 / 182.9 |
| dashboard recoveryMs | 48.0 / 48.3 / 48.5 | 48.1 / 48.5 / 48.8 |
| portal startupMs | 60.7 / 64.3 / 65.5 | 60.3 / 62.7 / 62.9 |
| portal recoveryMs | 64.6 / 65.0 / 65.4 | 64.4 / 64.8 / 64.9 |

No large login timing regression appeared in this local sample; differences of a few milliseconds are not evidence of a general speedup. The portal route split's byte reduction is stronger evidence than a small timing difference in this unthrottled warm-process environment. The stated limits and outstanding authenticated/workspace/widget/numeric-budget gates remain unchanged.

## Dashboard route split — candidatea52904f

Dashboard protected routes now load on demand with the same accessible loading/error recovery contract as the portal. Login, MFA and enforced security setup remain eager. The unchanged application sources were freshly built immediately before committinga52904f; the timing snapshot records its clean revision and built artifact hashes. Prior baseline/portal/widget artifacts remain from the previously documented fresh builds; those application sources did not change.

`ui-48-browser-a52904f.json` records another80alternating samples under the same local browser scenario. Dashboard startup p95:164.1→63.7ms; recovery p95:48.7→49.9ms. Portal startup p95:63.4→61.7ms; recovery65.0→64.9ms. These remain local warm-process measurements, not production promises.

Dashboard initial JS gzip drops486232→125880bytes(−74.1%); all-route JS grows486232→543977bytes(+11.9%). The deferred knowledge-editor chunk still accounts for much of the total. Portal initial67502/all-route99830bytes remain unchanged. Keep total-cost growth visible; initial loading gains do not satisfy all-route/numeric-budget/authenticated-interaction gates.134dashboardtests andTypeScript/build pass.
