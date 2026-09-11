# #159 implementation checkpoint

## Integration checkpoint — 11 September 2026, 03:36 BST

Coordinator integrated the continuation onto accepted main `8ef397c716802a50d7ba1be835f438148eb2e4c0`. Application revision `da9e3fd` preserves #162's live session version and the shared request observer; the one textual merge conflict was resolved to retain both. Integrated Node 22.19.0 server typecheck and 525 tests / 58 files pass. Required exact-head CI/security and final acceptance remain pending. #159 is open; no production telemetry activation or Copilot review requested.

## Prior checkpoint (historical; latest integration above takes precedence)

Owning issue #159; foundation PR #170 merged at `9cee350c36f49b9459fad3db42aadc8d25de848b`, with valid GitHub signature and exact reviewed tree. Coordinator owns integration and acceptance; continue remaining work from current main in a new bounded issue branch. Latest implementation `277cb3a` includes fixed HTTP/resource envelopes, local collector/configuration, cost bounds, credential decisions and canonical mutation summaries. All later sections are chronological evidence, not competing ready queues. No worker remains active on #159 at this checkpoint.

Current verified evidence: root512server tests/58files; real two-tenant credential3tests; prior local D1/R2/DO/Workflow demonstrations with their stated limits; local load receipt65requests/60measured outcomes and source/tool/config metadata. All final6d3ce48 required CI/security checks passed before the review-only owner bypass. No unresolved review threads or Copilot requests. #159 remains open / Project In progress. Production telemetry stays disabled under #42.

## Active-path completion slice — 11 September 2026

Uncommitted bounded continuation in `/private/tmp/tocyn-beta2-159-continuation` on `codex/159-active-path-completion`, based on accepted main `0206645`. The request boundary now owns one optional 64-event emitter and passes it through pre-scope staff/widget/API-key/customer D1 resolution, local-beta policy/admission reads, subsequent tenant composition, legacy default-tenant R2 hydration, and realtime ingress. Each `NotificationDO` live-session D1 revalidation independently creates its bounded emitter because it is a separate Durable Object composition. No scope, credential, authorization, retry, response, or data-delivery behavior changes.

`ObservedD1` now treats D1 `all`/`run` result envelopes and batches with explicit `success:false` as fixed `failure` outcomes while returning the original result unchanged. DO fetches that resolve with 5xx similarly record `failure` without introducing retries; rejected fetches retain their existing retry/swallow behavior. Legacy R2 reads/deletes retain key validation and original error identity. Events still include no arguments, SQL, keys, tenant IDs, result/error fields, bodies, tokens, or session data.

The active-root audit found the legacy `TicketService`, `StorageService`, `KnowledgeService`, and `AutomationService` have no constructors in the current application route tree. They remain dormant legacy paths and are not newly instrumented here. Inbound email remains deployment-disabled under its existing gate. Current active pipeline extension work remains #51/#91/#87/#88 scope.

The diagnostic workload bridge now implements #159’s current active aggregate denominator rather than deferring accounting wholesale. For H HTTP requests, C request-owned resource compositions (`C <= H`, defaults to H), D independent `NotificationDO` revalidations, B proven detached current background compositions, A credential summaries and M canonical summaries, its conservative reservation is `H + A + M + 64 × (C + D + B)` log events and zero trace events. A/M each default to H and never exceed it; D/B must be supplied from the observed workload. A first live WebSocket session in an empty NotificationDO has H=1, C=1 and D=3 (ingress revalidation, session enumeration, initial send), therefore 259 default potential log events. This is a planning upper bound only: it is neither provider billing usage, a durable grant, a transaction-completion counter nor a WebSocket-delivery count. #64 owns future budget admission/reconciliation and keeps `NotificationDO` realtime-only.

The #159 local collector is its own bounded behavior evidence: caller-owned memory only, deterministic every-Nth validated-event sampling, first-fit 64 events/16 KiB defaults and 256 events/64 KiB hard maxima, explicit omission counts and immutable exported snapshots. It has no file, binding, network, timer, global registry or automatic lifecycle. This supports local retention/sampling/collector-failure reasoning but does not configure persisted collection or authorized access. #42 still owns production access, retention, sampling, provider-boundary and rollback verification; it is not a blanket deferral of the local contract above.

