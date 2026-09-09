# Private-beta delivery coordination

Updated 9 September 2026, 03:21 UTC. This is the authoritative coordinator view.
GitHub issues and Project 4 remain the acceptance/schedule records. Historical
checkpoints and receipts remain in Git history, linked issues and subsystem docs.

## Authority and environment

Complete the approved beta work without weakening acceptance. Use only local
Wrangler at http://localhost:8787, local D1/R2/DO simulations and local mail capture.
No remote Cloudflare resources/accounts, external email, production migration,
provider activation, paid resources, onboarding, public release, tag or cutover.
GitHub source delivery and governance are authorised.

Approved capture recipients: tocyn-auth-test@example.invalid,
tocyn-auth-test-a@example.invalid and tocyn-auth-test-b@example.invalid. Preserve
separate canonical identities and use normally issued magic links and MFA sessions.
Never forge customer tokens or put credentials, capture links or tenant data here.

Standing owner approval permits the PR-only approving-review exception after
internal review and all required machine/security checks pass. Do not ask again.
Machine checks and accepted-merge signature verification remain mandatory.
No repeat manual Copilot review requests have been made.

Work connector reads recovered once, but repository-task loading timed out; no
Work execution is confirmed. Native Codex app Computer Use was explicitly denied
by the tool, without a macOS prompt. Do not circumvent that restriction.

Actual VoiceOver testing against a standalone Safari local window is awaiting the
owner's answer to the existing access question. Safari selection previously timed
out (-10005); no OS permission/settings change occurred. DOM/AX/live-region checks
are not actual screen-reader speech evidence. Do not use denied Codex native UI
indirectly through VoiceOver. In-app browser automation is available to root only.

Use Node 22.19.0 from /Users/ty/.local/share/fnm/node-versions/v22.19.0/installation/bin.
Node 26 caused native-addon ABI failure. If the locked better-sqlite3 binding is
missing after ignore-scripts installation, rebuild that component under Node 22;
do not skip affected tests. Preserve CRLF in existing dashboard source files.

## Accepted main and remaining gates

Accepted signed main: d394bd71d020204f75999cf1f21ad6022f478787 (PR119), merged
02:45:32 UTC. All required PR checks passed and GitHub signature is valid.
Postmerge security 34304488185 and main CI 34304488433 both passed.
Root /Users/ty/Documents/Tocyn is clean at this main revision.

Not beta-ready. Four issues remain open: #62, #21, #93 and #65.

1. #62 functional implementation is merged; actual reader/UI acceptance remains.
2. #21 has corrected the browser-discovered mandatory MFA enrollment blocker and
   passed both MFA browser journeys; final PR checks and manual UI evidence remain. Its reader evidence also supports #62/#93.
3. #65 lifecycle and focused same-state proof pass. Final accepted-source technical
   matrix and parked artifact reproducibility follow corrected #21 integration.
   These may run while reader evidence is pending, but cannot close readiness.
   A later reader-driven source change invalidates the technical candidate.

#93 functional guardrails are merged; its reader criterion remains open.
No gate is waived or transferred merely to close its owning issue.

## Current ownership and branches

Root owns this file, acceptance, GitHub/Project truth and final browser review.
Authoritative correction worktree: /tmp/tocyn-21-login-accessibility,
branch codex/21-login-accessibility. Original and temporary integration recovery
refs are preserved; the temporary integrated worktree remains at d89ef59.

| Work | Agent / model / effort | Current state and reason |
| --- | --- | --- |
| #62 integration | Root; Astra/high | Complete functional PR119; issue stays open for reader/UI evidence. Final original branch721ae6f and recovery stash preserved. |
| #21 accessibility and MFA | beta_guardrails_impl; Astra/high | PR116 returned to draft after the 03:13 review discovered polling and download-boundary defects. One consolidated correction now passes 53 portal tests/lint/build and root internal review. Fresh responsive/attachment/browser checks and final CI precede readiness; signed #119 integration is preserved. |
| #65 lifecycle and fallback | release_packaging_escalation; Astra/high | Owner of /tmp/tocyn-65-local-rehearsal and PR118. Final 0c0d080 CI/security are green; unchanged actual interruption/fallback evidence is tied to2314188. Final technical matrix awaits accepted #21. |
| Independent review | retry_acceptance; Terra/high | Bounded lifecycle/fallback and frontend reviews complete, no blocking findings. Actual screen-reader/mobile evidence not claimed. Currently idle; no redundant review loop. |

