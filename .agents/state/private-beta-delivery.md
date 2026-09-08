# Private-beta delivery coordination

Updated 8 September 2026. GitHub issues and Project 4 are acceptance/schedule records.

## Owner authority and boundaries

Execute the approved issue-driven beta path with useful independent agents, real
validation and healthy main. No acceptance weakening or artificial readiness.

Use local Wrangler at `http://localhost:8787`, local D1/R2/DO simulations and captured
mail only. No Cloudflare account, zone, DNS, Worker, database, bucket, queue, provider
or other remote-resource operation. No external email, production migration, public
release, onboarding or cutover. GitHub source governance is authorised.

Exact approved local-capture recipients: `tocyn-auth-test@example.invalid`, plus
`tocyn-auth-test-a@example.invalid` and `tocyn-auth-test-b@example.invalid` explicitly
authorised for two-tenant portal testing. Preserve distinct canonical identities and
normal token audiences. Never reuse one login email across both tenants or forge
portal tokens from password app tokens.

Standing approval: PR-only approving-review exception for #102 and subsequent Tocyn
PRs after internal review and all required CI/security checks pass. #101 had explicit
separate approval. No machine-check or signature bypass; do not ask again.

Work connector attempts timed out; execution unconfirmed. Native Codex app Computer
Use was denied by tool restriction, with no Mac prompt or pending Mac permission.
Browser Computer Use works. Do not circumvent the denied native route.

## Main and integrated evidence

