> **Historical beta delivery record.** Current coordination and ready queue: [post-beta alignment](post-beta-alignment.md). Preserve this evidence; do not execute its old next actions.

# Private-beta delivery coordination

Updated 9 September 2026, 07:06 UTC. This is the authoritative coordinating view.
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

The owner authorised Safari/VoiceOver testing, temporary AppleScript spoken-output
reading, Safari activation and VoiceOver AppleScript navigation/activation. Safari
navigation now works; VoiceOver initially interacted inside static text and was
moved out. Computer Use explicitly denied UserNotificationCenter for safety
reasons; that system surface must not be bypassed. Actual Safari speech is
observable; DOM/AX alone still does not satisfy reader acceptance.

Restore test settings afterward: VoiceOver initially off; Allow VoiceOver to be
controlled with AppleScript initially unchecked; Show caption panel already
checked and unchanged. Never target the denied native Codex surface through
VoiceOver. One initial last-phrase read returned unrelated prior UI speech; it is
excluded from application evidence and must not be persisted.

Use Node 22.19.0 from /Users/ty/.local/share/fnm/node-versions/v22.19.0/installation/bin.
Node 26 caused native-addon ABI failure. Rebuild the locked better-sqlite3 under
Node 22 after ignore-scripts setup when needed. Preserve dashboard CRLF.

## Delivery outcome and accepted source

The approved local-only testing boundary has complete implementation, actual
reader acceptance, final-source validation, reproducibility and recovery evidence.
The final evidence PR records #65 acceptance. Before that PR merges, #65 remains
open; GitHub/Project are the authoritative closure records. No production, public release or real-customer onboarding is authorised.

Accepted application: 049ea82a02571681f834bcd87d43253603edf71f, signed PR #124,
merged 06:47:41 UTC. Application files exactly match actual-reader candidate
ba026f4. PR CI 34320237473/security 34320234786 passed; JS/TS 1745993468,
Python 1745992565 and Actions 1745992199 analyses returned zero findings. Required
check app identity was verified. Automatic review approved; its non-blocking style
comment was dispositioned/resolved. Main CI 34320694039/security 34320694094 passed;
main analyses 1746020910/1746017973/1746017261 also returned zero findings.

#62/#93/#21 were accepted 9 September, Project Done/100, actual completion and
forecast target 2026-09-09. Receipts: 5597521433, 5597523278, 5597525070. Approved
baselines are unchanged; actual variances -51/-45/-56 Monday–Saturday working days.
#65 final evidence supports Done/100, actual completion 2026-09-09, variance -63;
root synchronises these only after the final evidence PR passes and merges.

See docs/private-beta-readiness.md, docs/login-accessibility.md and
 docs/local-beta-rehearsal.md for scope, exact evidence and known limits.

## Final rehearsal and reader evidence

The fresh full rehearsal on accepted 049ea82 against known-good
58feb5e4deef55670f635f099eb67c6bcfffae56 passed all 46 ordered commands, zero skips:
22 once-only matrix checks, two independent dashboard/portal builds and five
artifact steps per root, setup and actual same-state fallback. Command duration
166442 ms; wall time 171573 ms. Artifacts match: 40 files/2316679 bytes, digest
7afaa9a67aa52f22a6aeb5753059c3529291efd8de95493ab837c2ed268d536f.
Fallback preserved 1 ticket/4 articles/4 events, running revision1 admission
1 ticket/4 mutations/0 uploads. Inner/outer cleanup disposed, zero owned task or
successful-run diagnostic directories, native ports reusable. The full redacted
receipt is docs/evidence/local-beta-rehearsal-2026-09-09-049ea82.json.

Actual Safari/VoiceOver covered normal and required MFA, authentication errors,
customer/operator handling, public/internal replies, attachments, both pagination
controls, selected values, stopped/resumed writes and narrow navigation. The
native-select stale spoken value defect was corrected and all four controls
verified without reload. Deferred pending/fault tests remain distinct from manual
observations. Independent acceptance review found no mandatory workflow gap.

