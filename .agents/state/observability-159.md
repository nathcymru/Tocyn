# #159 implementation checkpoint

## Current next actions (supersedes earlier queues below)

Draft PR170 remains partial. Exact clean07c2e0333fb1cf8b21998da44a9c207a0d25e0a7 receipt is retained under docs/security/evidence/:60expected measured outcomes,0unexpected/transport failures,65total requests, disposed local fixture. Authenticated-metadata p95 in this run is132.476ms; this is a local concurrent observation, not a deployed Worker threshold or a regression claim against differently loaded runs. CI on07c2e03 passed all required checks.

Sampler failure handling now drains started requests and stops new scheduling before returning a clock error; five sampler tests and its TypeScript check pass. Initial SLI denominators/numerators/windows, collector status and alert/runbook conditions are specified in the operational-observability contract. Unratified thresholds remain explicit and no collector or production configuration is inferred from the document.

Next: active resource instrumentation and environment Logs/Tracing configuration, cost event-volume accounting, then exact-revision full validation and broader failure/tenant evidence. Canonical-write/D1-operation/R2/DO/Workflow/AI/pipeline measurements remain required. No acceptance closure or100percent claim.

## Historical checkpoints

Owning issue159 / draft PR170, branch codex/159-operational-observability; coordinator owns integration and acceptance. Initial worker Terra/high stopped at execution limit afterd023154; no active worker claim.

Coordinator corrected optional-diagnostic exception handling: disabled telemetry no longer returns from finally and suppresses application errors. Initialization and sink failures do not prevent or replace application processing/errors. Thrown failures emit a sanitized500/server_error envelope when logging works; exception messages are excluded. Nine focused tests pass, covering original-error identity, denied-response preservation, disabled mode, sink failure and initialization failure. No remote resources, external services, Copilot review or deployment used.

Still required: strict value allowlists/privacy tests; environment Logs/Tracing evidence/configuration; SLI numerator/denominator/window and alert definitions; machine-readable performance receipt and local load harness with tool/revision/config evidence; current D1/R2/DO/Workflow/AI/resource hooks and cost accounting; full integration/CI. Existing docs describe the intended receipt, not a completed executable harness. Do not close159 or publish completion/100percent.

Next: complete local performance evidence format/harness, then active-resource instrumentation and privacy/failure validation. Preserve separate audit63, analytics85 and diagnostic-context92 ownership. Production telemetry remains gated by42.

Envelope validation checkpoint: removed the unused recursive key-name redactor in favor of the actual serialization allowlist. Event construction now validates correlation UUID/status/latency, normalizes unknown route/method strings and derives outcome from status. Tests prove thirteen prohibited/arbitrarily named extra fields are excluded, unexpected route/method values are not echoed, and malformed numbers/IDs fail with a fixed non-sensitive error. Eighteen focused tests pass. This does not close the broader instrumentation, resource, harness or production configuration acceptance.

The actual HonoHTTP middleware test also verifies that request headers, cookies, incoming correlation IDs, sensitive URL/query segments and JSON body never enter the emitted envelope; denied403response is preserved. Nineteen focused tests, typecheck and scoped ESLint pass. This is syntheticHTTP middleware evidence, not a full authorization/tenant integration claim.

Performance harness foundation now executes three syntheticHTTP scenarios with real disposable Miniflare bindings and operatorMFA. First dirty-worktree run:60measured+3warmup+2auth requests, all expected responses, zero transport failures; disposed cleanup. Receipt includes revision/dirty flag, harness hashes, tool versions, fixed20samples/concurrency2, nearest-rank percentiles and explicit scope limits. Three sampler tests pass (fake-clock statistics, failure distinction, concurrency bounds). Exact committed-revision receipt and broader SLI/resource instrumentation remain next.

Integration checkpoint:79accepted viaPR169 at12f4a5bc96eac85043b756898681a74f9848f416, signature valid and reviewed tree matched. Exact-head CI passed; PR-only owner review bypass used, zero Copilot. Issue/Project79verifiedClosed/Done/100 with actual completion10September2026; historical baselines preserved. This branch rebased cleanly on that accepted main.

