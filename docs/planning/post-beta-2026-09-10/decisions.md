# Reconciliation decisions

Authority: maintainer approvals in this delivery, applied under #126. Full source requirements are adopted; only explicit source exclusions/evaluation boundaries remain excluded/deferred. No capability is discarded because current implementation differs.

| Conflict or discrepancy | Consolidated disposition |
|---|---|
| Three overlapping programmes | One alignment issue #126, one master ledger; capability tracker #141 owns no implementation. |
| Package ADR0016–0019 collisions | Topic-based renumbering to 0016–0028; preserve all original decision clauses and provenance. |
| UX package permits full SLA after GateA | Superseded by owner: full #73 SLA and#137 routing must precede#140/beta.2. |
| Product package says do not change M0–M7 identity/order | Owner permits necessary milestone reorganisation. Preserve historical records; taxonomy is not execution order. |
| Hardening H1 precedes whole UX programme | Superseded: independent workspace/cost/residency foundations progress in parallel; individual controls integrate when needed. |
| Untagged beta checkpoint versus new beta.1 | Owner required formal beta.1 tag/release first at `049ea82`; published 10 September, accepted 9 September. Beta.2 is next candidate. No backdated publication. |
| Old baseline forecasts versus actual beta completion | Preserve original baseline; use observed actuals and recomputed forecasts. Original 16 July 2027 finish describes old scope, not expanded completion. |
| #85 analytics depends on autonomous QA while routing needs current counts | New #162 owns early 8h metric foundation transferred from #85; remaining #85 estimate 16h. Preserve original 24h baseline history and all late QA/channel/handoff analytics acceptance. No duplicate effort. |
| KB02 depends on76/77 while they consume KB02 | #151 PDF/source lifecycle → #152 authoritative retrieval → #76/#77 consumers. |
| UX08 lists74/75 but excludes their connector implementation | Verified current identity and typed slots unblock #134 ; #74/#75 remain required later integration owners. No unverified customer matching. |
| Standalone workspace versus full Web Component delivery | #48/#66 shared primitives/tokens precede workspace ; #67 wrapper packaging does not block standalone acceptance. |
| Runtime observability versus audit/analytics/customer diagnostics | #159 runtime logs/traces/SLO ; #63 mandatory audit ; #85 tenant analytics ; #92 customer-supplied context. No sampling away audit. |
| Cloudflare Access “optional” wording | #158 delivery is required; deployment mode is configurable. JWT/mapping/application authorization is mandatory in Access mode. |
| SFU/RealtimeKit sketches | #142 must establish evidence-backed media boundary before dependent features. No assumed provider activation. |
| #22 closed but receipt says incomplete |Reopen preserving completed work; remaining launch administration stays actionable. |
| Historic beta pending/Resend text |Current guidance corrected to completed local-only capture-mail beta; original decisions remain historical with successor links. |
| Automatic/mandatory Copilot review |Automatic trigger removed; zero default requests. Standing owner PR-only review bypass after required checks, never fabricated approval. |
| Old local worktrees contain uncommitted changes |Preserve; no automatic cherry-pick/reset/cleanup of source. Relaunch from accepted main, not stale branches. |

No feature code, migrations, provider accounts, DNS, remote data or customer traffic changes are part of alignment. Synthetic/source acceptance never falsely closes real provider integration requirements. Unsupported residency claims fail closed; no legal compliance is inferred from location metadata.

## Subsequent owner clarification — shared snooze

Owner clarification (11 September 2026): snooze is shared across operators at ticket/conversation level, with the initiating actor audited. It removes the item from normal actionable queues and resurfaces it when due or on a canonical customer reply. This is accepted direction, not evidence of completed #130 implementation. [Decision receipt](https://github.com/nathcymru/Tocyn/issues/130#issuecomment-5638637521).