Local validation on Node 22.19.0: full server suite 525 tests/58 files, server TypeScript, focused ESLint, disposable Miniflare storage/background/DO/Workflow suite 10 tests plus its TypeScript, and local collector harness all pass. `npm run test:local-tenant-realtime --workspace=apps/server` passed with a new temporary loopback port selected by the smoke itself; the test-only `LOCAL_RUNTIME_ORIGIN` accepts one validated HTTP loopback origin so the owner fixture on 8787 stays untouched. The smoke proves actual synthetic MFA WebSocket rejection, two-tenant delivery isolation, post-revocation close (1008), continued tenant-B delivery, and close after the run-owned Worker stops. Its test-reported port, tokens, credentials and socket URLs are never emitted. This does not claim staging, production, hibernation persistence, retained telemetry, or provider evidence. No remote resource, provider, deployment, GitHub write, Copilot request, paid call, forecast change, or #159 acceptance closure occurred.

## Approved acceptance map — 11 September 2026

This maps the current ten #159 criteria to local evidence. “Evidence” is not an issue-completion decision; root owns exact-head integration and acceptance.

| #159 criterion | Current local evidence / precise status |
| --- | --- |
| 1. Versioned safe event/context types | **Evidence:** v1 HTTP/resource/auth/canonical envelopes constrain correlation, normalized route/operation/outcome, latency and fixed fields. No tenant reference is emitted where no governed pseudonymous correlation is required. |
| 2. Allowlist/redaction absence tests | **Evidence:** reconstruction/serialization and request/resource tests exclude headers, cookies, OTP/magic links, keys, channel/provider data, bodies, attachments and AI inputs/outputs. The active-path addition also excludes D1/R2/DO arguments, results, identifiers and errors. |
| 3. Separate non-sampled canonical audit | **Evidence:** canonical D1 audit remains #63-owned and outside the sampled local collector; canonical mutation SLI is a separate bounded observer. |
| 4. Local/isolated/production configuration | **Evidence:** standard local and production profiles disable persistence/logs/traces; the guarded isolated synthetic profile permits local evidence only. **#42 gate:** production access, retention, sampling and redaction verification/activation. |
| 5. Initial SLI/SLO definitions | **Evidence:** API, auth, canonical, D1/R2/DO, Workflow/AI fallback and future journal/Queue/outbox/dispatch contracts and collection limits are recorded; #51’s 50 ms warm-ingress target is preserved. Fleet aggregation is not an additional #159 criterion. |
| 6. Machine-readable performance receipt/load harness | **Evidence:** disposable local two-tenant harness/receipt records revision state, configuration, tools, bounded samples, latency and failures without credentials or bodies; no global numeric threshold is ratified. |
| 7. Alert/runbook conditions | **Evidence:** runbook conditions are defined for DLQ/quarantine, oldest pending age, dispatch uncertainty, sustained active-path errors and budget-admission failures. External alert-channel activation is neither required nor authorised here. |
| 8. #50/#64 event-volume and retention/sampling accounting | **Evidence:** #50 dimensions are used by the explicit `H + A + M + 64 × (C + D + B)` active-path envelope; local collector sampling/retention is bounded and cannot refund it. **#64 scope:** later durable admission/reconciliation, not missing #159 accounting. |
| 9. Observability unavailability preserves controls | **Evidence:** disabled/throwing/rejected observer, D1/R2/DO result-failure, revocation and recovery tests preserve authentication, tenant isolation, durability, approval and response/retry behavior for implemented active paths. Future pipeline implementations are not claimed. |
| 10. Exact revision/config/tool/limitations record | **Partial:** receipts and state record base revision, configuration, Node/tool versions, local-only constraints and test evidence. The uncommitted continuation still needs root’s exact-head integration record and required CI/security evidence before any acceptance decision. |

