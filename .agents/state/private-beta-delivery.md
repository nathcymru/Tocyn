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

Main `646e1a9959a2ab94d3509b227da5c4daf81c73ee` (PR #113), verified signed merge.
Main CI 34292262043 and security analysis 34292261623 passed. Required dependency-only PR checks
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

## Latest accepted issues

#59 via #112: signed e0ce28b; canonical API/portal intake, truthful source/timing,
identity provenance, compatibility and atomic initial persistence. Main CI/security
passed. Project Done100%; start8 September, completion9 September; unchanged
baseline14 October, variance-30 Mon–Sat days.
https://github.com/nathcymru/Tocyn/issues/59#issuecomment-5593265051

#60 via #113: final PR head38bc33d500297bc86b5bcc4f8a3b24e717d45536;
signed merge646e1a9959a2ab94d3509b227da5c4daf81c73ee at23:48:20Z 8 September
(9 September Europe/London). Required PR checks from app15368 passed; main
CI34292262043 and security34292261623 passed. Internal implementation/security
reviews passed. Standing approving-review exception used, no machine bypass.
Project Done100%; start/completion9 September; unchanged baseline22 October,
variance-37 Mon–Sat days. Completion: https://github.com/nathcymru/Tocyn/issues/60#issuecomment-5593570669

Four API/portal mutation routes use optional scoped keys, fixed24h expiry,
immutable version1 raw snapshots, final unique receipt INSERT in same D1 batch,
current authentication/visibility and deletion tombstones. Unkeyed/bodyless behavior
retained.64KiB streamed requests;128KiB derived fingerprint cap;256KiB receipt cap.
Scoped repositories own all SQL; trusted tenantDeps composes service. Portal reply
atomically includes attachments/touch and winner-only best-effort notification.
No replay notification, no CAPTCHA/R2 repeat on stored success.100 expired rows
per bounded cleanup; no dormant-tenant physical-deletion SLA or production claim.

Validated server349/replay10/canonical3/atomic2/portal13/widget3/root31; all
server/script types, lint/workflow checks, three builds and full local D1/auth/
reset/restart/fixture/core/storage/realtime chain. Real races: sixAPI creates→one
mutation/receipt; fiveattachment replies→onearticle/attachment; directengine8→one.
Injected row/receipt failures roll back. Snapshot1001bytes. Actual local Wrangler
purge removed100expiredA, preserved2expiredA+1activeA+3expiredB; invalid/remote
options refused, ownedstate removed. Notification failure3transport attempts,
replay0. No new UI. Full reproduction/resource limits in docs/phase-1.4-api-spec.md.

## Review disposition and lessons

Late #112 authenticated-message attribution correction integrated in #113: sender
must match recorded ticket customer; focused matching/missing/mismatching tests pass.
#112 N+1 attachment reads are assigned to #93 bounded detail-read implementation.
Late #113 automatic review has two nonblocking follow-ups: unused retry headers
on wildcard widget routes (no retry capability/API-key permission) are narrowed by
#93; document intentional128KiB derived fingerprint versus64KiB external limit in
#63 versioned contract. These do not allow oversized external requests or privilege
gain. Resolve review threads after corresponding integration; no repeated metered
review request. Review IDs/comments are accessible on #113.

Avoid repeated partial route handoffs: #60 terra/high integration was escalated to
Astra/medium after incomplete edits, then full tests passed. Always use Node22;
Node26 failed native addon ABI. Raw SQL service/handler access must stay behind
repositories; do not suppress lint. Receipt table has no tenant-registry FK because
no tenant registry exists. Wrangler local --json omits meta.changes; bounded purge
uses numeric-only RETURNING row count. Freeze source before final validation.

## Active allocation and exclusive ownership

| Task | Agent / model / effort | Ownership and reason |
| --- | --- | --- |
| Coordinator | Root / inherited | CI, state, GitHub, integration and final acceptance |
| #63 owner | release_packaging_escalation / gpt-6-astra / high | Event migration, repositories/services/routes, versioned snapshots, existing mocks/docs; atomicity/privacy |
| #63 acceptance | retry_acceptance / gpt-5.6-terra / high | New real-D1 audit acceptance/config, agreed narrow fixture helpers; concurrency/isolation |
| #93 owner | beta_guardrails_impl / gpt-6-astra / high | Independent policy/counter/operator/read bounds and tests; durable admission/auth boundaries |
| Work pool | Existing attempt | Connector timeout, native tool denial; no execution/capacity claimed |

Four active Codex slots including root. Both issue owners start9 September after
accepted #60. Root alone declares acceptance. Worktrees from646e1a9:
- /tmp/tocyn-63-conversation-audit, branch codex/63-conversation-audit (authoritative state).
- /tmp/tocyn-93-local-beta-guardrails, branch codex/93-local-beta-guardrails.

Node22 PATH prefix /Users/ty/.local/share/fnm/node-versions/v22.19.0/installation/bin.
Both locked script-free installs and better-sqlite3 rebuilds passed, zero advisories.
No PR yet for #63/#93. Designs /tmp/tocyn-63-design.md and /tmp/tocyn-93-design.md;
approved issue/ADR scope is authoritative. Do not overwrite independent branch work.

## Integration plan and ready queue

#63 owns all shared mutation batch assembly until accepted merge. #93 independently
builds policy/counter/control/read-bound files; no circular import of unmerged #93
into #63. After #63 integration, rebase #93 and add admission+counter to the same
batches before mutation/event/final receipt. One owner edits shared files at a time;
no generic arbitrary SQL hook or duplicate commit engine. Same-key race at final
quota slot must replay valid winner, not falsely429. No-op/replay charges zero.

#63: four fixed tenant events (intake/reply/assignment/state), actual transaction
prior/new facts, trusted submitting actor distinct from message author, bounded
safe history and current visibility. Public history conservatively intake/replies;
no internal sequence/count clues. Conversation-lifecycle erasure. Keep liveV1
snapshots unchanged; newV2 includes truthful fixed audit refs. No journal/outbox.

#93: exact two-tenant/invited-principal local admission, finite durable counters,
stop/restart/recovery, upload-attempt bounds, bounded paged reads/attachments,
disabled optionalAI/jobs/providers, bounded diagnostics. Proposed conservative
local defaults are implementation choices, not invented owner commitments.
Preserve human handling and accepted conversations; no #50/#90 broad budgets.

Not beta-ready. Six gates remain: #63/#93 active; then #61/#62 in parallel after
#60/#63; #21 after both; #65 joins all beta prerequisites for final local rehearsal.
Completed #20/#57/#58/#19/#59/#60 and security#106/#108. No owner action pending.
Non-beta: fullcost#50/#64/#90, journals#91, redesign#48/#66, production#42,
nativeemail#18/futurechannels/autonomy/privacy. Required correctness never excluded.

Next: settle audit typed contract, implement/validate owned workstreams, issue63
checked integration, refresh successors and integrate guarded batches. Keep full
required checks at PR boundaries and updates tied to evidence. Forecast after60
preserves baselines/3× effort/Mon–Sat/two-stream/shared-review model; all six successor forecasts and issue receipts synchronized. See private-beta-reforecast-after60-2026-09-09.json.

Operational update delivered23:54Z 8 September (00:54BST9 September); next due
by00:24Z9 September. Continue concise interim findings and genuine beta completion.

Forecast correction: independent #93 policy work can start with #63, but final
shared integration cannot finish before #63. Reserve #93 integration17 September
(after #63 target16 September), then W2 #62 starts18 September and targets23.
#61 remains17–22 September; #21 moves24–29 September; #65 forecast30 September–
6 October. The previous5 October forecast failed to reserve that integration day.
Baselines/approved effort remain unchanged; this is an implementation sequencing
constraint, not a new product prerequisite. All four affected Project fields and issue receipts are synchronized.

Early #63 review: API history preserves existing public-message-only read semantics;
full internal/state/assignment reconstruction stays staff-authorized. Retained system
notes use readable transaction-derived prose rather than JSON/UUIDs. Migration version
CHECK changed to NULL-safe comparison; dedicated negative fixture required. V1 replay
renderer remains frozen, new V2/live detail uses only visible event references.

Early #93 review: standalone policy tests pass assertion insert/conflict, reserve,
rollback and revisioned stop/resume. Direct local SQLite operator must be proven
against actual running Wrangler/warmed connections/concurrent writes and restart;
otherwise use supported local execution. CLI malformed-policy errors must not echo
file contents. Guarded beta launch must explicitly enable policy and fail closed,
not silently use unguarded developer defaults. No new owner approval pending.

#63 full validation checkpoint: root's seven dedicated types, complete lint/workflow,
three builds, portal13/widget3/root31 and full local D1/auth/reset/restart/fixture/
core/storage/realtime/canonical3/atomic2 chain pass. Independent audit expanded tests
pending final result. Parent ticket DELETE with live articles fails the existing0014
NO ACTION FK, not the new audit FK; exercise supported child cleanup/retention order
and bodyless parent deletion. Do not weaken that existing FK to satisfy an invalid
test assumption. Root has released port8787 to #93; no persistent server is running.

#93 independent guarded fixture tests pass actual principals/invitations, exactcapture,
revoked session, nine disabled/unclassified route negatives and JSON/page bounds.
Detail query count four at page sizes1 and50, filter-before-limit and no legacy R2
body reads. Shared mutation accounting and real Wrangler stop/coherence acceptance
remain pending integration after #63; no premature enforcement claim.

#63 independent acceptance checkpoint:8 cases and dedicated types pass. Covers all
actor sources, concurrent prior/new chain/assignment/no-op, atomic event/late-receipt
rollback, actual valid V1 runtime replay, V2 stability, current auth/privacy/cursors,
newly-hidden detail and deletion/redaction. Facts82bytes<=4096; after lifecycle Aevents0,
B preserved1; selectedfixtureD1rows9 excludesarticles/events, R2objects0, routeRequests3.
The additional supported retention proof passed: an aged audited bodyless ticket
completed scoped claimRetention/completeRetention; its events were removed and
tenant B remained intact. Dedicated types and the lifecycle case passed again.
Application source is frozen. Coordinator is publishing the coherent #63 PR;
required remote checks and integration acceptance remain pending.
