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

Work connector reads recovered once, but repository-task loading still timed out;
no Work execution is confirmed. Native Codex app Computer
Use was denied by tool restriction, with no Mac prompt or pending Mac permission.
Browser Computer Use works. Do not circumvent the denied native route.

## Accepted main and completion evidence

Main `6a0b3f2cc51c9125d01089044e3d9c53f3b88cf3` (#114), verified signed.
Main CI 34294704988 and security analysis 34294704689 passed. Required PR
checks match GitHub Actions app 15368. No repeat manual Copilot review requested.

| Issue / PR | Accepted evidence |
| --- | --- |
| #20 / #101 | Contributor setup complete, signed 3fae282. Done 100%, 8 Sep, baseline target 10 Sep, variance -2 working days. |
| #57 / #102–105 | Owner-local runtime/source artifacts, capture and loopback CORS complete. Done 100%, 8 Sep, baseline 22 Sep, variance -12. Historical remote scope is not claimed. |
| #58 / #110 | Four actual issued principals, D1/R2 fixture, captured A/B identities and scoped keys. Signed 4bf6dc5, all checks passed. Done 100%, 8 Sep, baseline 28 Sep, variance -17. |
| #19 / #111 | Full local isolation matrix plus actual Wrangler WebSocket revocation/preservation, signed 987218b. Done 100%, 8 Sep, baseline 6 Oct, variance -24. AI/vector/workflow boundaries use explicit doubles. |
| #106 / #107 | Vitest/mocker 4.1.11, signed 18a5ea7; alerts 99/100 fixed, not dismissed. Done 100%, 8 Sep. |
| #108 / #109 | Narrow Sharp 0.35.4 override, signed 80e23ba; alert 101 fixed. Done 100%, 8 Sep. #12 broader enforcement remains open. |
| #59 / #112 | Canonical API/portal contract and atomic initial persistence, signed e0ce28b, main checks passed. Done 100%, start 8 Sep/completion 9 Sep, baseline 14 Oct, variance -30. |
| #60 / #113 | Atomic retry-safe mutations, signed 646e1a9; required and main checks passed. Done 100%, 9 Sep, baseline 22 Oct, variance -37. |
| #63 / #114 | Transactional attributable conversation events, signed 6a0b3f2; required and main checks passed. Done 100%, 9 Sep, baseline 30 Oct, variance -44. |

Recent completion receipts:
- #59: https://github.com/nathcymru/Tocyn/issues/59#issuecomment-5593265051
- #60: https://github.com/nathcymru/Tocyn/issues/60#issuecomment-5593570669
- #63: https://github.com/nathcymru/Tocyn/issues/63#issuecomment-5593851738

#60 uses optional scoped keys on four API/portal routes, fixed 24h expiry,
64 KiB streamed input, 128 KiB derived fingerprint and 256 KiB immutable receipts.
Current authentication/ownership/visibility is checked on every retry. Same-batch
unique receipt INSERT rolls back losers; no-key/bodyless behavior remains.
Actual races and rollback tests passed; local cleanup removed 100 expired A rows
while preserving active A and all B rows. No dormant-tenant deletion SLA is claimed.

#63 records intake/reply/assignment/state in the mutation batch with the verified
submitting actor, actual prior/new values, safe facts and scoped history. Staff see
full authorized reconstruction; API/customer see only public intake/replies without
private IDs, state facts or sequence gaps. V1 renderer stays frozen; V2 captures
immutable event references. No journal, outbox or retroactive invented attribution.

#63 validation: server 349; audit 8 plus targeted real audited retention proof;
replay 10, canonical 3, atomic 2; dedicated types, lint/workflow checks, three builds,
portal 13/widget 3/root 31; full local D1/auth/reset/restart/fixture/core/storage/
actual Wrangler realtime chain. Lifecycle measured 82-byte facts (4 KiB cap),
A events removed including actual retention, B event preserved, R2 zero and three
route requests. Selected fixture D1 counter nine excludes articles/events.

## Critical path and ownership

Not beta-ready. Five gates remain: #93, #61, #62, then #21, then #65.
#61/#62 dependencies #60/#63 are cleared. Their final guarded acceptance and shared
UI/runtime integration follow #93. #21 follows both customer/operator workflows;
#65 joins all prerequisites for final local rehearsal/artifact preparation.

Authoritative state is this branch: `codex/93-local-beta-guardrails`, worktree
`/tmp/tocyn-93-local-beta-guardrails`. Root owns state, CI, GitHub, review and acceptance.

| Issue | Agent / environment | Model / effort | Reason |
| --- | --- | --- | --- |
| #93 | beta_guardrails_impl; /tmp/tocyn-93-local-beta-guardrails | gpt-6-astra / high | Admission concurrency, auth and durable limits |
| #62 | release_packaging_escalation; /tmp/tocyn-62-operator-workflows | gpt-6-astra / high | Confirmed authentication-state correctness fix and operator coverage |
| #61 | retry_acceptance; /tmp/tocyn-61-local-portal-workflows | gpt-5.6-terra / high | Actual auth/session failure and tenant-isolation acceptance |

Branches are respectively `codex/93-local-beta-guardrails`,
`codex/62-operator-workflows`, `codex/61-local-portal-workflows`. No PR yet for these.
#93 independent checkpoint ef88533358bff6a2ff77c646e6ea3971719b1110 rebased on #63.
#61/#62 start receipts and Project In progress / Actual start 9 Sep synchronized:
https://github.com/nathcymru/Tocyn/issues/61#issuecomment-5593827768
https://github.com/nathcymru/Tocyn/issues/62#issuecomment-5593823259

#93 owns shared mutation/detail/upload integration and portal/dashboard pagination.
Exact invited principals/two tenants, finite counters, recovery reserve, durable
stop/resume and default-denied unused routes are implemented independently.
Policy/read tests pass; detail reads are four queries at page sizes 1 and 50 with
filtering before LIMIT and no legacy R2 body materialization. Portal/dashboard
pagination component tests pass focus/status and retained-message checks.
Actual Wrangler proved warm reads, immediate operator stop visibility, restart
persistence, stale revision denial, counter-preserving resume and malformed-policy
redaction. Disposable state was removed and port 8787 released.
Remaining: same-batch guards/receipts/audit, final-slot races, upload integration,
combined recovery proof, browser acceptance and full required checks.

#62 first fixes the privately recorded authenticated-state defect with a fresh
query client per identity generation, old-request cancellation and stale-response
suppression. Regression covers old 200/401 completion, cached rendering and drafts.
Independent auth/feed edits proceed; #93 retains useTickets/detail until integration.
Then assignment clearing, pending/error feedback and actual operator exchange.
No unpatched reproduction enters public issue/repository state.

#61 builds the non-interactive local Wrangler exchange with real issued A/B magic
links and staff password/MFA, public/internal replies, cross-tenant denial, actual
challenge/session expiry and revocation, plus controlled captured-mail outage.
Use startup injection/runner-owned seams; no forged tokens or public test controls.
Shared local runtime/auth/Env seams coordinate with #93 before editing.

## Review decisions and failed approaches

- #113 automatic comment 3963303853: widget CORS unnecessarily advertised retry
  headers. No widget retry capability or privilege gain; narrow in #93 and test.
- #113 comment 3963303895: 128 KiB normalized vs 64 KiB raw is intentional derived
  field allowance, now clarified in #63 docs. Resolved thread PRRT_kwDOUPj5os6gc4Nf with merged evidence on #113.
- #114 review 5148394400/comment 3963473722: defensive parsing for V2 helper and
  dispatcher. Existing service catches and JSON constraints fail closed. Batch
  bounded parsing/null handling regression with #93 replay integration.
- Do not weaken the existing article-to-ticket NO ACTION FK to satisfy direct
  parent deletion with live articles. Supported child cleanup and actual retention
  were tested; the initial invalid test assumption was corrected.
- Local Wrangler state contains a metadata SQLite file too. Operator discovery
  must select exactly one migrated beta database and validate fixture rows.
- Do not put a post-handler response cap on successful mutations: enforce input/
  snapshot bounds before commit; generic response size cap applies to reads.
- Node 22 is required; Node 26 produces native-addon ABI failures. Use installed
  /Users/ty/.local/share/fnm/node-versions/v22.19.0/installation/bin in PATH.
- Agent send_message does not wake idle agents; use followup_task for new work.

## Forecast, next actions and boundaries

After #63 acceptance, apply `private-beta-reforecast-after63-2026-09-09.json`:
#93 target 12 Sep; #61 target 15 Sep; #62 target 18 Sep; #21 19–24 Sep;
#65 25 Sep–1 Oct. Preserve all approved baselines and 3× effort. W1 reserves #61;
W2 reserves #93 then #62; early independent #62 preparation does not claim a third
full forecast stream. Receipt/Project synchronization status is in that JSON.

Next: review #93 combined enforcement and #62 auth boundary; integrate #93 after
complete checks, refresh #61/#62, finish their actual exchange, then #21 and #65.
Root consolidates review findings; no repetitive metered Copilot requests.

Non-beta roadmap: full cost #50/#64/#90, journal #91, redesign #48/#66,
production #42, native email #18 and future channels/autonomy/privacy. Required
correctness remains mandatory. No owner approval is pending.

Operational update delivered about 00:24 UTC 9 September; next due 00:54 UTC.
Continue concise interim findings. No Work execution claim; native denial remains
respected. Local beta readiness is not production or public release authority.

## Next accessibility work prepared for #21

Existing portal UI gaps are owned by #21, not silently waived or duplicated before
its #61/#62 prerequisites. #61 currently adds no new browser UI.
- TicketListPage: associate Subject/Message labels and ids; replace create alert
  with an announced/focusable error; focus form on open and restore trigger after
  close/success; test keyboard, focus and error flow.
- TicketDetailPage: label reply textarea/file input; name back/remove icon controls;
  announce reply/upload errors; test keyboard attachment/remove/reply focus flow.
- Login/Verify already have associated fields; still include in full #21 audit.

#61 independent actual Wrangler exchange/expiry/outage suite passes before guarded
rebase. Clock injection is authentication-only construction-time test behavior; D1
and admission clocks remain real. No global simulated-time claim. #93 real live
stop/reply race, saved replay, restart counters, resume and exhaustion passed.
#62 auth boundary seven tests and feed/create recovery three tests pass; local
operator mutation/retrieval suite is being added. Final branch integration and
required checks remain mandatory for all three issues.

## Required validation checkpoint — #93

Root full required typecheck, three builds and full test chain passed. Logs are
/tmp/tocyn-93-{typecheck,build,test}.log. Workflow semantic tests also passed.
Required lint found nine real boundary violations, not waived: scope construction
in application.ts and raw D1/SQL in new middleware/customer-auth service. Owner is
moving these into existing trusted auth/composition and scoped repository methods;
no lint rule changes. Revalidate affected auth/guard paths and complete lint after
correction. All test processes ended and port 8787 is free.

Root owns dev frontend sessions: dashboard 86583 on 5173, portal 42532 on 5174
(both #93 worktree, no VITE_API_URL override). Browser tab 2 in iab is a temporary
portal login tab; no API fixture is running yet. Browser acceptance follows the
corrected source freeze. Never claim the earlier ef885333 foundation contains the
uncommitted shared integration. #61 waits for exact accepted #93 merge; its local
checkpoint b478209 is clean and unpushed. #62 independent tests pass; new detail
acceptance tests deliberately await its post-#93 page wiring.

## Browser checkpoint and remaining #93 correction

Corrected source passes complete lint (no exemptions), full dedicated types,
362 server tests, 10 guardrail cases and fresh real beta/auth/realtime tests.
Browser caught and verified fixes for lost focus on final pagination and numeric
visibility rendering. Both real views show 50→52 fixture messages, completion
focus remains, polite status works, contrast 17.74/17.85:1. Stop intake visibly
rejects and preserves draft/accepted conversation; counters remain1/1/0 on resume.
51 historical rows were seeded only for pagination, not claimed admissions.

Root stopped frontend/API sessions and closed its three temporary browser tabs.
All ports8787/5173/5174 were free. Supported npm/PTy Ctrl-C left the exact owned
fixture directory; root removed it and verified absence. #93 owner is now fixing
persistent idempotent signal handling and proving actual repeated Ctrl-C cleanup,
with8787 reserved by that agent. No credentials or state path is preserved here.

#61 confirmed/fixed portal bootstrap stale-401 login race and SQLite UTC display
on its own branch; commits b478209 then080212a, pending #93 rebase. #62 confirmed
missing local Vite WebSocket proxy flag and will prove browser connection. These
are required workflow defects, not scope deferrals. Its owner also independently
reviews #93 late boundary/UI corrections.

Operational update delivered about00:54 UTC; next due01:24 UTC. No owner action
pending. Next: accept corrected #93 cleanup evidence, publish coherent PR and
pass required checks, integrate, then refresh #61/#62 and finish their UI work.

## Final #93 acceptance checkpoint

The final sequential real runtime and actual PTY launcher tests passed (8.7s and
13.0s). Single and repeated Ctrl-C both remove run-owned state and credentials,
release the port and exit. Affected launcher lint and local fixture/beta types
pass. Independent review of late architecture and UI corrections found no
blocking finding. Source is frozen for the coherent #93 PR; required GitHub
machine/security checks must still pass before the authorized review exception.

All root temporary tabs and processes are disposed. Port ownership is now handed
to #62 for independent auth/feed/realtime browser checks while #93 CI runs. #61
commits b478209 and 080212a remain held for the exact accepted #93 merge. Next:
publish #93, inspect required checks and automatic review together, integrate,
then refresh both dependent branches and complete guarded workflow acceptance.

## #93 acceptance correction before integration

PR115 implements and validates the guardrail contract, but actual screen-reader
announcement evidence remains open for its new pagination controls. The PR uses
Progresses #93; do not close #93 or set 100%. Keyboard/DOM/AX/contrast evidence
does not replace an actual reader. Native Safari CUA access timed out (-10005),
not a macOS permission denial; Codex native access remains previously denied.
Read-only feasibility and exact next checks: /tmp/tocyn-21-acceptance-plan.md.
Dependent #61/#62 may integrate against the accepted functional source while
this explicit beta gate remains open. No acceptance criterion is waived.