The performance harness produced a clean-revision passed receipt ata9b463dbbb7ba082edae82781b47ddf718c8dfad before rebase:60expected measured responses, zero unexpected/transport failures,65total fixture requests,7storedD1rows/0R2objects and disposed cleanup. ToolsNode22.19.0,Miniflare5.20260907.0-alpha,tsx4.23.13. Do not transfer those timings to the new rebased revision. Sampler tests/typecheck and real local harness are included in CI. Next: rerun the harness on accepted79base, retain receipt, complete SLI/resource hooks and synchronize forecast/Wiki in a coherent integration boundary.

Read-only worker preparation completed: see observability-159-entrypoints.md for eight source candidates and existing test paths, verified by coordinator. Current9aa90c9 CI now passes all required jobs. Neither green CI nor the inventory completes missing resource instrumentation; trace runtime reachability/tenant composition before adding hooks. No active worker remains for this completed inventory.

Resource-operation prerequisite10September18:32BST: reused native evidence_copyedit worker implemented only new resource-operation.ts and its tests; coordinator inspected and corrected arbitrary-field spread leakage, fabricated start-time fallback and awaiting an asynchronous sink. Final helper emits a finite explicit immutable envelope, never copies arguments/results/errors/tenant IDs, executes once, preserves result/error identity, omits diagnostics when disabled/clock invalid, and observes asynchronous sink rejection without delaying the operation. Transport lifecycle belongs to later caller integration. Ten focused regressions, server typecheck and targeted ESLint pass (existing module-type warning). Worker completed; no active resource worker remains. Resume exposed no model/effort controls/metadata, no switch/separate allowance claimed.

This is not live resource instrumentation: no active handler/service calls the helper yet. Verified TenantTicketService/repository/R2 paths remain the next integration boundary, with operation classification distinguished from actual D1/R2 request/row/byte counts. Keep159open; real resource/cost counters, full scenarios, configuration and pipeline coverage remain required. Existing HTTP evidence and isolated local-beta/production-off gates remain unchanged. No provider/resource activation or Copilot review.

R2 integration checkpoint10September18:37BST: trusted tenant factory now passes an isolated-evidence observer through guarded/ordinary attachment storage to TenantR2Adapter get/put/delete. Durable upload admission remains before storage; failure identity and uncertain-write behavior are preserved. Output capped at64percomposition, explicitly not complete operation/cost accounting; no keys/tenantIDs/body/options/results/errors are copied. LegacyR2, D1, DO, Workflow/AI and full SLI/cost counters remain pending.

Validation:20focused adapter/helper tests, server typecheck and targeted ESLint pass; existing module-type warning remains. Real disposable Miniflare storage/background suite5tests passes, including new actual R2 measurement/tenant-collision/own-byte/deletion/privacy scenario; its script typecheck passes. Native evidence_copyedit worker selected the existing meaningful runtime check read-only and completed; root implemented and integrated. Scoped docs updated. No provider/production/Copilot action and no159closure.


D1 increment: resumednative evidence_copyedit proposed and implemented observed-d1wrapper/tests in159worktree; model/effortcontrol unavailableonresume. Coordinator inspected native receiver access, expanded all/raw/run/error tests, wired only trustedtenant D1composition and addedactualMiniflarebatch rollback and production-gating evidence.18focusedhelper/wrappertests, fullserver447tests, TypeScript/focusedESLint and7realstorage/backgroundtests+scriptTypeScript pass. Existing64eventcap sharedwithR2; invoke/batchlabels do not inferSQLquerytype or billedcounts. pre-tenant/exec/dump/session/DO/Workflow/AI instrumentation and aggregatefullSLI/cost evidence remainopen. Coordinator fixed an overbroadlocal composition edit outsidethetargetfunction afterruntimecaughtundefineddb; final unrelatedauthresolverunchanged. No capability/tenant/admissionpolicy change.

