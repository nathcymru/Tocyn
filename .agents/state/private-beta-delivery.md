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

Main `80e23ba0130d4bfeff5ec7162addd47d316639d5` (PR #109), verified signed merge.
Main CI34283283058 and CodeQL34283282206 passed. Required dependency-only PR checks
matched github-actions app15368. No manual repeat Copilot reviews requested.

| Issue / PR | Accepted state and evidence |
| --- | --- |
| #20 / #101 | Complete. Merge3fae282; contributor setup, Node22/npm10, 23 local migrations and serving/checks. Project Done100, actual8Sep, unchanged baseline8–10Sep, variance-2 Mon–Sat days. |
| #57 / #102–105 | Complete for current owner-local scope. #102 source deployment/artifact preparation; #103 semantic workflow repair; #104 local runtime/capture; #105 exact loopback CORS/test corrections. Project Done100, actual8Sep, unchanged baseline11–22Sep, variance-12. No historical remote proof claimed. |
| #106 / #107 | Source patch integrated18a5ea7, signed; Vitest/mocker4.1.11. All checks/main CI34282806598/CodeQL34282806746 passed. Issue open pending alert99/100 disposition. |
| #108 / #109 | Source patch integrated80e23ba, signed; exact Sharp0.35.4 override and platform companions. Upstream Miniflare still pinned0.35.2; no unrelated upgrade. Issue open pending alert101 disposition. |

#57 evidence: actual request/capture/verify, wrong-tenant/replay rejection, local
restart/session durability, ephemeral capture clearing, interruption cleanup. Source
artifact reproducibility proof remains in docs/isolated-environments.md. Portal-only
capture page passes direct/reload, keyboard/focus, accessibility-tree status and
5.65:1 primary contrast; absent from API and production portal bundles. No human
screen-reader session or broader #21 acceptance is claimed.

#104 automatic comments arrived after merge; #105 batched all three corrections,
passed checks and later received approval. One nonblocking fixed-input test-style
suggestion was assessed and resolved without a redundant patch/review cycle.

Local security inventories/audits show patched versions; GitHub alerts still report
open. GitHub SBOM export returned HTTP500 timeout. Service lag is an inference, not
confirmed outage. Never dismiss unresolved alerts to create readiness. Recheck while
continuing substantive work. #12 has positive dependency-only context evidence from
#107 but remains open for its broader pass/fail enforcement demonstration.

## Active allocation and integration

| Task | Agent/environment | Model/effort | State / ownership |
| --- | --- | --- | --- |
| Coordination/integration | Root/local | Inherited | CI, state, GitHub, final acceptance, real runtime proof |
| #58 implementation | beta_environment_impl/local | gpt-5.6-terra/high | Complete pending integration; auth/MFA fixture security |
| #58 independent review | release_packaging_escalation/local | gpt-6-astra/high | Consolidated source/address review passed |
| #106/#108 patch and forecast | dependency_audit/local | gpt-5.6-terra/medium | Complete; no unrelated majors; private #19 prep ready |
| Work pool | Existing Work task | Existing settings | Unconfirmed timeout; no capacity claim |

Four concurrent Codex slots including root. Branch `codex/58-local-tenant-fixtures`
at `/tmp/tocyn-58-local-tenant-fixtures` is based on current main80e23ba. Root owns
CI/state; implementation owner owns fixture scripts/config/tests/operator docs.
No active listeners remain from acceptance tests. No PR yet for #58 at this snapshot.

#58 checkpoint: four synthetic customer/operator principals, colliding tenant-local
IDs, distinct canonical emails and routing keys, real password/MFA/key operations,
same-ID scoped ticket positives, denied writes, role-change rejection, protected
credential storage, two portal magic-link/widget flows and recovery after callback
failure. Capture instances originate from the guarded local entrypoint factory.

Validation: server340 tests; focused fixture2; independent address/boundary18 tests;
server and dedicated fixture-script typechecks, lint and workflow semantics pass.
Final verifier:41 route requests,8 selected D1 rows,0 R2 objects,0 FK violations.
Counts are not total D1 operations or production capacity. Root real Wrangler PTY
proof ran A and B portal authentication in separate fresh instances, keeping negative
attempts below the unchanged five/minute verification limit. Each run also completed
2 customer password and2 operator MFA logins; SIGINT/SIGTERM exits130/143 released
8787 and deletedownedstate,5.36/5.50s. Credentials never appeared in reports.
Required CI will run script typecheck, verifier and repeated/failure-cleanup tests.

## Critical path and ready queue

Not beta-ready. #20 and owner-local #57 are complete. Ten roadmap beta gates remain,
plus the two security issues' final alert disposition. No arbitrary percentage.

| Issue | Dependencies / required outcome |
| --- | --- |
| #58 active | #57 complete; reusable authenticated A/B fixtures |
| #19 ready next | #58; full identity/D1/R2/DO/cache/key/email/AI/job/deletion matrix |
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

#58 In progress; actual/forecast start8Sep, baseline23–28Sep unchanged. Dependency
forecasts and issue receipts synchronized from private-beta-reforecast-2026-09-08.json:
#58 target14Sep; #65 target30Oct (-19 Mon–Sat days vs unchanged21Nov baseline).
Approved3× effort and planned two-workstream/shared-review capacity preserved. These
are forecasts, not release commitments or limits on accelerated execution.

1. Publish coherent #58 PR with final evidence; require all checks/internal review.
2. Accept #58 only after signed integration/main validation, then start #19.
3. Recheck GitHub alert disposition for #106/#108; record completion only accurately.
4. Continue dependency-cleared parallel work; keep next #59/#60 ready without overlap.
5. Persist merge/issue/Project receipts and significant decisions in each issue branch.

Operational update delivered21:51Z8Sep. Continue at least30-minute operational updates
and concise ongoing findings, without turning them into approval gates. No owner
permission remains pending; the A/B local-mail clarification was granted.
