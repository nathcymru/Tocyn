# Private-beta delivery coordination

Updated 9 September 2026, 05:39 UTC. This is the authoritative coordinating view.
GitHub issues and Project 4 hold acceptance and schedule truth. Detailed historical
checkpoints remain in Git history, issue receipts and the linked subsystem docs.

## Authority and boundaries

Complete the approved beta work without weakening acceptance. Use only local
Wrangler at http://localhost:8787, local D1/R2/DO and local mail capture. No remote
Cloudflare resources/accounts, external mail, production migration, paid resource,
provider activation, onboarding, release/tag or traffic cutover. GitHub source
and governance delivery are authorised.

Approved capture addresses: tocyn-auth-test@example.invalid,
tocyn-auth-test-a@example.invalid and tocyn-auth-test-b@example.invalid. Keep
canonical identities distinct; use normally issued credentials, magic links and
MFA. Never store credentials or capture links in repository evidence.

Standing owner approval permits the PR-only approving-review exception after
internal review and every required machine/security check passes. Do not ask
again. Verify the accepted merge signature and exact PR head. Do not request
repetitive manual Copilot reviews; no such extra request has been made.

Work connector reads recovered once, but repository-task loading timed out; no
Work execution is confirmed. Native Codex app Computer Use was explicitly denied,
without a macOS prompt. Do not circumvent that restriction.

The owner has now authorised Safari/VoiceOver testing, temporary AppleScript
spoken-output reading, and confirmed Safari foreground/any VoiceOver prompt
allowed. Safari access now works. VoiceOver's own caption-app selection timed
out. Computer Use explicitly denied UserNotificationCenter for safety reasons;
that system surface must not be bypassed. The owner confirmed Safari foreground
and any VoiceOver prompt allowed; no particular prompt interaction is claimed.

An additional request is pending: use VoiceOver's AppleScript navigation commands
and bring Safari forward when needed. The current AppleScript authority is
read-only spoken phrases; do not infer navigation authority from elapsed time.
Computer Use delivered attempted VoiceOver shortcuts as typing in the synthetic
form, so those attempts are not reader-navigation proof. Real Safari speech is
now observable; DOM/AX alone still does not satisfy reader acceptance.

Restore test settings afterward: VoiceOver initially off; Allow VoiceOver to be
controlled with AppleScript initially unchecked; Show caption panel already
checked and unchanged. Never target the denied native Codex surface through
VoiceOver. One initial last-phrase read returned unrelated prior UI speech; it is
excluded from application evidence and must not be persisted.

Use Node 22.19.0 from /Users/ty/.local/share/fnm/node-versions/v22.19.0/installation/bin.
Node 26 caused native-addon ABI failure. Rebuild the locked better-sqlite3 under
Node 22 after ignore-scripts setup when needed. Preserve dashboard CRLF.

## Accepted source and genuine remaining gates

Accepted signed main: 39b32b87339a4b2b85b1064b576bb559e90fece8, PR #122, merged
05:18:25 UTC. Root verified signature valid. Final PR CI 34313949608 and
security 34313946776 passed; analyses 1745667790/1745667001/1745666910 had zero
results. Automatic review approved, all threads resolved, closing references
empty. Main CI 34314352914 and security 34314352283 passed; analyses 1745690006,
1745687668 and 1745687233 had zero results.

Not yet beta-ready. Four beta blockers remain OPEN: #21, #62, #93 and #65.
#21/#62/#93 functional, keyboard and contrast increments are accepted. Their
actual-reader criteria remain required. #65 technical rehearsal now passed;
its dependency/reader acceptance and final evidence integration remain.

Critical path: actual Safari/VoiceOver acceptance -> correct any discovered
included-workflow defects -> affected validation -> accepted evidence -> honest
issue/Project completion and final readiness decision. A successful technical
rehearsal does not waive the reader gate. No production action is authorised.

## Current ownership and local environment

Root owns acceptance, GitHub/Project truth and actual browser/reader checks.
Root branch codex/65-technical-rehearsal-evidence at
/tmp/tocyn-65-technical-rehearsal-evidence contains the technical receipt, docs,
new native-dialog receipt and this coordinating state. Application code is unchanged.

