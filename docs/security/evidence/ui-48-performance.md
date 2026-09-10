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
npm run build --workspace=apps/dashboard
npm run build --workspace=apps/portal
npm run build --workspace=apps/widget
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