172boundedknowledgecorrectionaccepted4fce7b6 (signedtree528d88f4matchesreviewed9c46); refreshthisbranchbeforepublishing. Workercomplete; rootintegrationowner. NoCopilotreview/provideractions or159completion/forecastchange.


Integration refresh701cb13 includes accepted172/main4fce7b6. Integrated server459tests/51files andTypeScriptpass onNode22. Local7storage/background+scriptTypeScript evidence covers unchangedD1/R2implementation; new172tests are included in459. ExactnewPRCIstillrequired. Currentcriticalpath unchanged; full159acceptanceopen.

## Durable Object request slice — 10 September 19:55 BST

Native evidence_copyedit implemented optional broadcast measurement and trusted dashboard/customer wiring; coordinator added production/disabled and sink-failure regressions. Fixed durable_object/invoke per fetch attempt shares existing64event cap; no payload/object/tenant/error content. Retry/swallow semantics retained. 464server tests/51files pass; worker TypeScript/lint passed before additional test-only cases. Full159 remains open: actual DO runtime proof, complete SLI counters, Workflow/AI/journal/Queue/outbox and collector/recovery/load acceptance. No forecast change, zeroCopilot. Existing170draft retained.

## Actual DO runtime proof — 10 September20:01BST

New durable-object-resource-runtime.test.ts bundles actual NotificationDO in memory, registers Miniflare namespace, invokes BroadcastService with actual local emitter and verifies fixed event/privacy. Production-mode real invocation suppresses output. Runtime disposed/log capture restored. Added to existing storage-background command and its TypeScript include;8tests and expanded typecheck pass. No sessions/recipient delivery/hibernation claim. Native evidence_copyedit authored; coordinator inspected/fixed harness coverage/cleanup requirements. Full159 remains incomplete; no forecast change.

## Workflow/AI increment —10September20:12BST

Explicit ENVIRONMENT=test + isolated-evidence opt-in permits synthetic diagnostics independently of LOCAL_BETA_ENABLED; production stilloff, original localbeta rule unchanged. Workflowlocalbeta rejection preserved. Full AIinstance optionalemitter records embedding operation/resultvalidation; workflowstep.do wrapper records invocation includingcachedsteps, notcallbackexecution. No prompts/results/identities/errors logged.

Initial nativeworker proposal discarded asunreachable (localbeta requiredemission butforbidsworkflow) and typeunsoundpartialAIcast. Escalated boundedvalidation to actual nativeworkflow_validation agent, Terra/high via exposedspawncontrols. Agentadded directmockedrun/AInegativecases; rootreviewed and full473tests/52files+focusedESLint pass; agentTypeScriptpass. Future work returns to lowestadequate configuration. No recursive/duplicateCopilotreviews.

Remaining: actual disposableWorkflowruntime proof, completeSLI/costcounts, AI fallback/suggestion, journal/Queue/outboxcontracts, configuration/retention/loadandalertacceptance. Full159open, mainunchanged, draft170retained. Account13%weeklyCodexremaining observed20:09BST; reset15September02:24BST. Task-specificusageunknown; no credit/reset/overage/APIspend. SharedWork/Codexallowance remainscountedonce. Forecast22January2027beta.2 unchanged.

## Actual Workflow runtime proof —10September2026

Nativeworkflow_validation completed realMiniflareWorkflowbinding test; sourcebundle usesactualVectorizeWorkflow/D1/R2. Draftjob emitsfixedD1/Workflowevents, staysdraft/R2empty; localbetainstanceerroredbeforeanyresourceevent. Rootreviewedsetupcleanup, boundedpolling andnegativeeventcheck.10combinedruntime tests pass; final2Workflowtests/lintpass, expandedscriptTypeScriptpass. Evidenceworkflow-runtime-cec34e1.json. AIbindingremote-onlyininstalledruntime, leftunbound; no runtimeAI/published-document/retrydurabilityclaim. Full159stillopen, noforecastchange. Workercompleted; rootintegrationowner. Next159: completeSLI/configuration/alerts andremainingactiveAI fallback; do not repeatunreachablelocalbetaworkflowhook.

