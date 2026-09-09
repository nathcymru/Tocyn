# Private-beta delivery coordination

Updated 9 September 2026, 03:53 UTC. This is the authoritative coordinator view.
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

Accepted signed main: 65ad06ee3e905acf9ec59d17bdd951993381e818 (PR116), merged
03:38:58 UTC. Root verified the GitHub signature. Required PR CI 34307583055 and
security 34307580665 passed. Earlier signed PR119 d394bd7 and PR117 58feb5e are
preserved in history; postmerge PR116 main checks remain separately tracked by root.

Not beta-ready. Four issues remain open: #62, #21, #93 and #65.

1. #62 and #93 functional implementations are merged; actual reader acceptance
   remains in their own criteria.
2. #21 corrected source is merged, including mandatory MFA enrollment, guarded
   downloads, polling ownership, named controls and responsive navigation.
   Actual reader and remaining complete journey/focus-cycle evidence remain open.
3. #65 tooling is being refreshed onto accepted PR116. After required checks and root
   acceptance merge PR118, run one full technical matrix/reproducibility/fallback
   rehearsal against that signed immutable merge in a clean checkout, using signed
   58feb5e4deef55670f635f099eb67c6bcfffae56 as the prior known-good application. No provisional
   full run is needed solely to repeat it for a squash SHA. Technical evidence may
   proceed with reader evidence pending, but cannot close #65/readiness. A later
   reader-driven source change invalidates the technical candidate.

No gate is waived or transferred merely to close its owning issue.

## Current ownership and branches

Root owns acceptance, GitHub/Project truth and final browser review. Root delegated
this exact coordinator checkpoint to the #65 owner in /tmp/tocyn-65-local-rehearsal,
branch codex/65-local-rehearsal, existing PR118. Root alone decides its merge.
Original recovery branches/stashes remain preserved.

| Work | Agent / model / effort | Current state and reason |
| --- | --- | --- |
| #62 integration | Root; Astra/high | Functional PR119 accepted; issue stays open for reader evidence. |
| #21 accessibility and MFA | beta_guardrails_impl; Astra/high | Functional PR116 accepted 65ad06e after exact-source browser, runtime, security and review evidence. Actual reader gate preserved. |
| #65 lifecycle and fallback | release_packaging_escalation; Astra/high | Existing PR118 source refreshed onto 65ad06e. Prior audit 8c91a6b required CI 34307518283 passed; fresh CodeQL analysis 1745369561 zero, alerts 13–18 fixed, all 9 threads resolved. Refreshed local tests pass: dashboard 48, portal 53, server 373, widget 3, root 52; runtime 3/types and workflow validation pass. Refreshed required CI 34308155782 and zero-result CodeQL passed. Three late review comments received one bounded cleanup correction; final checks pending. |
| Independent review | retry_acceptance; Terra/high | Bounded lifecycle/fallback and frontend reviews complete; no blocking findings or reader claim. No redundant review loop. |

All root browser windows/credential bindings, #21 fixtures/private downloads and #65
interruption fixtures are disposed. Native 8787/5173/5174 reuse was verified by #21;
#65's later independent 8787 probe also passed with zero owned Wrangler task dirs.
No live fixture or remote service is owned by #65 now. Root has port ownership for
residual accepted-source browser checks; final rehearsal waits its explicit handoff.

Next: validate/publish refreshed PR118, inspect required CI/security and review state,
and make it ready for root acceptance. After its signed merge, root dispatches the
single full technical rehearsal. Keep #65 open; final receipt belongs in the issue
and a dedicated evidence/state PR after that meaningful acceptance boundary.

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

### #21 accepted functional evidence

PR116 corrected mandatory MFA enrollment/confirmation and concurrency fencing.
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

Fresh static fixture interruption passed 3.96s on macOS/Node 22: 1 completed/0 skipped,
health 200, 7 registered processes including workerd, repeated npm/PTY Ctrl-C, disposed
state/tree, port reuse, unrelated sentinel preserved. Fixture SHA256
3618e4d5985b6f93ba0fb68853dc8d13042f8271ae132322bbfc3c2f48a8f347 records exact program.
Earlier 6.2s interruption remains historical evidence, not substituted for this run.
The later bounded directory-error/ESRCH review correction passed lifecycle 18 and
repeated actual interruption in 4.09s (1 completed, 0 skipped); independent 8787
bind passed and owned task directories were zero. Root accepted the correction
semantics; first test run caught missing imports, fixed before both final passes.

Focused same-state fallback passed 21.1s on clean 2314188a990265c98d67757048184d1815e3a3ec
against signed 58feb5e4deef55670f635f099eb67c6bcfffae56:normal customer/MFA sessions,
1 ticket/4 articles/4 events, canonical digest and admission running/revision 1/
tickets 1/mutations 4/uploads 0 preserved. Inner/outer cleanup disposed and 8787 reused.
Private redacted receipt: /tmp/tocyn-65-focused-fallback-receipt.json. This is bounded
prior-source evidence, not the final accepted-source rehearsal. Exact migration
compatibility and nonempty shared state remain mandatory; no reset/reverse
migration/provider rollback claim. Full parked artifact/matrix/fallback evidence
remains pending the accepted PR118 merge and explicit root dispatch.

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

Operational update delivered 03:52 UTC; next due 04:22 UTC. Root owns updates.
Use concise working commentary while active. Non-beta roadmap #50/#64/#90(full
cost)/#91(journals)/#48/#66(redesign)/#42(production)/#18(native email) stays outside
critical-path scope except required correctness. Historical detailed checkpoints
remain in Git history, linked issues and subsystem docs; they are not current gates.