#21 browser fixture has been disposed. #65 interruption/fallback fixture also
fully disposed and returned8787 to #21 for corrected runtime tests. Root browser
windows closed and credential memory cleared. No remote services used.

Next: fresh responsive/attachment/polling browser checks on the consolidated
#21 correction; update existing draft116 and pass all required checks. Preserve reader
acceptance as open. #65 prepares existing draft118 in parallel and then runs the
technical rehearsal on the accepted corrected source. Final readiness awaits
complete acceptance, not merely passing machine checks.

## Current evidence and unresolved implementation

### #61 accepted

PR117 fixes stale portal bootstrap overwriting a verified session, SQLite UTC
formatting and strict guarded request-body behavior. Actual local issued A/B
magic links and staff MFA exercise intake/history/follow-up, public/internal
responses, capture outage preserving durable writes, challenge/session expiry,
revocation and tenant denial. Final runner: 69 requests, four starts, nine selected
D1 rows, article/event deltas 5/5, zero final captures, disposed state.
26 missing-body negatives return controlled 400/415 without side effects. Only the
explicit authenticated empty-action inventory permits zero bytes; BOM/null/array/
malformed/media/oversize negatives remain. No new interactive UI was introduced.
Actual guarded browser proved login/reload/create/follow-up/timestamps/sign-out.
Windows shutdown uses the established child.kill pattern, source reviewed only;
Windows runtime was unavailable. Both final review threads resolved with replies
3964055275/3964055365. Completion receipt 5594839203; Done 100%, actual 9 Sep,
baseline 5 Nov preserved, variance -49 Monday–Saturday working days.

### #62 functional evidence

Identity changes replace query caches/page state; generation fences suppress old
200/401/download completions and remount drafts. Live events refresh feed/detail;
accepted PATCH notifies only after committed audit. Upload siblings settle before
unlock; completed file references are reused after partial failure. Accepted-write/
failed-read recovery does not resend. Assignment/group clearing, named detail
controls, focus-preserving pending guards, truthful UUID references and UTC display
are covered. Required CI includes operator route/type gates and London timestamp.

Before final signed-base run: dashboard 30, server 364, portal 19, widget 3, root 31,
operator 2, audit 8 and guarded 11 passed with types/lint/builds. Actual guarded root
browser handled both API/portal intakes through real MFA: assignment/group,
pending/high, null clears surviving reload, public reply/internal note, resolved
feed. Local stop-writes rejected a reply visibly and retained draft/action focus;
resume plus one explicit keyboard retry saved one reply. Four public retrievals
excluded internal notes. Counters: 2 tickets, 20 mutations, 0 uploads; verifier 7 requests
are separate from browser traffic. Rendered button/error contrast and alert/polite
status semantics observed; no actual reader claim. UTC bug was found and corrected
from 02:09 to 03:09 BST. Private receipt /tmp/tocyn-62-root-browser-receipt.md;
issue progress receipt 5594743084.

Root tab 9 closed and credential bindings cleared. Fixture/Vite/state/handoff all
removed, ports confirmed free before final tests. Auxiliary private PTY wrapper
needed explicit cleanup after its fallback killpg error; automatic wrapper cleanup
was not claimed. The supported fixture itself had already disposed its state.

### #21 preparation