## Configuration boundary —10September2026

Added explicit logs/traces/invocation/persistence/destination-off fields to production/local configs and isolated local evidence profile with guardedlocalentrypoint. InitialLuna/mediumoutput had ENVtest pairedwithlocal-index (would503) and falselysaidNode22missing; rootcaughtboth, scopedTerra/highfixverifiedactualhealth200+event. InstalledWranglerparser replacescopiedschemaassertions. Rootaddedexactevidenceprofilekeys/invocationlogguards andrequiredCIwiring.4configtests passNode22, workflowvalidatorpasses; drybuildpassedworker. No remoteactivation, no productionlogging, no#159completionclaim. Currentremaining: fullSLI/resourcecost/activefallback/load/retention acceptance. Nativeworkerscompleted, rootintegrationowner. Nextbatchshouldtargetend-to-endacceptance, notduplicateprimitive receipts. Forecastunchanged;13%weeklyusage lastobserved, nospend/reset/Copilot.

## Current acceptance queue — 10 September 2026

Root connected trusted knowledge/widget emitters to suggestion/chat calls and deterministic fallback selection. Existing responses and authorization preserved. Eight regressions added; 481 server tests/53 files, TypeScript and focused ESLint pass. No live AI provider enabled.

Read-only acceptance_159 worker (dedicated Codex, Terra/medium) mapped approved acceptance at edc1e9c; root reconciled this increment. Remaining: governed non-local retention/access/sampling under#42; aggregate auth/canonical-mutation SLIs and active resource hooks; event/retention accounting under#50/#64 without treating sampled events as billing; end-to-end observer-failure proof; exact-head CI/review. Future pipeline implementations stay under#51/#91/#87/#88; their extension contracts remain required here. Canonical audit stays separate and unsampled.

PR170 remains draft and #159 open. Forecast/baselines unchanged. Root sole integration owner; workers completed. No Copilot, bypass, paid capacity or remote resource action in this increment.

## Bounded local collection/export slice — 10 September 2026

Added a standalone caller-owned in-memory collector for current v1 reconstructed HTTP/resource envelopes. Unsupported/missing versions are invalid; it has no binding, persistence, network transport, global registry or automatic lifecycle. Defaults are64events/16KiB; explicit upper limits are256events/64KiB. The byte cap measures retained event JSON payload bytes, not wrapper size or process heap. Sampling is deterministic everyNth validated event, first-fit retention never evicts a prior record, and exports report attempted/retained/invalid/sampled-out/event-limit/byte-limit counts with `complete:false` whenever any input was omitted. This is sampled diagnostic evidence, never canonical audit, billing, complete SLI accounting, analytics or production telemetry.

An optional middleware sink supports synthetic collection without changing ordinary runtime logging. New Node22 harness sends three successful synthetic Hono health requests through the real middleware to a two-event collector: responses remain200, two allowlisted HTTP envelopes export, and the third is an explicit event-limit drop. Focused collector/middleware tests, the dedicated harness, its TypeScript check and server TypeScript pass. No remote resource, provider, deployment, GitHub mutation or Copilot use. Remaining159acceptance: aggregate auth/canonical-mutation SLI instrumentation; #50/#64 accounting; governed production retention/access/sampling under#42; observer-unavailability and exact-head validation. Root must integrate; no commit/push/PR mutation by this worker.

Coordinator integration: reviewed explicit version rejection, immutable snapshots and rejected-sink handling; wired collector harness/typecheck into existing required CI without altering other jobs. Full server suite initially failed because the local better-sqlite3 binding was absent; Node22 source rebuild repaired the environment without dependency changes. Final full suite489tests/54files and workflow validator pass. Worker reports16focused tests, harness, TypeScript and lint passing. No full159acceptance or exact-new-head-CI claim.