| Task | Agent/model/effort | Status and reason |
| --- | --- | --- |
| #65 tooling and full rehearsal | release_packaging_escalation, Astra/high | Completed; process ownership/recovery risk. Independent receipt audit also complete. |
| Failed runtime triage | runtime_failure_triage, Terra/medium | Completed read-only analysis; original failure cause remains unknown. |
| Reader fixture operation | runtime_failure_triage, Terra/medium | Supported fixture retained; routine setup and cleanup ownership. |
| Auth/attachment and reader-gate audit | retry_acceptance, Terra/high | Completed; authorization boundaries and acceptance review. |
| Evidence copyedit | evidence_copyedit, Luna/low | Completed; routine formatting only. |

Active reader fixture is accepted main 39b32b8. Guarded API wrapper session 51488,
dashboard Vite 50252, portal Vite 65171; runtime_failure_triage owns teardown on
root request. Root owns 8787/5173/5174 for this reader session. Private credentials
handoff is outside the repository under the run-owned tocyn-21-browser-juju4ks8
directory; do not print or copy its contents. Four principals, no conversation
writes/seeding so far. Safari has the original Start Page plus created dashboard
and portal tabs. Declined Safari password saving. Normal operator MFA is complete;
portal remains at login. Sign out, close only created tabs, clear secrets, restore
VoiceOver settings, dispose fixture, and verify ports when finished.

Actual reader observations so far: required password-field/native empty-form
validation; MFA instructions; spoken Invalid MFA code; successful Workspace main
navigation. These are partial observations, not a complete reader receipt.
Remaining: complete included login/session/MFA setup, portal dialog/history/reply/
attachments/recovery, operator queue/detail/composer/assignment/state/errors,
responsive navigation and both real pagination progress/completion announcements.

## Technical rehearsal evidence

Full rehearsal passed once on accepted 39b32b8 against signed known-good
58feb5e4deef55670f635f099eb67c6bcfffae56. All 46 commands passed, exact ordered plan
matched: 22 once-only matrix entries, two independent frontend builds and five
artifact steps per checkout, setup and same-state fallback. Recorded command
durations total 194847 ms. Runtime command 31127 ms; fallback wrapper 19727 ms.

Artifacts matched byte-for-byte: 40 files, 2314872 bytes; release digest
ae998a526d1cf5e11bd36cd5fed587d463da7c48fd10408e845b30d383acc0f6.
Parked artifact source proof does not provide an enabled app route or deployment.
Actual local fallback preserved 1 ticket/4 articles/4 events and admission running,
revision 1/tickets 1/mutations 4/uploads 0. Canonical and migration digests are in
docs/evidence/local-beta-rehearsal-2026-09-09.json.

Inner/outer cleanup disposed; independent 8787/5173/5174 binds passed; zero owned
rehearsal directories and zero retained diagnostic directories. These ports were
then separately allocated to the current reader fixture. Private original receipt,
verification and matrix audit remain under /tmp/tocyn-65-final-rehearsal-39b32b8.
Root independently read the receipt; release_packaging_escalation confirmed the
checked-in copy exactly matches it. docs/local-beta-rehearsal.md maps the evidence.

Preserve failed attempts separately: 018aff41 failed at nonexistent server lint
alias (fixed PR121); 953af436 passed 19 of 24 matrix entries then runtime exited 1.
Original runtime output was discarded, so cause remains unexplained. One same-control
targeted repeat passed. Neither failure is relabelled by the new successful run.
PR122 retains all checks, builds both artifact roots independently and keeps only
bounded private failed stdout/stderr tails. Diagnostic failure cannot hide primary
process failure; sibling cleanup continues. Final capture-enabled interruption
passed 3.84 s, 1 completed/0 skipped, 7 processes, disposed state/tree, preserved
sentinel and reusable ports. No timeout or acceptance weakening.

## Accepted application and prerequisite evidence

