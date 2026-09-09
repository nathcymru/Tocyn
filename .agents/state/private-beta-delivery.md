# Private-beta delivery coordination

Updated 9 September 2026, 02:31 UTC. This is the authoritative coordinator view.
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

Accepted signed main: 58feb5e4deef55670f635f099eb67c6bcfffae56 (PR117), merged
02:23:38 UTC. All required PR checks passed on 316a7cb; GitHub signature is valid.
Postmerge security34303032583 and main CI34303033014 both passed.
Root /Users/ty/Documents/Tocyn is clean at this main revision.

Not beta-ready. Four issues remain open: #62, #21, #93 and #65.

1. #62 functional implementation is on accepted #61 and undergoing final checks.
   Merge its functional increment, retaining the actual reader acceptance gap.
2. #21 combines accepted portal/operator work and validates/fixes included UI.
   Its actual reader evidence also completes the changed-control gates in #62/#93.
3. #65 final candidate joins all accepted prerequisites, real local matrix,
   reproducible parked artifacts and compatible same-state code fallback.

#93 functional guardrails are already merged; its reader criterion remains open.
No gate is waived or transferred merely to close its owning issue.

## Current ownership and branches

Root owns this file, acceptance, GitHub/Project state, final browser work and CI.
Authoritative worktree: /tmp/tocyn-62-guarded-integration,
branch codex/62-local-operator-workflows. Root is its only current editor.

| Work | Agent / model / effort | Current state and reason |
| --- | --- | --- |
| #62 integration | Root; Astra/high | Auth/query state and final integration. Own commit 8b322da on signed58feb5e; no PR yet. Original cdcb74c and original branch/stash preserved. |
| #21 accessibility | beta_guardrails_impl; Astra/high | Cross-session/recovery integration. Temporary /tmp/tocyn-21-integrated-accessibility contains316a7cb + cdcb74c + original21 through02996f8. Preparation only; final base must consume signed62. Original draft PR116 unchanged. |
| #65 lifecycle | release_packaging_escalation; Astra/high | Escalated after repeated lower-model lifecycle corrections failed. Owns existing /tmp/tocyn-65-local-rehearsal and draft PR118. Frozen prior head a6bd66d is not accepted. |
| #65 fallback helper | retry_acceptance; Terra/high | Separate /tmp/tocyn-65-local-fallback; pure comparison commit c467985, now implementing actual same-state orchestration. No edits to lifecycle/runner/package files. Astra is issue owner and integrates the bounded commit. |

Current root #62 validation uses exact CI commands extracted into
/tmp/tocyn-62-required-{lint,typecheck,build,test}.sh, with corresponding logs.
Lint25463, typecheck34769 and build96747 exited0. Full test27897 passed upstream suites, then timed out in the existing guarded
runtime fetch. No listener remained. The unchanged isolated runtime case passed
in8.51s; launcher retry80882 exited0. Remaining operator2/portal1 checks93443
exited0. Operator loop27requests/selectedD1delta3/R2zero; portal69requests.
No timeout increase or application workaround. Ports8787/5173/5174 are free.
All required local checks have now passed; transient timeout is recorded.

Next: commit final state/evidence, push branch, create the
prepared Progresses62 PR using /tmp/tocyn-62-pr-body.md. Required CI must pass.
Do not close62 before reader evidence. Then refresh21 against its signed merge.

## Current evidence and unresolved implementation

### #61 accepted

PR117 fixes stale portal bootstrap overwriting a verified session, SQLite UTC
formatting and strict guarded request-body behavior. Actual local issued A/B
magic links and staff MFA exercise intake/history/follow-up, public/internal
responses, capture outage preserving durable writes, challenge/session expiry,
revocation and tenant denial. Final runner:69 requests, four starts, nine selected
D1 rows, article/event deltas5/5, zero final captures, disposed state.
26 missing-body negatives return controlled400/415 without side effects. Only the
explicit authenticated empty-action inventory permits zero bytes; BOM/null/array/
malformed/media/oversize negatives remain. No new interactive UI was introduced.
Actual guarded browser proved login/reload/create/follow-up/timestamps/sign-out.
Windows shutdown uses the established child.kill pattern, source reviewed only;
Windows runtime was unavailable. Both final review threads resolved with replies
3964055275/3964055365. Completion receipt5594839203; Done100%, actual9Sep,
baseline5Nov preserved, variance-49 Monday–Saturday working days.

### #62 functional evidence

Identity changes replace query caches/page state; generation fences suppress old
200/401/download completions and remount drafts. Live events refresh feed/detail;
accepted PATCH notifies only after committed audit. Upload siblings settle before
unlock; completed file references are reused after partial failure. Accepted-write/
failed-read recovery does not resend. Assignment/group clearing, named detail
controls, focus-preserving pending guards, truthful UUID references and UTC display
are covered. Required CI includes operator route/type gates and London timestamp.

Before final signed-base run: dashboard30, server364, portal19, widget3, root31,
operator2, audit8 and guarded11 passed with types/lint/builds. Actual guarded root
browser handled both API/portal intakes through real MFA: assignment/group,
pending/high, null clears surviving reload, public reply/internal note, resolved
feed. Local stop-writes rejected a reply visibly and retained draft/action focus;
resume plus one explicit keyboard retry saved one reply. Four public retrievals
excluded internal notes. Counters2tickets/20mutations/0uploads; verifier7requests
are separate from browser traffic. Rendered button/error contrast and alert/polite
status semantics observed; no actual reader claim. UTC bug was found and corrected
from02:09 to03:09BST. Private receipt /tmp/tocyn-62-root-browser-receipt.md;
issue progress receipt5594743084.