The only currently identified #159 acceptance follow-up is criterion 10’s exact integrated revision/CI record and root review. Production telemetry activation/retained access policy is explicitly gated by #42. Queue, journal, outbox and dispatch implementations are future owner scope; #159’s required extension contracts/runbooks are already recorded and do not require those channels to be built here.

No acceptance closure,100percent, production enablement or forecast change. Shared Codex capacity most recently5%remaining, reset15September02:24BST; preserve capacity for integration. No Copilot requests or purchases.

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

## Diagnostic cost-envelope bridge — 10 September 2026

Root verified #50 already includes logEvents/traceEvents and their catalogue entries; do not recreate dimensions or claim they were absent. Added integer-safe estimateDiagnosticEnvelope for H HTTP requests +64 per trusted independent resource composition, composing through existing sumResourceEnvelopes. Tests reject malformed/overflow inputs and preserve estimates despite sampled observations. Catalogue now maps exact local sampling/payload-memory/lifetime limits and #64 admission/reconciliation requirements; no remote storage/trace transport or actual grant is claimed.39focused tests/server TypeScript pass. Remaining159: aggregate active-path SLIs, remaining instrumentation and end-to-end observer-unavailability/final acceptance. Durable budget implementation remains64; production retention/export gate42. No forecast change or Copilot/provider actions.

Final cost-bridge validation:492server tests/55files, server TypeScript and focused ESLint pass; existing module-type warning only. Exact pushed revision CI remains required.

## Staff auth decision SLI — 10 September 2026

Native auth_sli_159 (Terra/high, security boundary) implemented bounded per-request staff credential counters behind isolated-evidence gate, with real two-tenant revocation evidence. Root reviewed classifications, restored original jwtPayload assignment order, added disallowed-algorithm/runtime-input cases and corrected the collector harness Context type. Accepted credentials remain distinct from beta admission/route permission; no status-derived success or fleet denominator. Async sink failure cannot rewrite prior exported snapshots; missing output is not success.

Cost contract now adds one possible SLI output per auth-gate request: H+A+64C, A defaults to H. Prior H+64C checkpoint is historical and superseded for current planning. Full499tests/56files, server and collector/performance script TypeScript, collector harness pass. Worker initially incorrectly reported Node22missing; explicit supplied executable v22.19.0 worked and real28tenant tests passed without installs/rebuild. Do not repeat that environment assumption.

Remaining159: canonical durable completion/replay/uncertainty, widget/API-key/MFA issuance SLIs, active-path gaps, complete collection/aggregate coverage and full observer-failure acceptance. Use existing actual Miniflare ticket-mutation/canonical scripts when planning, not only mocked handlers. #64 durable budgeting and #42 production export remain their owners. Worker complete; root owns integration; no Copilot/provider/paid action or forecast change.


## Canonical durability diagnostics — 10 September 21:50 BST

Native auth_sli_159 Terra/high implemented request-owned unsampled canonical counters through trusted API/portal/staff composition. Durable completion is recorded only after the real tenant-scoped D1 batch returns its nonempty response snapshot; replays observe existing receipts; denials before an attempt remain distinct from conservative uncertainty. A replay observation is not proof a later caller remained authorized: real revocation-between-prepare/commit test rejects the later commit. Legacy dashboard creation/PATCH/system paths remain outside this bounded increment. No canonical audit or behavior replaced.

Worker reports12real Miniflare replay tests,2canonical atomic tests,28focusedtests and corresponding scriptTypeScript checks passing. Root inspected service/repository boundaries and corrected a material accounting error in the handoff: H+A+M+64C is bounded by3H+64C, not2H. Costhelper/catalogue now independently reserve auth and canonical summaries, both defaultH, with invalid/overflow regressions. Full505server tests/57files, serverTypeScript and focusedESLint pass (existingmodulewarning only). No provider/resources/Copilot used.

