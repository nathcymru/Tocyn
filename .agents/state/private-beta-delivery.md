# Private-beta delivery coordination

Updated 9 September 2026. GitHub issues and Project 4 are acceptance/schedule records.

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

Main `e0ce28bc3e9dc7bd520f129274a802e7bec67832` (PR #112), verified signed merge.
Main CI 34290185403 and security analysis 34290185066 passed. Required dependency-only PR checks
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

## Current integration and allocation

#59 accepted via #112, signed e0ce28b. Final head e3bb873 passed required checks;
main CI/security passed. Canonical route/projector 2, atomic D1 2, server 340,
portal 13, widget 3, root 31, all required types/lint/build/local integration passed.
Project Done / 100%; start 8 September, completion 9 September Europe/London;
baseline 14 October unchanged, variance -30 Monday–Saturday days.
Receipt: https://github.com/nathcymru/Tocyn/issues/59#issuecomment-5593265051

Late #112 review identified missing sender/customer equality in authenticated
canonical attribution. Root fixes projector and focused regression in #60 before
snapshots reuse it. N+1 attachment reads are a measured read-bound concern for #93 pagination/resource acceptance; no unrelated concurrent read-path refactor. No repeated
metered review requested. No #60 completion claim.

| Task | Agent / model / effort | Ownership and reason |
| --- | --- | --- |
| Coordination | Root / inherited | CI, state, GitHub, review, integration; canonical attribution correction |
| #60 owner | release_packaging_escalation / gpt-6-astra / high | Migration, repository, atomic replay engine, immutable snapshots, service; concurrency/security |
| #60 route completion | portal_integration_finish / gpt-6-astra / medium | Completes four route integrations/mocks/docs; escalated after repeated partial handoffs from beta_environment_impl (terra/high) |
| #60 acceptance | retry_acceptance / gpt-5.6-terra / high | New real-D1 concurrent/failure tests, dedicated config and narrow fixture options/counters; isolation and rollback |
| Work pool | Existing attempt | Connector timeout; no confirmed execution or extra capacity claimed |

Branch codex/60-retry-safe-mutations in /tmp/tocyn-60-retry-safe-mutations starts
from e0ce28b. Node 22 locked script-free install and native fixture rebuild passed.
Runtime PATH prefix: /Users/ty/.local/share/fnm/node-versions/v22.19.0/installation/bin.
Four actual Codex slots including root; exclusive file ownership agreed. No PR yet.
Actual start 9 September; receipt:
https://github.com/nathcymru/Tocyn/issues/60#issuecomment-5593266188

## #60 agreed contract

Optional validated Idempotency-Key on API/portal ticket create and reply. Namespace
includes tenant, current API-key/customer principal, operation and hashed key.
Fixed 24-hour database-clock replay window; semantic versioned input fingerprint.
64 KiB streamed JSON bound and typed validation; receipt snapshot bound 256 KiB.
Preserve unkeyed behavior and bodyless create compatibility.

One D1 batch commits all mutation rows plus a completed immutable versioned raw
record snapshot receipt, unique insert last. A conflicting concurrent candidate
rolls back completely, reads winner and reauthorizes before replay or 409 conflict.
No pending lease, second receipt commit, replacement insert, outbox or new journal.
Current auth/permission/ownership remain mandatory on every retry. Replay renders
original response, without repeating mutation, CAPTCHA consumption or notification.

Expired-key replacement is conditional inside the batch. Bounded tenant cleanup
100 rows per new mutation plus operator purge; no hard physical-deletion SLA for
dormant tenants. Privacy deletion atomically redacts receipts into expiry-bounded
key/fingerprint tombstones: matching retries 410, conflicting reuse 409, no content
resurrection. Production cleanup SLA stays #42, not a new local beta approval gate.
Portal reply atomically includes article, attachments and ticket touch. Existing
R2 objects are read before new mutation only. Winner-only best-effort broadcast;
crash before broadcast can lose an event and detail refresh recovers state.

Independent acceptance covers concurrent same/conflicting keys, tenant/principal
isolation, permission revocation, immutable/lost responses, malformed/oversize data,
atomic injected failures, expiry races, privacy tombstones, notification failure,
CORS, unkeyed compatibility and bounded resource/cleanup evidence.

## Critical path and next actions

Not beta-ready. Completed #20, owner-local #57, #58, #19 and #59; security #106/#108
also complete. Seven beta gates remain:
#60 active → #63 and #93 in parallel → #61/#62 → #21 → #65 final local rehearsal.
#65 joins all beta prerequisites. #63 depends on #59 and integrates after #60;
#93 depends on #57/#60. No owner action is currently pending.

Next: settle typed engine interface, implement three owned streams, run targeted
then full required validation, internal review, coherent PR and checked integration.
Coordinator alone accepts issue completion. Refresh successors after accepted merge.
Forecast after #59: #60 target 16 September, #65 target 12 October; unchanged
baselines, 3× effort, Monday–Saturday calendar and two-stream/shared-review capacity.
See private-beta-reforecast-after59-2026-09-09.json; all seven successor Project forecasts and issue receipts synchronized.

Prepared design: /tmp/tocyn-60-design.md. Next guardrails inventory:
/tmp/tocyn-93-preparation.md. Approved issue/ADR scope remains authoritative.
Non-beta work: full cost governance #50/#64/#90, journals #91, redesign #48/#66,
production #42, native email #18 and future channels/autonomy/privacy metadata.
Required correctness cannot be excluded merely because related work is non-beta.

Last operational update 23:24Z 8 September (00:24 BST 9 September). Next due by
23:54Z. Continue through genuine readiness, with concise interim findings.

#60 implementation checkpoint: root canonical attribution regression and dedicated types
pass. Request/CORS foundation 15 tests passed. Initial real API subset exposed a
receipt FK to a nonexistent tenant registry; engine owner removed it, preserving
scoped tenant keys. API rerun passed 4/4, including six concurrent calls with one winner. Route work reassigned to Astra medium
after repeated partial handoffs; new owner repairs incomplete intermediate edits
before subsystem validation. Acceptance suite covers nine broad real-D1 cases;
full passing evidence is still pending. No PR or completion claim yet.

Independent frontend validation: all three application builds passed; portal 13,
widget 3 and root 31 tests passed. Full server and integration checks await stable
route/engine/test source. Prepared successors are persisted in
private-beta-next-dependencies.md.

Final-source checkpoint: replay acceptance 10/10 (16.1s); server 349 across 42
files; server and six dedicated script typechecks pass. Complete lint, workflow
semantics, portal lint, three builds, portal13/widget3/root31 pass. Raw SQL service
and handler wiring detected by lint was corrected through scoped repository methods
and the trusted tenantDeps factory; no lint exception added. Full local integration
chain running. Independent security review running. Operator purge actual Wrangler
proof exposed missing meta.changes in local CLI output; owner correcting result
counting with bounded numeric-only RETURNING rows. Application source frozen.

#60 ready-for-PR evidence: complete local D1/authentication/reset/restart/fixture/
core/storage/realtime/canonical chain passed. Canonical route3/atomic2 includes the
attribution regression. Independent security review found no blocking findings;
existing retention triggers still reject racing mutations atomically. Actual fresh
Wrangler purge proof passed: 100 expired A receipts removed; 2 expired A, 1 active A
and 3 expired B preserved; missing args, remote flag and limit101 refused; temporary
state removed. Direct engine eight-way race committed one ticket/receipt with
identical responses. Application and operator CLI source now frozen. Required remote
CI/security and checked integration remain; #60 is not yet accepted.