| Issue / PR | Outcome |
| --- | --- |
| #20 /101 | Signed 3fae282, setup; Done 8 Sep. |
| #57 /102-105 | Local runtime/capture/CORS; Done 8 Sep. Local-only authority supersedes historical remote demonstration. |
| #58 /110 | Signed 4bf6dc5, genuinely issued two-tenant fixture; Done 8 Sep. |
| #19 /111 | Signed 987218b, actual local isolation/realtime; Done 8 Sep. AI/vector/workflow doubles remain explicitly identified. |
| #106 /107 | Vitest/mocker 4.1.11; alerts 99/100 fixed, not dismissed. |
| #108 /109 | Sharp 0.35.4 override; alert 101 fixed. Broader #12 remains open. |
| #59 /112 | Signed e0ce28b, canonical atomic intake; Done 9 Sep; 5593265051. |
| #60 /113 | Signed 646e1a9, scoped atomic retries; Done 9 Sep; 5593570669. |
| #63 /114 | Signed 6a0b3f2, transactional attributable events; Done 9 Sep; 5593851738. |
| #61 /117 | Signed 58feb5e, two-tenant portal acceptance; Done 9 Sep; 5594839203. |
| #93 /115 | Signed c3a9db5, functional resource guardrails; reader criterion OPEN. |
| #62 /119 | Signed d394bd7, guarded human operator handling; reader criterion OPEN; 5594997825. |
| #21 /116,120 | Signed 65ad06e and 018aff41, included accessibility/auth/attachment corrections; reader acceptance OPEN. |

PR120 correction source 7b3d49b passed 63 dashboard/59 portal tests, types/builds,
lint/workflows and zero-advisory audits. Actual browser proved wrong-password
retention/correction through MFA, native attachment selection/removal/focus and
both 62 B labels. Prior guarded handling/stop/retry/tenant evidence remains in
subsystem docs. New native forward/reverse/Escape/Cancel dialog traversal on
accepted 953af436 passed, with zero conversation writes/uploads and verified
cleanup. Browser-chrome BODY focus was distinguished from background app access.

#93 finite ceilings 100 tickets/1000 mutations/200 recovery reserve/100 upload
attempts cannot be raised. Admission/counters/mutation/audit/receipt remain atomic;
replays/noops/denials charge zero, ambiguous R2 attempts are not refunded. Detail
limit 50, visibility before LIMIT, four queries at 1/50. #60 keeps raw 64 KiB/derived
128 KiB/receipt 256 KiB and 24-hour expiry. Do not weaken NO ACTION FK, prefilter OTP
attempt accounting, cap responses after commit or fabricate historical attribution.

## Governance, schedule and exact next actions

GitHub auto-closed #93 at PR116 and #65 at PR118 because negated prose contained
closing keywords. Root corrected both bodies, verified closing references empty,
reopened both and verified Project In progress/progress unchanged/completion unset.
Receipts 5595893832/5595893993. Before every partial merge inspect
closingIssuesReferences; afterward verify issue state. Use Progresses for partial
PRs, never negated closing-keyword phrases.

#65 merge receipt 5596226223 records PR122. Project 4 writes work; current four
blockers are In progress, progress 0 retained, actual start 9 Sep, completion unset.
Preserve approved baselines and 3x effort; do not invent percentages. Forecast source
private-beta-reforecast-after63-2026-09-09.json remains #93 12 Sep, #62 18 Sep, #21
19-24 Sep, #65 25 Sep-1 Oct. Update completion only after acceptance against merged
evidence. Owner access has improved but reader outcome is not established yet.

Next: obtain the pending specific navigation authority; complete reader checks on
the retained fixture; address actual defects if any; finish and validate the evidence
PR; integrate under existing approval; synchronize all acceptance/progress/schedule
fields honestly. Do not repeat the full matrix solely for an evidence-only commit.
Any application correction requires assessment and affected revalidation.

Operational update delivered 05:26 UTC; next due 05:56 UTC. Root owns updates.
Non-beta roadmap #50/#64/#90 (full costs), #91 (journals), #48/#66 (redesign), #42 (production),
#18 (native mail), #12 (dependency-only checks) stays outside critical-path scope
unless needed for correctness. Historical evidence remains in Git and linked docs.
