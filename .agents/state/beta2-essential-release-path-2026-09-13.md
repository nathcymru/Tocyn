# Beta.2 essential release path — 13 September 2026

## Authority and scope

The maintainer instructed the coordinator to take the shortest justified path to local Beta.2 testing. This record progresses [#140](https://github.com/nathcymru/Tocyn/issues/140); it does not complete that issue, issue a release, or replace the [approved master package](../../docs/planning/post-beta-2026-09-10/README.md). Evidence reviewed against merged `668b6c99e688e0c1311e7b2f0ba95d89a3481867`. Earlier delivery checkpoints are historical and remain intact.

Prioritize explicit acceptance criteria and material risks. Reuse verified evidence when the relevant behavior is unchanged; rerun only for a changed path, actual failure, unresolved concern or required exact-head gate. Every Critical LAW/COMP/COG row still requires evidence or an explicitly approved residual limitation. This policy does not silently remove dependencies or accepted scope.

## Essential remaining hands-on acceptance

| Journey | Criterion and material risk | Active effort estimate |
| --- | --- | --- |
| One combined VoiceOver/Safari and keyboard core workflow, including work-view/list/conversation/context landmarks, editable controls, assignment/state and reference utility status/focus return | #140/#71/#138: operability, meaningful announcements, no hover-only critical action; accessibility-tree observations alone do not prove spoken output | 30–45 minutes |
| Short task at 200% zoom/browser text scaling, reduced motion and Focus mode | #132: controls remain reachable, nonessential motion stops, critical state/errors remain visible | 15–25 minutes |
| Context and keyboard knowledge insertion while preserving an expendable draft and list state | #134: verified customer context, calm unavailable operational sources and accessible insertion; requires an existing authorized synthetic article | 15–20 minutes |
| Durable Activity unread reload, read/dismiss behavior and bounded connection-loss recovery | #133: actionable information persists and recovery preserves work; reuse the already observed quiet-mode focus/refresh evidence | 15–25 minutes |
| Reconcile exact receipts to remaining critical criteria and record Gate A decision/residuals | #140: check existing collision/uncertain-send, failed draft, authorization-change and concurrency evidence before adding any journey | 15–30 minutes |

Planning envelope: **approximately 90–150 minutes of hands-on acceptance**, assuming healthy existing fixtures and available required data. The individually rounded ranges are not a precise summed schedule. This is **not a release ETA** and excludes VoiceOver environment remediation, discovered defects, dependency implementation and release/runtime blockers. The dependency audit estimates **4–8 focused hours total** for remaining evidence and review, including the overlapping 90–150 minute UI envelope. It excludes discovered defects, VoiceOver remediation and CI wait time. This conditional estimate is not a deadline or guaranteed release time; no completion percentage or forecast date is inferred. See the [maintainer-policy receipt](https://github.com/nathcymru/Tocyn/issues/140#issuecomment-5655000593).

Four blockers remain explicit: actual spoken output is unverified; the Critical traceability matrix audit is active; the minimum #139 performance budget remains unresolved; and the disabled local scheduler residual is **not accepted**. Two controlled native due tests pass, but unattended local wake is absent. Cutting redundant tests does not defer that feature requirement or any other approved scope.

VoiceOver is authorized to be configured, switched on/off or left on for this work; the coordinator owns OS/browser interaction. Record actual spoken announcements only when observed. Exercise a second screen-reader/browser combination where available, recording availability honestly. Do not claim one participant or profile establishes universal usability.

## Evidence to reuse

- [#132 browser receipt](https://github.com/nathcymru/Tocyn/issues/132#issuecomment-5654767497): preference persistence, context defaults/manual toggle, disabled search shortcut, confirmed resolve→advance with heading focus, quiet Activity focus/explicit refresh and preserved draft03.
- [#137 browser receipt](https://github.com/nathcymru/Tocyn/issues/137#issuecomment-5654730304) and [cold audit](https://github.com/nathcymru/Tocyn/issues/137#issuecomment-5654740593): balanced assignment/no-capacity, unavailable-zero explicit override, audited reason/policy metadata, SLA sort persistence and coherent snapshot pagination. Single observed override is not repeated-request replay evidence; retain native concurrency/replay evidence separately.
- [Customer-resurface receipt](https://github.com/nathcymru/Tocyn/issues/140#issuecomment-5654870004): real Safari operator/portal public reply clears snooze; explicit refresh reconciles counts; cold audit proves one canonical customer reply and resurface event. This is not due-time scheduling, live-push, keyboard-only or spoken-AT evidence.
- [#138 keyboard receipt](https://github.com/nathcymru/Tocyn/issues/138#issuecomment-5653285049): reference dialog entry, forward/reverse Tab containment, Escape restoration and visible copy feedback. Spoken output remains separate.

Do not repeat those passing happy paths simply to produce a newer receipt. Preserve the existing candidate and protected draft03; use only authorized synthetic mutations.

## Essential gates versus deferred work

| Retain for justified local B2 acceptance | Defer from the immediate local B2 path |
| --- | --- |
| Required exact-head CI, signing, CodeQL/security checks and substantive findings resolution; zero default Copilot requests | Redundant broad reruns after unchanged passing evidence; repeated happy paths |
| Full #73 SLA clocks/calendars/pause/resume/waiting and #137 ownership/routing hard rules, fairness/fallback and audited override | Exhaustive device/browser combinations beyond the required available AT/browser coverage; cosmetic polish |
| Tenant/current-identity boundaries, safe draft/reply retries, canonical assignment concurrency, truthful queue and capacity state, AI-disabled human workflow | Medium-priority performance tuning or broader benchmarks without a material core-workflow failure; existing required performance evidence remains applicable |
| Due-time resurface and its applicable bounded admission/recovery evidence; reconcile remaining #133 producer evidence | Production deployment/migration clearance, live external providers and infrastructure activation: separate #42/provider gates, not claims of local readiness |
| Every Critical traceability outcome evidenced or explicitly accepted as a residual by the maintainer, with Gate A decision recorded | Future integration breadth and optional polish; approved owning-issue obligations remain open rather than silently removed |

The local beta scheduler guard remains intact. Customer-triggered resurface and isolated functional due tests do not prove scheduled budget admission/recovery. No OS clock changes, scheduler bypass, raised guards, provider activation or billing fallback are authorized by this policy.

## Delivery and resource record

This is a governance-only two-file change. GPT coordinates acceptance and scope; deterministic edits/checks suffice for the small approved policy, so no additional local/cloud drafting or speculative agents are needed. Prior worker proposals are not execution evidence or independent approval. Project progress, baseline/forecast dates and actual dates remain unchanged pending defensible acceptance reconciliation. No complete #140 or B2 issuance claim is made.
