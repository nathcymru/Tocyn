# #129 durable operator state

In progress, Actual start 2026-09-10. Prerequisites #127/#60/#63/#79 closed. Dedicated worktree `/private/tmp/tocyn-beta2-129`, branch `codex/129-durable-drafts`, based on accepted `9cee350`; root owns integration and GitHub.

Native `auth_sli_159` continues with its existing Terra/high configuration for tenant/concurrency boundaries. No model switch, separate allowance, recursive delegation, Copilot review or paid resource. UI #48 is independent in another worktree.

Server vertical: migration0029, operator-scoped draft/state repository/service/router, current dashboard middleware, validated existing attachment references, conditional versions and preserved canonical base sequence. Contract: `docs/workspace/operator-draft-contract.md`.

Coordinator review found and required fixes for state updates blocked by INSERT predicate, delete/recreate ABA, autosave masking original conversation sequence, unbounded selection retries/stale revision return, cleanup scope/bounds and malformed/oversized request handling. Worker returned corresponding real local Miniflare/repository tests. Final review also found stale PUT after deletion could recreate a row; creation-versus-update guard and negative cleanup-limit validation are being completed. Do not repeat or hide these failed approaches.

Owner question on retention duration is pending. No default expiry or remote cleanup activated. All dashboard restore/autosave/indicator/send integration remains required; no issue completion, arbitrary progress or forecast change. Original baselines immutable. Project status/Actual start updated; start receipt on #129 records the bounded scope.

Next: inspect final corrections, run affected subsystem checks, push a coherent draft PR for this partial vertical, then complete the remaining issue through that PR/branch. Do not claim #130 predicates or #128 workspace are implemented by preference enum values. #128 still requires #129/#130/#48/#66; #130 requires #129/#136/#73/#64.

Final server review corrections completed: generation+revision protects delete/recreate, stale PUT cannot recreate an absent draft, state CAS supports updates, original canonical base remains fixed across autosaves, selection cleanup returns its actual revision with bounded retry, actor/system cleanup scopes and1..100limit validation are explicit. Safe streaming JSON parser covers400/413. Root added private,no-store workspace responses and a real fixture assertion.

Validation: root full server514tests/58files passed; final real two-tenant Miniflare4tests passed after no-store correction. Worker servertypes, focused repository30tests and ESLint passed; only existing module-type warning. No remote resources. Coherent partial draft PR follows; #129 remains open and implementation pending for UI/retention acceptance. Coordinator's previous goal turns are progress, not blocked waits.