Current worker complete; root ownsintegration/exactheadCI. Remaining159includes current legacycreate/PATCH and otherauthpaths, completeactivepath/observerfailureacceptance and finalintegration. #64durablebudgeting/#42productiontelemetry retainownership. No issueclosure, forecastchange or productionclaim.


## Staff create/PATCH and no-op accounting — 10 September 21:59 BST

NativeTerra/high worker extended request canonical summaries to dashboard atomic ticket creation and audited dashboard/API PATCH. An explicit internal {ticket,changed} outcome uses the committed UPDATE RETURNING row; unchanged updates record fixednoOp, not durablechange. Existing publicresponses and broadcastbehavior remainunchanged. Sameone-summary/request cap, M≤H; costboundstillH+A+M+64C≤3H+64C.

Root found missing/malformed batch results could be mislabelednoOp. Added result-shape failure→uncertainty regression and preservedfailure behavior, correctedthreeoldhandler mocks to return oneD1result perstatement. Full506tests/58files, serverTypeScript, focusedlint and rootrealMiniflareconversation-audit9tests pass. Worker also passedatomic2/replayruntime/focused46/scriptTypes. The sourceSLIschema remainsdraftv1 with newnoOpfield; no deployedconsumercompatibilityclaim. Remaining159authissuance/widget/APIkeySLIs, activeoperationcoverage and completefailure/collectionacceptance stayopen. No production/Copilot/forecastchange.


## API-key and customer credential coverage — 10 September 2026

NativeTerra/high extended the same requestauthSLI to APIkey and widget/customer middleware after trusted currentcredentialvalidation. Scope is nowcredential, includingstaff; permission/admission/foreignresourcedecisions remainseparate. Duplicatecredentialgates markevidenceincomplete, neverdoublecount. Resolver/runtimefaults distinguishunavailable fromexplicitinvalid/revokeddenial. Rootreviewed splitresolution/composition andrenamed costboundcredentialAuthRequests toreflectallcurrentgates; maximumemissionsunchanged.

WorkerrealMiniflaretenant-core2tests provevalid API/widgetcredentials, foreignresource404withacceptedauthentication, revocations andthrowingobserver leavingvalidAPI200. Workerfocused28+57tests/type/lintpassed; rootfull506tests/58files andserverTypeScriptpassed. Password/MFAissuance and realtimecredentials remainexplicitnextscope; no productiontelemetry orcomplete159claim. ExactnewheadCI pending; noCopilot/paid/remoteactions orforecastchange.


## Remaining credential decisions — 10 September 2026

Terra/high auth_sli_159 implemented password, MFA verification, customer opaque-token verification and realtime credential classification in the existing fixed auth.sli.request summary. At most one summary/request; A<=H and cost envelope unchanged. Enumeration-safe customer request acknowledgements, local-beta admission-suppressed results and MFA enrollment issuance remain excluded. Private structured service results distinguish credential denial from admission/runtime faults without changing public responses.

Root review found a post-challenge user read without fault classification and duplicate unavailable recording across handler/middleware catches. Both are corrected with a focused exact one-complete-summary regression. Challenge verification and handler decisions have separate ownership; handler failures are not reclassified as JWT failures. Optional observer errors cannot replace authentication behavior.

Passed: agent66focused tests, server and tenant-core TypeScript, real two-tenant Miniflare3tests, focused ESLint; root full512server tests/58files and diff check. Realtime verifier tests cover valid/denied/unavailable/throwing-observer decisions. The real fixed-port realtime rehearsal stopped before Worker startup because owner fixture occupies8787; no runtime realtime pass claimed. Existing tenant-core fixture has only a placeholder DO, so it cannot substitute for a real WebSocket runtime. No local origin policy changed and owner fixture remains untouched.

209e834 previous CI/security checks all pass. Next pushed revision still requires exact-revision CI before any integration. Issue159 remains open: complete active-path resource/SLI coverage review and production-independent acceptance mapping, true realtime runtime evidence when available, final integration; production telemetry remains42. Root sole integration owner; worker complete. No Copilot, API billing, paid capacity, remote resources or forecast changes.