Main `987218b4aaa280d636101d9cf46d79b755fe9e8a` (PR #111), verified signed merge.
Main CI 34287873983 and security analysis 34287873501 passed. Required dependency-only PR checks
matched github-actions app 15368. No manual repeat Copilot reviews requested.

| Issue / PR | Accepted state and evidence |
| --- | --- |
| #20 / #101 | Complete. Merge 3fae282; contributor setup, Node 22/npm 10, 23 local migrations and serving/checks. Project Done / 100%, actual 8 Sep, unchanged baseline 8–10 Sep, variance -2 Mon–Sat days. |
| #57 / #102–105 | Complete for current owner-local scope. #102 source deployment/artifact preparation; #103 semantic workflow repair; #104 local runtime/capture; #105 exact loopback CORS/test corrections. Project Done / 100%, actual 8 Sep, unchanged baseline 11–22 Sep, variance -12. No historical remote proof claimed. |
| #58 / #110 | Complete. Four reusable principals, actual password/MFA/portal authentication, scoped keys and recovery. Project Done/100%, actual 8 Sep, unchanged baseline 23–28 Sep, variance -17 Mon–Sat days. |
| #19 / #111 | Complete. Real A/B auth/D1/R2/DO acceptance, scoped failure/retry and full matrix. Signed merge 987218b; final PR head a7eca61; all required checks and main checks pass. Project Done / 100%, actual 8 Sep, unchanged baseline target 6 Oct, variance -24 Mon–Sat days. |
| #106 / #107 | Source patch integrated 18a5ea7, signed; Vitest/mocker 4.1.11. All checks/main CI 34282806598 / CodeQL 34282806746 passed. Alerts 99/100 fixed at 22:14:52Z; issue closed; Project Done / 100% actual 8 Sep. |
| #108 / #109 | Source patch integrated 80e23ba, signed; exact Sharp 0.35.4 override and platform companions. Upstream Miniflare still pinned 0.35.2; no unrelated upgrade. Alert 101 fixed at 22:14:52Z; issue closed; Project Done / 100% actual 8 Sep. |

#57 evidence: actual request/capture/verify, wrong-tenant/replay rejection, local
restart/session durability, ephemeral capture clearing, interruption cleanup. Source
artifact reproducibility proof remains in docs/isolated-environments.md. Portal-only
capture page passes direct/reload, keyboard/focus, accessibility-tree status and
5.65:1 primary contrast; absent from API and production portal bundles. No human
screen-reader session or broader #21 acceptance is claimed.

#104 automatic comments arrived after merge; #105 batched all three corrections,
passed checks and later received approval. One nonblocking fixed-input test-style
suggestion was assessed and resolved without a redundant patch/review cycle.

GitHub now reports alerts 99/100/101 fixed at 22:14:52Z on 8 Sep, matching patched
local/published inventories. No alert dismissal occurred. Completion receipts and
Project fields for #106/#108 are synchronized; both issues are closed Done / 100% actual 8 Sep. #12 retains broader required
context enforcement scope; its positive evidence from #107 does not close it.

## Active allocation and ownership

| Work | Agent / model / effort | Owned files and state |
| --- | --- | --- |
| Coordinator | Root / inherited | CI, state, GitHub, integration, final acceptance |
| #59 issue owner | beta_environment_impl / gpt-5.6-terra / high | Four timestamps plus message intake source, canonical types/mapper, service, handlers, package commands, docs; architecture and tenant-sensitive shared contract |
| #59 atomic persistence | release_packaging_escalation / gpt-6-astra / high | Repository interface/implementation and real D1 second-write rollback/retry test; atomicity and isolation |
| #59 route acceptance | dependency_audit / gpt-5.6-terra / medium | Canonical route script and dedicated typecheck config; tests agreed response contract with actual issued credentials |
| Work pool | Existing task / existing settings | Connector timed out; execution unconfirmed. No extra capacity claimed. |

Branch `codex/59-canonical-conversations` at `/tmp/tocyn-59-canonical-conversations`
starts from accepted main 987218b. Four Codex slots including root. Explicit ownership
prevents overlapping edits; issue owner assembles acceptance, root decides completion.
Node 22 script-free locked install passed with zero advisories; native test dependency
setup completed with a Node 22 better-sqlite3 rebuild. No PR yet for #59.

## Accepted #19 evidence and review disposition

Server 340 tests; fixture 3; core 1; storage/background 4; portal 13; widget 3; root 31.
All relevant typechecks/lint, workflow semantics, three builds, D1 smoke and five
integration batches passed. Actual local auth/reset/restart and real WebSocket smoke
passed. Socket proof: two route-issued MFA tokens, isolated events, revoked A closes
1008, B continues; owned temporary state and listeners cleaned. Measurements are
local counters and durations, not production cost/capacity or remote runtime proof.

Source-contract AI/vector/workflow cases use explicit doubles; unsupported local
inbound mail/cache/export and #42 production/runtime gates remain clearly recorded.
Public matrix: `docs/security/tenant-isolation-acceptance.md`.

Internal reviews passed. Automatic #111 findings were corrected: counted rejecting
unused-vector boundary (retention asserts zero calls), readable state, and system
scope for fixture key bootstrap. #110 cleanup/stdin findings were integrated and its
threads resolved. No manual repeat Copilot review requested. Final #111 automatic
review on a7eca61 subsequently approved with no new findings. All machine checks
passed before the authorised PR-only admin merge.

## #59 implementation decisions

Reuse tickets/articles/attachments; no parallel model, provider adapter, journal or
historical rewrite. Preserve existing response fields and body-less API creation.
Add a common canonical projection to API/portal creation and detail after visibility
and ownership checks. Persist four server-observed received/processed columns plus article intake_source.
A parent ticket source cannot identify a later message channel; missing historical
message source stays not-recorded. Derive only truthful remaining facts from stored
sender, visibility and IDs.
Portal now must persist verified customer_id; API declared email is not verified
identity. Typed external/legacy unavailable facts are not fabricated or null-column
sprawl. Internal notes are not outbound delivery; system author proves no direction.

Atomic ticket plus first-article persistence is a #59 correctness prerequisite.
Real D1 failure of the second write must leave no orphan and preserve B, followed by
a successful retry. #60 owns idempotency/replay/conflict protocol, not this atomicity.
No raw R2 paths, credential data or internal messages may leak through canonical views.

## Critical path and ready queue

Not beta-ready. #20, owner-local #57, #58 and #19 are complete. Security maintenance
#106/#108 is complete with GitHub alerts 99/100/101 fixed. Eight beta gates remain.

| Issue | Dependencies and outcome |
| --- | --- |
| #59 active | #19 complete; canonical API/portal conversation records |
| #60 | #59; validated retry-safe mutations |
| #63 | #59; integrate after #60; attributable audit events |
| #93 | #57 and #60; narrow authoritative resource/admission guardrails |
| #61 / #62 | #60 and #63; portal workflow / human handling and retrieval |
| #21 | #61 and #62; automated and manual accessibility acceptance |
| #65 | All beta prerequisites; final local two-tenant AI-unavailable rehearsal |

Prepared handoffs: `/tmp/tocyn-59-fileplan.md`, `/tmp/tocyn-59-contract-review.md`,
`/tmp/tocyn-60-mutation-inventory.md`, `/tmp/tocyn-93-preparation.md`. Proposals are
not authority: current issue scope and accepted ADRs govern implementation.

Non-beta roadmap includes #50/#64/#90 full cost governance, #91 journals, #48/#66
redesign, #42 production, #18 native mail and later channels/autonomy/privacy metadata.
Required correctness is not excluded merely because a capability is currently disabled.

## Project, forecast and next actions

#19 completion receipt: https://github.com/nathcymru/Tocyn/issues/19#issuecomment-5592992766
#59 start receipt: https://github.com/nathcymru/Tocyn/issues/59#issuecomment-5592993738
#59 In progress, actual start 8 September. Baselines never changed. The after19 JSON
preserves 3× effort, Monday–Saturday calendar, two workstreams and shared review
capacity. Forecast #59 target 15 September, #65 target 17 October (-30 working days
against unchanged 21 November baseline). All eight successor forecasts and issue receipts are synchronized.