Original draft 116 at 02996f8 has portal 36/dashboard 5 tests and both builds passing.
Login/MFA labels/method/pending feedback, portal named native dialog, history/reply/
attachment controls, latest-read ownership and partial-upload reuse are included.
Combined baseline: 40 portal/34 dashboard tests pass. Current temporary integration
adds bounded header/mobile/row names, disclosure
state/Escape focus, feed/create pending focus and required MFA setup failure retry.
See /tmp/tocyn-21-next-review.md. Preserve #61 UTC and #62 auth/query/realtime changes.
Do not broaden into disabled future provider/settings features. Final integrated
keyboard/native-dialog, contrast and actual screen-reader evidence remain required.

### #65 unresolved lifecycle and fallback

Draft 118 is partial. a6bd66d pins frontend inputs, uses a minimal environment,
marks fallback not-run, and tests controlled PTY/npm interruption. Specialist
reproduced a detached descendant surviving leader death while cleanup incorrectly
claimed disposed. Review child was explicitly terminated and verified. Do not
repeat the direct-child-only assumption or claim that a fast cooperative fixture
proves actual nested Wrangler cleanup.

Approved correction: runner-only opt-in Node ownership registry under task mode-0700
root, private bounded records of owned PID/group/start identity, retained after
leader exit. Verify all owned processes stopped, preserve recoverable state and
report incomplete on failure; never signal a reused/unrelated PID. Keep handlers
through cleanup and cover late spawns. No application/bundle/auth changes. Explicit
POSIX-only support is acceptable until other platforms have process-tree evidence.
Actual nested Wrangler interruption requires root's exclusive port handoff.

Fallback helper uses one nonempty persistent synthetic state and private fixture
secrets across candidate then known-good 58feb5e code. Require exact migration
manifest compatibility; normal issued customer/MFA requests create conversation,
reply and audit/admission state. Authorized reads and bounded counters must match
under known-good code. No reset/reverse migration/provider rollback claim. Pure
comparisons alone do not complete this runtime proof. Park artifact validation and
actual runtime evidence remain separate. Final candidate waits all beta gates.

## Accepted earlier increments and important decisions

| Issue / PR | Signed merge / outcome |
| --- | --- |
| #20 /101 | 3fae282, contributor setup; Done 8 Sep, variance-2. |
| #57 /102–105 | Source/local runtime/capture/CORS; Done 8 Sep, variance-12. Owner local-only authority supersedes historical remote demonstration. |
| #58 /110 | 4bf6dc5, genuine issued two-tenant fixture; Done 8 Sep, variance-17. |
| #19 /111 | 987218b, actual local isolation/realtime; Done 8 Sep, variance-24. AI/vector/workflow doubles remain explicitly identified. |
| #106 /107 | 18a5ea7, Vitest/mocker4.1.11; alerts 99/100 fixed, not dismissed. |
| #108 /109 | 80e23ba, Sharp0.35.4 narrow override; alert 101 fixed. Broader #12 remains open. |
| #59 /112 | e0ce28b, canonical atomic intake; Done 9 Sep, variance-30; receipt 5593265051. |
| #60 /113 | 646e1a9, scoped atomic retries; Done 9 Sep, variance-37; receipt 5593570669. |
| #63 /114 | 6a0b3f2, attributable transactional events; Done 9 Sep, variance-44; receipt 5593851738. |
| #93 /115 | c3a9db5, functional resource guardrails; main checks passed. OPEN for reader evidence; receipt 5594406704. |

#60 keeps raw 64 KiB/derived 128 KiB/receipt 256 KiB bounds, 24-hour expiry, current auth and
visibility before replay, atomic loser rollback and bounded expiry cleanup. V1
renderer stays frozen; V2 uses immutable event references. #63 facts are scoped,
public history excludes private metadata, and no historical attribution is invented.
#93 finite ceilings: 100 tickets, 1000 mutations, 200 recovery reserve, 100 upload attempts
cannot be raised. Admission+counter+mutation+audit+receipt is atomic. Replays/noops/
denials charge zero; ambiguous R2 attempts are not refunded. Detail limit 50,
visibility before LIMIT, four queries at 1/50, no automatic legacy R2 materialization.