Reader fixture final state: 2 tickets/13 admitted mutations/1 upload attempt; stored rows
2 tickets/64 articles/1 attachment/13 events/5 users/1 group/1 membership. Historical
articles/selector targets were explicitly synthetic setup, not admission evidence.
Rejected writes left counters unchanged. Normal session revocation, created-tab
cleanup, private fixture/handoff removal, exact synthetic file removal and native
8787/5173/5174 binds were verified. VoiceOver off, AppleScript control unchecked,
caption preference unchanged, responsive mode exited, localhost downloads Ask.
All runtime ports are returned; no test environment is left running.

## Storage incident and coordination cleanup rule

The coordinator retained generated dependencies from completed workstreams too
long: 27 temporary checkouts at roughly 528 MiB each accumulated around 14 GiB. This
was a delivery-workspace cleanup failure, not source-repository growth. Root
removed only generated dependency trees, preserving source/Git/uncommitted work
and receipts, then reclaimed the two completed final-checkout dependency trees.
Keep the canonical development checkout's dependencies available for normal work.

The first 049ea82 attempt failed at known-good install (scope 44) with npm-confirmed
ENOSPC, and final receipt writing also failed. 43/44 closing markers meant automatic
state retention was appropriately fail-closed. An independent 475-identity audit
proved zero live processes before owned recovery/removal and native port checks.
The masked cleanup exception is not assigned an invented cause. Recovered partial
evidence is separately retained in the storage-failure JSON; the fresh full pass
is never substituted for that failure. Earlier 018aff41/953af436 failures and the
39b32b8 historical success remain in the rehearsal documentation.

At each future workstream handoff: confirm all processes have stopped, preserve
source/receipts and uncommitted changes, and reclaim generated dependencies from
completed temporary checkouts. Retain installed dependencies only where active
work needs them. Before a full isolated rehearsal, check available disk and budget
for three independent installations plus build/cache overhead. Do not retain many
completed installs or infer free capacity from the small source repository size.

## Allocation and next actions

| Workstream | Agent/model/effort | Final state/reason |
| --- | --- | --- |
| Acceptance/integration | Root | Owns final evidence PR and GitHub/Project truth. |
| Native-select fix | Terra/high → Astra/high | Escalated after concurrent-confirmation review gaps; accepted actual-reader correction. |
| Final rehearsal | release_packaging_escalation, Astra/high | Complete; lifecycle/fallback complexity; ports returned. |
| Fixture/main gates | runtime_failure_triage, Terra/medium | Complete; routine local setup/teardown and read-only CI checks. |
| Acceptance mapping | retry_acceptance, Terra/high | Complete; scope/security/failure evidence assessment. |
| Evidence drafting | evidence_copyedit, Luna/low | Complete; bounded mechanical documentation. |

No coding task remains on the approved beta critical path. Root's last integration
step is final evidence PR acceptance and #65 closure/Project synchronisation; verify
that record before starting a later delivery phase. Do not rerun the full matrix
solely because an evidence-only commit changes its Git SHA; verify application
files remain identical to the accepted tested revision. Any new application change
requires assessed revalidation. The documented guarded launcher starts a fresh
local synthetic environment; do not reuse deleted credentials.

Non-beta work remains #50/#64/#90 (full costs), #91 (journals), #48/#66 (headless/
themes), #42 (production), #18 (native mail), and other roadmap channels/features.
Do not spend new critical-path capacity there without a new scope. No owner input
or approval remains unanswered for the completed local testing boundary.

## Governance guardrails retained

Partial PRs must have empty closingIssuesReferences; the final #65 evidence PR
intentionally references only #65. Historical negated closing prose accidentally
closed #93/#65 and was corrected (5595893832/5595893993); never repeat it. Keep
approved baselines, MIT attribution, existing negative/tenant/failure checks and
all beta limits. #93 ceilings remain 100 tickets/1000 mutations/200 recovery reserve/
100 upload attempts; #60 raw 64 KiB/derived 128 KiB/receipt 256 KiB and 24h expiry remain.
Denied/no-op/replayed mutations charge zero; ambiguous R2 attempts are not refunded.
No remote resource, credential, provider, release/tag or production action follows
from local beta readiness.