1. Implement agreed #59 contracts in three owned workstreams; resolve interface changes
   together before editing shared boundaries.
2. Validate targeted new behavior, then subsystem/full required checks and review.
3. Publish one coherent PR, integrate only after required checks and internal review;
   update acceptance, Project and forecasts from merged evidence.
4. Start #60 after #59 acceptance; unlock #63/#93 concurrency after #60.
5. Keep review corrections batched and reserve external review for meaningful PR boundaries.

Operational update delivered 22:54Z 8 September. Continue concise findings and at least
30-minute operational updates. No owner permission is pending. Do not end at a single
issue or green CI; continue through the approved local beta readiness boundary.

#59 checkpoint: atomic real D1 tests 2/2, route/projector tests 2/2 and dedicated
types pass. Existing server suite exposed seven stale test doubles in three files;
updated assertions retain prior behavior and their 36 tests pass. Repository 24 and
other server tests passed. Frontend tests/builds/lint and all 31 root tests pass.
Local D1/auth/realtime chain is running. Final review fixes preserve sender facts
without implying verified identity/direction, unknown unsupported sender types,
nullable ticket numbers, safe content references, subject/update lifecycle, and
no duplicate attachment query. Add full canonical readback/timestamp assertions.

#59 final local checkpoint: canonical route/projector 2/2 with full create/readback
and storedtimestamp comparisons; atomic D1 2/2; server regression corrections
36/36; all remaining server tests passed. All dedicated/server types, lint, three
builds, portal 13, widget 3 and root 31 pass. Complete local D1/auth/fixture/core/
storage/realtime chain passed. Independent review findings resolved, including
unsupported sender types staying unknown. Root reviewed final docs and changes.
Ready for one coherent PR and mandatory remote CI; no issue completion claimed yet.

PR #112 opened at f789cb8. CI found an exact portal mock expectation missed after
a late typed-input cleanup removed an unused is_internal:false argument but left
the old exact mock expectation. The initial flag restoration passes runtime tests
but conflicts with the narrower typed input, so correct the mock to the new input
and retain real atomic is_internal:false evidence. Freeze source
before final validation: earlier partial-suite receipts cannot cover later edits.
Batch this correction with any already-running automatic review findings before
push; no manual repeat review requested. #59 remains In progress.

PR #112 automatic review found incomplete required fields in a regression fixture
and message-only properties passed into ticket-only creation. Owner batches typed
input corrections with the exact mock fix; require full server tests and types on
the final frozen source. No additional metered review requested.

#112 corrective batch frozen: ticket-only inputs omit message fields; regression
input supplies all required typed facts; portal exact mock follows the narrower
service input while real persistence remains explicitly public. Final source
server 340, canonical route 2, atomic 2 and all server/script types pass. Root
reviewed the complete corrective diff before combined push.
