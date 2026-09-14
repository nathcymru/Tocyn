# Beta.2 essential release path — 13 September 2026


## Current execution checkpoint — 21:59 UTC

This checkpoint supersedes the remaining-work statements and conditional estimates below; those sections preserve the earlier approved policy and historical evidence. Current merged target is `1b60e1bb23a5103ecca54de4506e54a56f2f37d4`. The maintainer has added full Ark UI + Panda CSS + Park UI adoption in [#315](https://github.com/nathcymru/Tocyn/issues/315) as a mandatory Beta.2 dependency. This is full application migration, not a prototype. No historical baseline is changed.

Classification: **A** required implementation, **B** blocking defect, **C** missing essential evidence, **D** explicitly deferred/nonessential to this local release.

| Outcome / issue | Exact implementation / current gap | Minimum remaining evidence | Owner / dependency |
| --- | --- | --- | --- |
| A: shared UI and readable workspace #315/#128/#132 | PR313 has signed column head `11eb340c`; tested unpublished layout batch is preserved. Full Panda/Park integration across dashboard, portal, widget and auth remains required. | Shared static-CSS build, token isolation and preserved control contracts; early integrated light/dark visual review; affected behavior and keyboard/zoom/AT checks. | GPT UI lane; coordinator owns shared contract and acceptance. |
| A: bounded bulk work #135 | Column persistence and keyboard reference entry implemented in PR313. Bulk action client and tag backend remain unfinished; tag-only deferral question is pending, therefore full scope remains required. | Selection boundaries, current authority, partial/uncertain results and safe retries; schema/accounting review if tags retained. | GPT backend lane and coordinator; integrate against shared UI contract. |
| C: recovery and unattended due-time #64/#130 | PR314 codec merged at current target; PR309 funded local scheduler merged at `69cfe57d`. Existing candidate is paused following admission refusal. | One preserved-state candidate upgrade, explicit funded recovery, combined previously failed workload and actual UI snooze wake. No reset or top-up. | Coordinator after coherent UI checkpoint. |
| C: Critical acceptance #140 and dependent issues | Existing receipts remain valid where behavior is unchanged. Map all 22 Critical finding obligations and applicable validation journeys; a map entry alone is not a pass. | Close actual evidence gaps, particularly spoken AT, interruption/recovery and affected bulk/UI journeys; concise Gate A decision. | Coordinator; reuse owning-issue evidence. |
| C: #133 producer and #137/#73 completion reconciliation | Durable Activity and assignment/override/SLA receipts exist. Do not infer all routing or producer implementation is missing from old issue text. | Link exact existing native/browser receipts to remaining criteria; implement only evidenced gaps. | Coordinator acceptance reconciliation. |
| D: broader performance / providers / production | PR303 required scoped warm p95 budget is merged. PR293 medium performance remains deferred. Future unavailable providers and #42 production clearance remain separate. | Preserve honest limits; do not claim universal performance or production readiness. | Existing owning issues. |

### One integrated candidate and reusable acceptance matrix

Keep the original beta.1, persistent drafts and budget liabilities. Upgrade frontend/backend together to one merged target at a coherent checkpoint after UI and accounting changes are ready. Stop only the run-owned candidate, back up its full state, rehearse applicable migrations, and compare preserved records before restart. The existing column fixture is an explicitly isolated full-state copy for UI evidence; the UI lane owns its cleanup. Do not create another fixture platform or refresh every PR.

| Scenario | Revision / environment and current result | Evidence / invalidating change |
| --- | --- | --- |
| Relative idempotency storage and accounting | PR314 `06ae9829`, merged `1b60e1bb`; codec16, server964, native1 passed. Preserved copy195 records identical after decode. | #64 receipt and budget-64-relative-idempotency record. Invalidated by codec/accounting/recovery changes; not proof of all UI failures. |
| Global ticket search and existing knowledge insertion | PR312 `b76e11c9` frontend with explicitly disclosed unchanged509 backend; keyboard search/clear/open and draft preservation passed. Earlier PR311 insertion evidence retained. | #131/#140 receipts. Rerun affected focus/layout paths during315; unchanged search algorithm evidence remains reusable. |
| Table columns | PR313 `a6de8060` full-state copy: hide/reorder/save/reload/reference keyboard entry passed; boundary focus defect fixed in signed `11eb340c`, regression passed. | table-columns-135 record; actual focus/browser recheck joins315 integrated checks. |
| Durable Activity | PR304 actual Safari read/dismiss/reload and truthful empty count passed. | #133 receipts; invalidate for changed activity state/interaction paths. |
| Due timer and combined recovery workload | Source309 native/unit evidence passes; main run-owned candidate69cfe57d paused. Actual unattended due-time UI result pending. | Funded recovery then preferences save/reload, knowledge/list/detail/history, protected draft03 continuity, future snooze and natural timer. |
| VoiceOver and zoom | Voice Control and Dictation off; VoiceOver enabled, hardware mic may remain muted. Spoken output unverified. Prior zoom visual evidence is partial. | Required actual integrated operability/announcements remain pending; accessibility trees are not speech evidence. |

### Capacity and forecast

GPT owns consequential architecture, backend and integration; native bounded work supplies mechanical surface inventory. Free cloud last returned a bounded bulk-test proposal, reviewed with incorrect assumptions rejected. Local Granite last refused at3.29GiB available against4GiB required; no guard reduction or repeated unchanged retry. These outputs do not establish acceptance or measured coordinator token savings.

The new full-app315 scope invalidates the earlier acceptance-only90–150 minute and4–8 hour estimates as current release forecasts. The shared foundation is now implemented in this checkout: `packages/ui/panda.config.ts`, generated `packages/ui/styled-system`, static `panda.generated.css`, semantic token aliases, and native wrapper recipe classes. `npm run ui:codegen` and the UI package typecheck/tests pass (21 tests). Application-wide conversion remains incomplete; the 54-file/47-consumer inventory is evidence of surface size, not completion.

Current task-based forecast from this checkpoint: **optimistic 14–24 focused engineering hours; likely 24–40 focused engineering hours**, excluding unavailable GPT agent allowance and any newly discovered behavior defects. This consists of shared integration review (1–2h), dashboard conversion (6–10h), portal/widget/auth conversion (4–8h), full affected checks and visual/AT evidence (3–6h), and candidate upgrade/release reconciliation (2–4h), with overlap where safe. Tool/allowance blocker: both active GPT lanes currently report usage-limit exhaustion; Ollama local remains unavailable under its memory guard and cloud is not being retried unnecessarily. These estimates are planning ranges, not a date promise.

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