Keep these corrected decisions: do not weaken article NO ACTION FK for invalid
parent deletion; select the migrated beta SQLite database rather than metadata DB;
do not cap mutation responses after commit; do not prefilter OTP hash before its
wrong-attempt accounting. Review 3963747583 was rejected for that reason with a real
attempt-exhaustion regression. Late #113 CORS and #114 V2 parsing findings were fixed
in #115 and resolved. Private findings stay under
/Users/ty/.codex/private/tocyn-beta-delivery; never publish unpatched reproductions.

## Schedule and reporting

Project 4 writes work. Preserve approved baselines and 3× effort. Applied forecast
source: private-beta-reforecast-after63-2026-09-09.json. Open forecasts remain #93
12 Sep; #62 18 Sep; #21 19–24 Sep; #65 25 Sep–1 Oct; actual independent starts are 9 Sep.
Reader/access uncertainty prevents a defensible earlier completion forecast despite
early code readiness. Do not invent percentages.61 completed early as recorded above.

Thirty-minute operational update sent 02:22 UTC; next due 02:52 UTC. Also give concise
working commentary at least every 60 seconds. Updates are informational, not approval
gates. Use followup_task to wake idle agents; send_message alone does not wake them.
Non-beta roadmap #50/#64/#90(full cost)/#91 (journals)/#48/#66 (redesign)/#42 (production)/#18
(native email) stays out of critical-path capacity except required correctness.

## Coordinator update — 2026-09-09 02:52 UTC

PR #119 merged at 02:45:32 UTC as signed d394bd71d020204f75999cf1f21ad6022f478787. Required PR checks and internal review passed; main CI 34304488433 and security 34304488185 passed. Issue #62 remains open for reader/UI acceptance; partial receipt 5594997825 records the boundary. Root main is clean at that revision.

Four beta blockers remain open: #62, #21, #93 and #65. No readiness declaration. #21 owns local ports 8787/5173/5174 with isolated synthetic fixtures. Its temporary candidate b2bc593 includes portal reference fallback and initial browser evidence. Browser portal login, create, reply, dialog initial/Escape focus passed. Full focus-cycle and actual screen-reader acceptance are not claimed. Fifty historical synthetic articles were added solely to exercise pagination; they are not admitted writes or fabricated audit receipts.

Normal unenrolled operator login exposed an MFA enrollment blocker. The #21 owner is implementing the narrow login/session correction and negative regressions; sensitive diagnosis stays private. Original PR #116 remains recoverable. Final source must refresh from accepted #119 before integration.

#65 owner release_packaging_escalation (Astra/high) has lifecycle 13, pure fallback 4 and runtime/bootstrap 2 checks passing. Root and targeted Terra/high internal review precede the actual repeated-PTY Wrangler interruption test. No live recovery/fallback proof yet; wait for explicit #21 port release. Same-state fallback implementation is integrated, and unavailable fallback remains a failed rehearsal. Final complete rehearsal waits for all prerequisite acceptance.

Owner permits all three example.invalid local test recipients and standing PR-only approving-review exceptions after mandatory checks and internal review pass. No remote Cloudflare or external mail action is allowed. Safari/VoiceOver approval question remains pending; no OS permission change or actual reader proof. Work execution remains unavailable/unconfirmed; do not report that pool as used.

Next: finish and independently review MFA correction; resume exact-candidate browser/reader acceptance; release local ports for #65 interruption and same-state proof; integrate #21 after all required checks; close #62/#93 only against complete acceptance; run final #65 candidate rehearsal. Operational update delivered 02:52 UTC; next due 03:22 UTC while active.

### Local test handoff — 02:58 UTC

#21 browser windows closed and tool-local credentials cleared. Owner disposed API/Vite fixtures, verified private handoff removal and bind reuse on 8787/5173/5174. #65 now owns the local port for interruption and focused same-state proof. #21 correction is isolated in /tmp/tocyn-21-mfa-correction, preserving the browser candidate; initial server 370 tests pass, conditional enrollment race protection is under review before final runtime validation. Partial root browser receipt is /tmp/tocyn-21-root-browser-receipt.md; actual screen reader remains pending.

