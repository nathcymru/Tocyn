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

Main `4bf6dc5af44674a77002a0d2f0585d9b8df0d6c3` (PR #110), verified signed merge.
Main CI 34284398955 and CodeQL 34284398552 passed. Required dependency-only PR checks
matched github-actions app 15368. No manual repeat Copilot reviews requested.

| Issue / PR | Accepted state and evidence |
| --- | --- |
| #20 / #101 | Complete. Merge 3fae282; contributor setup, Node 22/npm 10, 23 local migrations and serving/checks. Project Done / 100%, actual 8 Sep, unchanged baseline 8–10 Sep, variance -2 Mon–Sat days. |
| #57 / #102–105 | Complete for current owner-local scope. #102 source deployment/artifact preparation; #103 semantic workflow repair; #104 local runtime/capture; #105 exact loopback CORS/test corrections. Project Done / 100%, actual 8 Sep, unchanged baseline 11–22 Sep, variance -12. No historical remote proof claimed. |
| #58 / #110 | Complete. Four reusable principals, actual password/MFA/portal authentication, scoped keys and recovery. Project Done/100%, actual 8 Sep, unchanged baseline 23–28 Sep, variance -17 Mon–Sat days. |
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

## Active allocation and integration

| Task | Agent/environment | Model/effort | State / ownership |
| --- | --- | --- | --- |
| Coordination/integration | Root/local | Inherited | CI, state, GitHub, final acceptance, real runtime proof |
| #19 core owner | beta_environment_impl/local | gpt-5.6-terra/high | Identity/API/portal matrix and minimal fixture extensions |
| #19 storage/background | release_packaging_escalation/local | gpt-6-astra/high | Disjoint R2/realtime/AI/job/deletion source acceptance |
| Internal review / next contract | dependency_audit/local | gpt-5.6-terra/medium | #19 core review passed; #59 field mapping preparation, #60 inventory complete |
| Work pool | Existing Work task | Existing settings | Unconfirmed timeout; no capacity claim |

Four concurrent Codex slots including root. Branch `codex/19-local-tenant-acceptance`
at `/tmp/tocyn-19-local-tenant-acceptance` is based on current main 4bf6dc5. Root owns
CI/state; core owner owns shared fixture extensions/core tests/public matrix; storage owner
owns disjoint storage/background tests. Agree the helper contract before shared edits.
No active listeners remain from acceptance tests. No PR yet for #19 at this snapshot.

#58 accepted evidence: four synthetic customer/operator principals, colliding tenant-local
IDs, distinct canonical emails and routing keys, real password/MFA/key operations,
same-ID scoped ticket positives, denied writes, role-change rejection, protected
credential storage, two portal magic-link/widget flows and recovery after callback
failure. Capture instances originate from the guarded local entrypoint factory.

Validation: server 340 tests; focused fixture 2; independent address/boundary 18 tests;
server and dedicated fixture-script typechecks, lint and workflow semantics pass.
Final verifier: 41 route requests, 8 selected D1 rows, 0 R2 objects, 0 FK violations.
Counts are not total D1 operations or production capacity. Root real Wrangler PTY
proof ran A and B portal authentication in separate fresh instances, keeping negative
attempts below the unchanged five/minute verification limit. Each run also completed
2 customer password and 2 operator MFA logins; SIGINT/SIGTERM exits 130/143 released
8787 and deleted owned state,5.36/5.50s. Credentials never appeared in reports.
Required CI ran script typecheck, verifier and repeated/failure-cleanup tests and passed.

## Critical path and ready queue

Not beta-ready. #20, owner-local #57 and #58 are complete. Nine roadmap beta gates remain,
Security alert disposition now confirms all three fixed. No arbitrary percentage.

| Issue | Dependencies / required outcome |
| --- | --- |
| #58 complete | #57 complete; accepted in #110 |
| #19 active | #58 complete; full identity/D1/R2/DO/cache/key/email/AI/job/deletion matrix |
| #59 | #19; canonical API/portal conversation contracts |
| #60 | #59; retry-safe mutations |
| #63 | #59; integrate after #60; attributable audit events |
| #93 | #57,#60; narrow resource/admission controls |
| #61 / #62 | #60,#63; portal workflow / human handling and retrieval |
| #21 | #61,#62; automated and manual accessibility acceptance |
| #65 | #57,#58,#19,#60,#61,#62,#63,#21,#93; final local two-tenant AI-unavailable rehearsal |

#58 fixture-only encrypted MFA bootstrap is not general self-enrollment. Password
app authentication and portal widget authentication remain separate actual flows.
#19 private matrix/checklist and #59 preparation exist outside public source; consume
fixtures rather than rebuilding. Disabled/future capabilities must be distinguished
without hiding required source correctness. Production/runtime rollout stays #42.

Non-beta roadmap: #50/#64/#90 full cost governance, #91 ingestion journal, #48/#66
redesign, #42 production, #18 native mail and future channels/autonomy/privacy metadata.
Security correctness is not excluded merely because a future feature is disabled.

## Project, schedule and exact next actions

#19 In progress; actual/forecast start 8 Sep. Its baseline 29 Sep–6 Oct stays unchanged.
Forecasts/receipts were synchronized from private-beta-reforecast-after58-2026-09-08.json:
#19 target 15 Sep; #65 target 24 Oct (-24 Mon–Sat days vs unchanged 21 Nov baseline).
Approved 3× effort and planned capacity remain unchanged. No per-issue owner acceptance
gate exists: the coordinator accepts against evidence under the owner's instruction.

1. Execute #19 core and disjoint storage/background evidence; reuse #58 fixtures.
2. Use actual issued A/B/app/widget/MFA tokens and unsigned client tampering. Do not
   invent a defect by expecting a valid server-signed B token with a real B subject
   to be denied. No generic signer or signing-secret exposure is needed.
3. Reconcile every approved surface, distinguishing active local paths, tested source
   contracts and unsupported/future capabilities. No remote capability activation.
4. Run complete required validation, internal review, coherent PR and signed integration;
   accept #19 only on actual evidence, then start #59 -> #60 and unlock parallel work.
5. Recheck GitHub alerts for #106/#108; local and published main lockfile hashes match
   the patched inventory. No dismissal or unsupported claim of service outage.
6. Persist receipts/Project/state/forecasts at meaningful integration boundaries.

Operational update delivered 22:24Z 8 Sep. Continue at least 30-minute operational
updates plus concise findings, without approval gates. No owner permission is pending.


PR #110 late automatic review: protect global Headers restoration if Miniflare
construction throws; require stdin as well as stdout/stderr TTY for synthetic reveal.
Core owner batches these into #19's fixture robustness work. No new metered review
requested. At subsequent PR boundaries, allow an already-running automatic review
to finish where practical so findings can be batched before integration.

Next dependency prep: /tmp/tocyn-60-mutation-inventory.md records existing API/portal
mutation routes and conditional-write precedents. No idempotency implementation is
claimed; #60 requires high-effort design after #59. Do not broaden to other surfaces.

#19 checkpoint: server 340, fixture 3, core 1 and storage/background 4 tests plus all
script types and clean full/production audit passed. Independent core review passed.
CI now requires both new acceptance suites. Remaining full build/lint/integration
checks are running. The local manifest has a real DO binding: core owner adds a
bounded actual socket/revocation proof alongside explicitly labelled source tests.
No new owner gate or remote runtime clearance is implied.

#19 remaining validation passed: three frontend builds, workflow/portal/server lint,
portal 13 / widget 3 / root 31 tests, D1 smoke plus all five integration batches, actual
local auth/reset/restart smoke. All test listeners released for the realtime proof.

#59 readonly contract proposal: /tmp/tocyn-59-contract-proposal.md. It preserves
legacy bodyless API behavior and maps truthful existing records without a parallel
store. This is a proposal: owner agent must verify every required metadata field,
truthful direction/internal-note semantics and shared contracts against #59/ADR.
Do not mechanically mark all newly obtainable API/portal lifecycle data unknown.

Realtime harness preparation: use configured 8787, not random port; local entrypoint
intentionally restricts origins to 8787. Root suggested free port before inspecting
that guard; corrected without broadening it. Check port free and own cleanup.
#59 /tmp/tocyn-59-contract-review.md adds critical corrections: internal direction,
author/requester provenance, truthful typed facts, and atomic ticket+first-message
failure behavior. #60 owns replay/conflict protocol, not this prerequisite.

#19 real Wrangler WebSocket proof passed 5713 ms: two actual MFA-issued tokens, A/B
isolated events, revoked A closes 1008, B continues. Owned state cleaned; no tokens
or socket URLs in output. CI requires this proof after other local runtime checks.
Nine beta gates still open until coordinator accepts integrated19; all security
maintenance 106/108 complete. Final narrow scriptreview and PR integration next.

PR #111 head 8f208f3 passed all required checks and internal reviews. Automatic
review completed with two findings: clarify state spacing and provide an explicit
fail-on-unexpected-use vector double in the storage tests. Corrections are batched;
no new metered review requested. Repeat affected checks and required PR checks before
integration. #19 remains In progress until final signed acceptance.
