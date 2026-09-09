# Private-beta delivery coordination

Updated 9 September 2026, 04:22 UTC. This is the authoritative coordinator view.
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

Accepted signed main: 018aff41cb55dbdf34bd6e60246827715fb00403 (PR #120), signature
verified by root. Required CI 34309984129/security 34309983146 passed, three analyses
zero, automatic review complete without threads; root/Terra/exact browser review
passed. Main security 34310386087 passed with three zero-result analyses; main CI
34310386652 passed. Accepted tooling PR #118 is signed
7d8187, with main CI 34309233371/security 34309232682 passed; #65 partial receipt 5595575218.

Not beta-ready. Four issues remain open: #62, #21, #93 and #65.

1. #62/#93 functional implementations are merged; their own actual-reader criteria
   remain open. Native keyboard/contrast evidence is in the subsystem receipts.
2. The bounded residual #21 application correction is accepted in PR #120. Actual
   reader acceptance remains open for #21/#62/#93; functional/browser checks do
   not waive those criteria.
3. The first full #65 technical attempt on accepted 018aff41 failed because its
   matrix invoked a nonexistent server lint script. Cleanup completed; no artifact,
   fallback or application/auth flow ran. A narrow command-parity correction now
   uses the actual installed workspace ESLint command and checks every script/tool.
   After its accepted merge, root dispatches the exact immutable corrected candidate
   for a fresh full run, keeping signed 58feb5e4deef55670f635f099eb67c6bcfffae56 as
   prior known-good and retaining the failed 018aff41 receipt separately.

Critical path: #65 command-parity correction → required checks/accepted signed
revision → full technical receipt. Reader acceptance remains a separate required
owner-access dependency. No baseline, forecast or progress percentage is invented.
Root owns Project/issue receipts and forecasts.

No gate is waived or transferred merely to close its owning issue.

## Current ownership and branches

Root owns acceptance, GitHub/Project truth and final browser review. Root delegated
this correction checkpoint to release_packaging_escalation (Astra/high), worktree
/tmp/tocyn-65-rehearsal-correction, branch codex/65-rehearsal-command-parity.
Original recovery branches/stashes and the clean failed-run source are preserved.
Root's codex/65-technical-rehearsal-evidence branch is reserved for final evidence.

#62/#21/#93 functional increments are accepted; their reader criteria remain open.
The independent review agents completed their bounded work. No duplicate review
or remote resources are authorised. #65 correction validation/PR is next; root
alone accepts its merge and dispatches the next exact-source full rehearsal.

The failed 018aff41 attempt receipt is retained privately at
/tmp/tocyn-65-final-rehearsal-018aff41/receipt.json. It records five passed commands,
one failed server-lint command (exit 1), cleanup disposed and fallback not-run.
The temporary candidate/comparison checkouts/state were removed. Correction proof
passed the exact offline/no-install server ESLint command, server cwd/local tool
resolution, all 24 command/tool inventory checks and 19 lifecycle tests. Fresh ignore-scripts
setup needed the routine Node 22 better-sqlite3 rebuild before the loader test
passed. Native bind probes for ports 8787, 5173 and 5174 passed and owned rehearsal task directories were zero. Ports were
explicitly returned to root; no #65 runtime or full rerun is active.

## Current evidence and unresolved implementation

### #61 accepted

PR #117 fixes stale portal bootstrap overwriting a verified session, SQLite UTC
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

### #21 accepted functional evidence

PR #116 corrected mandatory MFA enrollment/confirmation and concurrency fencing.
Actual enrolled-A and unenrolled-B password/MFA journeys recovered from invalid
codes and focused Workspace; setup-ready/key presentation and normal sign-out
were observed. Corrected Wrangler regression: 84 requests, 4 starts, 9 selected D1
rows, 5 article/event pairs, 0 final captures, disposed cleanup. Exact final source
also passed 390×844 navigation open/Close focus/Escape/trigger and destination focus;
portal native chooser remove/blank-reply guard and 62-byte send/download size/hash
were verified. Browser chrome/BODY could receive Tab-boundary focus while the
background stayed inert; no complete in-document cycle or reader claim.

Polling/download corrections have deferred-response/fake-timer and credential/
session-generation regressions. Final portal 53 checks, dashboard 48, builds and
required CI/security passed. All 10 review threads were individually resolved.
Browser source 6dfd26a, final reviewed PR head 279f938, signed merge 65ad06e are distinct.
Private evidence: /tmp/tocyn-21-root-browser-receipt.md; public progress receipt
https://github.com/nathcymru/Tocyn/issues/21#issuecomment-5595420514.

### #65 implemented tooling and remaining rehearsal

The old cooperative-only/direct-child cleanup defect is fixed. Runner-only Node
preload retains bounded private PID/group/start-identity ownership through leader
exit, closes spawning scopes, handles nested loaders/detached tools and verifies
bounded TERM/KILL disposal. Failed verification retains recoverable private state
and reports incomplete. No application imports or provider behavior changed.
macOS/Linux only; macOS start identity has second-level precision. No Windows
runtime claim. Python/pty is optional only for the generic unit case (explicit
skip); actual interruption/full rehearsal refuse its absence before task state.

Audit 8c91a6b removes raw argv/path receipts and generated fixture source, preserves
suppressed credential-bearing child output, and maps only verified missing tables
to schema unavailable. All 9 review threads resolved; fresh JS/Actions/Python
CodeQL results zero and alerts 13–18 fixed without suppression/dismissal. Required
CI 34307518283 passed. Focused checks: lifecycle 16, pure fallback 5, runtime 3, root 52.

Fresh static fixture interruption passed 3.96 seconds on macOS/Node 22: 1 completed/0 skipped,
health 200, 7 registered processes including workerd, repeated npm/PTY Ctrl-C, disposed
state/tree, port reuse, unrelated sentinel preserved. Fixture SHA256
3618e4d5985b6f93ba0fb68853dc8d13042f8271ae132322bbfc3c2f48a8f347 records exact program.
The earlier interruption test took 6.2 seconds and remains historical evidence;
it is not substituted for this run.
The later bounded directory-error/ESRCH review correction passed lifecycle 18 and
repeated actual interruption in 4.09 seconds (1 completed, 0 skipped); independent 8787
bind passed and owned task directories were zero. Root accepted the correction
semantics; first test run caught missing imports, fixed before both final passes.

Focused same-state fallback passed 21.1 seconds on clean 2314188a990265c98d67757048184d1815e3a3ec
against signed 58feb5e4deef55670f635f099eb67c6bcfffae56: normal customer/MFA sessions,
1 ticket/4 articles/4 events, canonical digest and admission running/revision 1/
tickets 1/mutations 4/uploads 0 preserved. Inner/outer cleanup disposed and 8787 reused.
Private redacted receipt: /tmp/tocyn-65-focused-fallback-receipt.json. This is bounded
prior-source evidence, not the final accepted-source rehearsal. Exact migration
compatibility and nonempty shared state remain mandatory; no reset/reverse
migration/provider rollback claim. Full parked artifact/matrix/fallback evidence
remains incomplete after the failed 018aff41 attempt; the corrected-command source
must be accepted before root dispatches the next full run.

## Accepted earlier increments and important decisions

| Issue / PR | Signed merge / outcome |
| --- | --- |
| #20 /101 | 3fae282, contributor setup; Done 8 Sep, variance -2. |
| #57 /102–105 | Source/local runtime/capture/CORS; Done 8 Sep, variance -12. Owner local-only authority supersedes historical remote demonstration. |
| #58 /110 | 4bf6dc5, genuine issued two-tenant fixture; Done 8 Sep, variance -17. |
| #19 /111 | 987218b, actual local isolation/realtime; Done 8 Sep, variance -24. AI/vector/workflow doubles remain explicitly identified. |
| #106 /107 | 18a5ea7, Vitest/mocker 4.1.11; alerts 99/100 fixed, not dismissed. |
| #108 /109 | 80e23ba, Sharp 0.35.4 narrow override; alert 101 fixed. Broader #12 remains open. |
| #59 /112 | e0ce28b, canonical atomic intake; Done 9 Sep, variance -30; receipt 5593265051. |
| #60 /113 | 646e1a9, scoped atomic retries; Done 9 Sep, variance -37; receipt 5593570669. |
| #63 /114 | 6a0b3f2, attributable transactional events; Done 9 Sep, variance -44; receipt 5593851738. |
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
early code readiness. Do not invent percentages. #61 completed early as recorded above.

Operational update delivered 04:22 UTC; next due 04:52 UTC. Root owns updates.
Use concise working commentary while active. Non-beta roadmap #50/#64/#90 (full
cost)/#91 (journals)/#48/#66 (redesign)/#42 (production)/#18 (native email) stays outside
critical-path scope except required correctness. Historical detailed checkpoints
remain in Git history, linked issues and subsystem docs; they are not current gates.


## Residual correction browser checkpoint

Exact frontend 7b3d49b against the unchanged guarded accepted API passed actual
wrong-password retention/correction through normal MFA, native operator FileList
selection/removal/status/focus return, and both 62 B labels. Final counters stayed
1 ticket / 8 mutations / 1 upload attempt; stored rows stayed 1 ticket / 8 articles /
1 attachment. Corrected checks added no conversation writes/uploads. Root's earlier
same-run native UUID assignment/group set/clear/reload, OTP/session recovery,
Cancel/Close and computed contrast receipts are in docs/login-accessibility.md.

Both normal sign-outs, tab closure, viewport reset and memory clearing completed.
Owned API/Vite processes exited; fixture/private handoff/source attachment and the
matching fresh download are absent. Native Node bind probes verified 8787/5173/5174
reusable; initial non-reuse Python bind EADDRINUSE is retained in the private receipt.
Ports returned to root coordination. Actual reader remains pending; no issue closed.