#21 partial browser progress receipt: https://github.com/nathcymru/Tocyn/issues/21#issuecomment-5595086687. #65 actual interruption passed in 6.2 seconds: local health 200, seven recorded processes including workerd, repeated real npm/PTY Ctrl-C, complete disposal and port release, unrelated sentinel preserved. Same-state fallback proof is next and still unproved.

#65 focused same-state proof passed on clean 2314188a990265c98d67757048184d1815e3a3ec against signed 58feb5e4deef55670f635f099eb67c6bcfffae56. 21.1 seconds; one ticket, four articles, four audit events and authorised canonical digest preserved; admission running/revision 1/tickets 1/mutations 4/uploads 0 unchanged. Inner/outer cleanup disposed and 8787 reusable. Root inspected redacted receipt /tmp/tocyn-65-focused-fallback-receipt.json. Port returned to #21 for corrected runtime/browser checks. Final artifact rehearsal remains pending prerequisites.

Independent internal review: Terra/high found no actionable frontend delta defect through b2bc593, with actual reader/mobile containment explicitly unproved. Root reviewed MFA audience delegation and conditional setup/confirm writes; no remaining blocking finding after stale enrollment write correction. Final tests and exact-source integration remain required. #65 owner preparing coherent update to existing draft #118, with Progresses #65 only.

## Exact-source MFA browser acceptance — 03:09 UTC

On d8dadfefb2ac5c40851c9996bb80d67d79d22b62, root completed normal unenrolled-B password login, setup-ready status, code initial focus and named QR/text-key presentation. A deliberately invalid code produced an associated inline error while preserving setup; a corrected current issued-key code completed enrollment and focused Workspace. Normally issued enrolled-A password/MFA also recovered from an invalid code and focused Workspace after correction. Normal sign-out returned login. Manual typed-code retention was not established; no digits/key/link are recorded.

Corrected actual Wrangler regression: 84 requests, four starts, nine selected D1 rows, five article/event pairs, zero final captures and disposed cleanup (13.36 seconds). Refreshed frontend checks: dashboard48/portal42 and both builds pass. Internal auth, tenant, concurrency and frontend review found no remaining blocking defect.

Root closed the browser and cleared credentials. Owner disposed both frontends/API, verified private handoff removal, zero interactive fixture directories and 8787/5173/5174 bind reuse. PR116 remains Progresses21, with actual reader/responsive-navigation and other unperformed manual acceptance explicit. Source is frozen; final documentation/CI checks precede integration.

PR118 prior head95d4cf3 passed full required CI34305592423/security. Its owner pushed final portability batch0c0d080 (POSIX execution tests skipped off macOS/Linux with a pure refusal contract test); root49/49 focused tests pass and updated CI is pending. Unchanged actual interruption/fallback evidence remains tied to2314188. No full final technical artifact rehearsal yet.


## PR116 consolidated review correction

The 03:13 review found a background polling/pagination announcement defect and a
portal download credential/session-generation gap. PR116 returned to draft for
one correction batch, with no readiness claim. Background reads now defer to
interactive read ownership and keep live feedback stable; explicit recovery
retains accepted-reply semantics. Download credential and session-boundary
handling is corrected with synthetic deferred response/blob and auth-failure
regressions. Optional storage failures cannot prevent the existing in-memory
logout/generation transition. OTP input accepts six ASCII digits.

The previous sentinel comment was already semantically addressed by !==false;
explicit outcomes preserve it. Native open-attribute fallback was rejected because
it loses modality. Root reviewed the bounded batch without a remaining blocker.
All 53 portal tests, lint and build pass; application source is ready for a fresh
browser checkpoint, not yet accepted. Supported CUA documentation now exposes
viewport.set/reset and filechooser.setFiles, so responsive/attachment observations
are actionable. Actual reader acceptance remains separate and open. No new review
request, authorization change or allowlist expansion is introduced.
