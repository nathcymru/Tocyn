# Private Beta Readiness Report

**Ready for the approved local-only private-beta testing boundary, 9 September
2026.** The required workflows, guardrails, actual reader acceptance and final
accepted-source rehearsal are complete. This report accompanies final evidence
acceptance for #65. Before this evidence PR merges, that issue remains open.
This report grants no production or public-release authority.

## Approved testing boundary

The planned beta is local-only: Wrangler API at `http://localhost:8787`, standalone
dashboard and customer portal on local development ports, two synthetic tenants,
invited identities and a local authentication-mail capture adapter. The approved
addresses are `tocyn-auth-test@example.invalid`,
`tocyn-auth-test-a@example.invalid` and `tocyn-auth-test-b@example.invalid`.
Authentication links and codes are inspectable locally. External mail, remote
Cloudflare resources and provider activation are outside this authority.

## Accepted prerequisites

| Required outcome | Accepted evidence |
| --- | --- |
| Repository and security foundation | #20 / PR #101; security dependency corrections #106 / PR #107 and #108 / PR #109. |
| Isolated local environment and authentication capture | #57 / PRs #102–105; #58 / PR #110; security/authentication #19 / PR #111. |
| Canonical intake and bounded persistence | #59 / PR #112; #60 / PR #113; #63 / PR #114. |
| Human customer workflow | #61 / PR #117, including local authentication and canonical customer access. |
| Operator handling | #62 / PRs #119 and #124; guarded handling, public/internal replies, assignment/state and failure recovery. |
| Resource guardrails | #93 / PR #115; authoritative admission limits, local invitations/mail restrictions, AI-off operation and operator stop/recovery. |
| Core accessibility | #21 / PRs #116, #120 and #124; keyboard/contrast plus actual Safari/VoiceOver acceptance and corrected native selector speech. |
| Final reproducibility and fallback | #65 / PRs #118, #121 and #122; final accepted-source receipt below. |

The accepted application revision is
`049ea82a02571681f834bcd87d43253603edf71f` (signed PR #124). Its application
files exactly match the actual-reader-tested correction. Later evidence-only
changes must not be confused with new application behavior.

## Validation and operational evidence

See [actual reader acceptance](./login-accessibility.md) for the spoken matrix,
source provenance and settings/fixture teardown. Customer/operator authentication,
mandatory MFA setup, create/history/reply, attachments, both pagination controls,
selected ticket values, stopped-write recovery and narrow navigation were tested.
Deferred pending and injected failure tests are labelled separately.

The reader fixture ended at 2 tickets, 13 admitted mutations and 1 upload attempt. Rejected
writes did not increment its counters. Explicit synthetic historical rows were
not represented as admitted events. Private fixture state and test files were
removed, sessions revoked, original accessibility settings restored and local
ports verified reusable.

The final [technical rehearsal](./local-beta-rehearsal.md) passed all 46 commands,
including 22 matrix checks, independent byte-identical artifacts and same-state
code fallback against known-good `58feb5e4deef55670f635f099eb67c6bcfffae56`.
The [machine receipt](./evidence/local-beta-rehearsal-2026-09-09-049ea82.json)
records 40 artifact files/2,316,679 bytes, a preserved 1-ticket/4-article/4-event
fallback state, and complete inner/outer cleanup. No successful-run private
output remains. PR #124 and its accepted main revision passed CI/security; all
three exact-source CodeQL analyses had zero findings.

## Test environment and remaining boundaries

The verification fixture is disposable and has been stopped. The supported
[guarded local beta procedure](./local-beta-guardrails.md) starts fresh isolated resources;
use the documented local mail-capture view for authentication. Do not reuse the
removed test credentials or connect the launcher to a remote account.

The candidate `v0.4.0-beta.1` preparation is source/rehearsal evidence. Parked
artifacts have no enabled application route; their reproducibility is distinct
from the actual local runtime tests. No tag, GitHub release or deployment was
created. Production migration/cutover clearance remains #42.

Non-beta roadmap work remains tracked: durable journals (#91), comprehensive
cost/capacity policies and controls (#50/#64/#90), headless components and themes
(#48/#66), and native transactional email/new channels (#18 and channel issues).
These were not relabelled or removed to achieve this testing boundary.

Known limits: local synthetic tests do not establish production runtime clearance,
zero-cost guarantees, live-provider delivery or future-channel accessibility.
Existing frontend bundle-size warnings remain. Earlier unsuccessful rehearsal
attempts are preserved alongside the successful evidence; their history is not
rewritten. One final-source attempt exhausted disk space because completed agent
checkouts retained repeated dependency installations. Those generated dependencies
were reclaimed without deleting source or evidence; the failed run was audited
and cleaned, and a separate complete attempt passed. Future handoffs require
reclaiming completed-worktree dependencies and checking free space before another
isolated rehearsal.

No unresolved blocker remains for the approved local test scope. No further owner
approval is needed to start its documented synthetic fixture. Any later remote
beta, real-customer onboarding, public release or production cutover needs its
separate approved authority.
