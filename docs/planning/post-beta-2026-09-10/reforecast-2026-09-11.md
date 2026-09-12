# Beta.2 remaining-work forecast — 11 September 2026

This supersedes the current forecast, not approved baseline dates or completed acceptance. Evidence revision: accepted main `70b75aba7de8876328691d1c7f80664d34494974` (PR #205). All estimates below are remaining work. They are engineering estimates, not measured token use or percentages.

## Range and confidence

The approved conservative reference model gives **16 December 2026–5 January 2027**, with a central scenario of **28 December 2026**. Confidence is **low**: these are bounded planning scenarios, not a statistical confidence interval. The previous 9 December forecast underpriced the remaining #64 coverage and kept already accepted #70 work in its effort total. The corrected central beta ancestor effort is **813 planning hours**, versus 750–876 across the scenarios.

Two reference workstreams, eight productive hours per day Monday–Saturday, retain 2.5× implementation/validation plus 0.5× shared review/integration. Review capacity remains four hours per day shared between lanes; lanes remain occupied through acceptance. No holiday, provider or owner-response delay is invented. No production/provider wait is required for the authorised local-only beta environment. An external dependency discovered later must be shown separately.

There are three actual workers plus the coordinator. This does not multiply the reference capacity. PR #205's required CI took approximately 25 minutes; that is observed integration latency, not an observed feature-throughput rate. No reliable productive-hour meter is available, so an accelerated calendar promise would currently be unsupported. Reforecast after accepted inbox/queue outcomes establish actual throughput; do not count PRs as effort.

## Remaining outcomes and effort

| Issue | Lower / central / upper raw hours | Evidence and remaining scope |
|---|---:|---|
| #64 | 44 / 60 / 76 | Reuse accepted enforcement and current candidates. Remaining authentication/session and API pre-business accounting: 12–20h; categories/direct reads: 4–8h; CPU/duration/stock/transfer estimates and durable reconciliation: 12–24h; candidate integration: 4–8h; final strict-profile/recovery/resource proof: 12–16h. These are estimates, not authority to broaden the issue or activate providers. |
| #70 | 4 / 6 / 8 | PR #189 accepted typing, private collaboration, acknowledged draft conflicts and durable recipient activity. Remaining #132 preference integration and focused acceptance; add #132 as a genuine completion dependency. |
| #133 | 10 / 13 / 16 | Durable backend activity foundations exist; persistent attention UI, interruption preferences, recovery and accessibility still require acceptance. |
| Other beta prerequisites | Existing remaining estimates | Preserve scoped work and 3× allowance. No speculative reduction for an unaccepted UI branch. |

Original effort values and all historical dates remain in immutable history; #128’s newly evidenced Actual start is 11 September (Project read-back confirmed), changing a remaining estimate is not re-baselining. The machine evidence file records the assumptions and the schedule calculator generates each scenario reproducibly.

## Critical path and visible UI work

Dependency-only central critical path: **#64 → #130 → #128 → #132 → #134 → #140**, 504 planning hours. Shared implementation and review capacity adds delay beyond that chain. #70's preference integration and #133 activity are also completion dependencies; they must not be declared accepted before #132.

A dedicated partial #128 increment is running now: persistent inbox/list and conversation selection, reading/replying using existing APIs, composer, drafts, permissions, SLA and waiting-state presentation. It does not wait to begin until #130 is complete. Its full issue acceptance still waits for real queues/snooze. The issue-level conservative schedule records final integrated delivery and takes no speculative early-work credit; it is not an instruction to leave the UI idle until its forecast start date.

#131 search, #132 focus, #133 activity, #134 context, #135 bulk/table, #71 keyboard, #137 routing, #138 utility actions and #139 performance retain complete acceptance under #140. Full SLA #73, composer #68, permissions #79, themes #66 and drafts #129 are accepted foundations to reuse.

The main uncertainty is remaining resource-accounting and recovery work under #64, followed by the first coherent inbox acceptance and cross-feature accessibility/recovery validation. No owner approval is missing. Final beta.2 remains incomplete; this document does not authorize release, production deployment or paid capacity.