Root tab9 closed and credential bindings cleared. Fixture/Vite/state/handoff all
removed, ports confirmed free before final tests. Auxiliary private PTY wrapper
needed explicit cleanup after its fallback killpg error; automatic wrapper cleanup
was not claimed. The supported fixture itself had already disposed its state.

### #21 preparation

Original draft116 at02996f8 has portal36/dashboard5 tests and both builds passing.
Login/MFA labels/method/pending feedback, portal named native dialog, history/reply/
attachment controls, latest-read ownership and partial-upload reuse are included.
Combined baseline40portal/34dashboard tests pass. Current temporary integration
adds bounded header/mobile/row names, disclosure
state/Escape focus, feed/create pending focus and required MFA setup failure retry.
See /tmp/tocyn-21-next-review.md. Preserve61 UTC and62 auth/query/realtime changes.
Do not broaden into disabled future provider/settings features. Final integrated
keyboard/native-dialog, contrast and actual screen-reader evidence remain required.

### #65 unresolved lifecycle and fallback

Draft118 is partial. a6bd66d pins frontend inputs, uses a minimal environment,
marks fallback not-run, and tests controlled PTY/npm interruption. Specialist
reproduced a detached descendant surviving leader death while cleanup incorrectly
claimed disposed. Review child was explicitly terminated and verified. Do not
repeat the direct-child-only assumption or claim that a fast cooperative fixture
proves actual nested Wrangler cleanup.

Approved correction: runner-only opt-in Node ownership registry under task0700
root, private bounded records of owned PID/group/start identity, retained after
leader exit. Verify all owned processes stopped, preserve recoverable state and
report incomplete on failure; never signal a reused/unrelated PID. Keep handlers
through cleanup and cover late spawns. No application/bundle/auth changes. Explicit
POSIX-only support is acceptable until other platforms have process-tree evidence.
Actual nested Wrangler interruption requires root's exclusive port handoff.

Fallback helper uses one nonempty persistent synthetic state and private fixture
secrets across candidate then known-good58feb5e code. Require exact migration
manifest compatibility; normal issued customer/MFA requests create conversation,
reply and audit/admission state. Authorized reads and bounded counters must match
under known-good code. No reset/reverse migration/provider rollback claim. Pure
comparisons alone do not complete this runtime proof. Park artifact validation and
actual runtime evidence remain separate. Final candidate waits all beta gates.

## Accepted earlier increments and important decisions

| Issue / PR | Signed merge / outcome |
| --- | --- |
| #20 /101 | 3fae282, contributor setup; Done8Sep, variance-2. |
| #57 /102–105 | Source/local runtime/capture/CORS; Done8Sep, variance-12. Owner local-only authority supersedes historical remote demonstration. |
| #58 /110 | 4bf6dc5, genuine issued two-tenant fixture; Done8Sep, variance-17. |
| #19 /111 | 987218b, actual local isolation/realtime; Done8Sep, variance-24. AI/vector/workflow doubles remain explicitly identified. |
| #106 /107 | 18a5ea7, Vitest/mocker4.1.11; alerts99/100 fixed, not dismissed. |
| #108 /109 | 80e23ba, Sharp0.35.4 narrow override; alert101 fixed. Broader12 remains open. |
| #59 /112 | e0ce28b, canonical atomic intake; Done9Sep, variance-30; receipt5593265051. |
| #60 /113 | 646e1a9, scoped atomic retries; Done9Sep, variance-37; receipt5593570669. |
| #63 /114 | 6a0b3f2, attributable transactional events; Done9Sep, variance-44; receipt5593851738. |
| #93 /115 | c3a9db5, functional resource guardrails; main checks passed. OPEN for reader evidence; receipt5594406704. |

#60 keeps raw64KiB/derived128KiB/receipt256KiB bounds,24h expiry, current auth and
visibility before replay, atomic loser rollback and bounded expiry cleanup. V1
renderer stays frozen; V2 uses immutable event references. #63 facts are scoped,
public history excludes private metadata, and no historical attribution is invented.
#93 finite ceilings100tickets/1000mutations/200recovery reserve/100upload attempts
cannot be raised. Admission+counter+mutation+audit+receipt is atomic. Replays/noops/
denials charge zero; ambiguous R2 attempts are not refunded. Detail limit50,
visibility before LIMIT, four queries at1/50, no automatic legacy R2 materialization.

Keep these corrected decisions: do not weaken article NO ACTION FK for invalid
parent deletion; select the migrated beta SQLite database rather than metadata DB;
do not cap mutation responses after commit; do not prefilter OTP hash before its
wrong-attempt accounting. Review3963747583 was rejected for that reason with a real
attempt-exhaustion regression. Late113 CORS and114 V2 parsing findings were fixed
in115 and resolved. Private findings stay under
/Users/ty/.codex/private/tocyn-beta-delivery; never publish unpatched reproductions.

## Schedule and reporting

Project4 writes work. Preserve approved baselines and3× effort. Applied forecast
source: private-beta-reforecast-after63-2026-09-09.json. Open forecasts remain93
12Sep,62 18Sep,21 19–24Sep,65 25Sep–1Oct; actual independent starts are9Sep.
Reader/access uncertainty prevents a defensible earlier completion forecast despite
early code readiness. Do not invent percentages.61 completed early as recorded above.

Thirty-minute operational update sent02:22UTC; next due02:52UTC. Also give concise
working commentary at least every60seconds. Updates are informational, not approval
gates. Use followup_task to wake idle agents; send_message alone does not wake them.
Non-beta roadmap50/64/90(full cost)/91(journals)/48/66(redesign)/42(production)/18
(native email) stays out of critical-path capacity except required correctness.
