# #64 API whole-grant recovery acceptance checkpoint

Date: 11 September 2026. Owner: recovery acceptance worker; root owns GitHub/PR integration and acceptance. Branch: `codex/64-grant-recovery`. Scope: API canonical ticket grant closure only. Current approved issue scope was read from the coordinator's current cached #64 record. All broader #64 acceptance remains open.

## Implemented increment

Migration `0040_budget_grant_closures.sql` adds canonical operation links and whole-grant closure evidence. It remains distinct from accepted `0038_operator_activity.sql`. A later API admission may synchronously seal an idle grant only when every admitted attempt is settled. A receipt alone cannot release the grant. The canonical D1 batch fences all operation links against closure, including stale requests. Closure matches every local operation ID, fingerprint and envelope to bounded durable rows before reconciliation.

Recovery binds the sealed grant to the authenticated tenant/API credential, original exact authority snapshot, aggregate/namespace, policy/restriction and grant expiry. Two prepaid attempts share one recovery-purpose reservation. Cold allocation control and every assigned operation envelope remain uncertain/charged; only the provably unused remainder of a sealed grant is reusable. The recovery envelope remains fully charged: 2 Worker requests, 4,096 D1 rows read, 64 D1 rows written, 6 DO requests, 12 DO rows read, 12 DO rows written and 6 diagnostic events. These are conservative allowances, not provider billing measurements.

Fixes in `6f62cb1` bind tenant/credential/source authority, reject malformed/inconsistent closure shapes, make identical concurrent closure inserts idempotent, and count each concurrent canonical attempt separately with once-only settlement. The native same-operation regression demonstrated that one completed duplicate must not hide another running attempt. `89fafd7` preserves interval renewal: expired grants never close/refund here, and later admission must obtain fresh charged capacity through existing policy/refill checks. Accepted main `f2e8ede` was merged at `fbd7117`; only the runtime-control response required conflict resolution, retaining both canonical and reservation pause controls.

## Acceptance map

All named tests are in `apps/server/scripts/budget-admission-runtime.test.ts`, executed through native Miniflare D1/DO with synthetic principals and no providers.

| Required proof | Evidence |
| --- | --- |
| One grant funds two operations; neither receipt individually reconciles | `idle API closure reconciles the entire two-operation grant`: zero early reconciliation RPCs, exactly two original links, one automatic whole-grant reconciliation, exact cold-plus-operation retained accounting, twelve unused Worker-request units released, later work on a fresh charged grant. |
| In-flight operations prevent sealing | `native admitted in-flight operation...` and `native concurrent same-operation attempt...` deliberately pause native canonical batches; neither distinct-operation nor duplicate-attempt overlap permits closure. |
| Stale/new canonical work after durable closure rolls back atomically | `native D1 closure rolls back a stale admitted canonical batch...`: ticket, article, attachment, conversation/SLA event, receipt and operation-link counts remain unchanged; failed retry/new write remain denied; existing receipt replay stays safe. |
| Exact-set/identity/shape validation | `native closure strictly rejects...` covers inconsistent IDs, duplicate/too-many operations, empty/unknown/unsafe envelopes. Exact fingerprint/reservation mismatch, conflicting terminal evidence and conflicting coordinator accounting retain charges. Identical parallel closure payloads agree. |
| Two tenants under one owner | `native recovery rejects another tenant sealed grant...`: tenant A's authority cannot recover B, neither tenant's grants change, B's own authority succeeds and A's accounting remains unchanged. Existing colliding-key/cross-tenant route denial remains in the complete suite. |
| Current authority/revocation/expiry | Nine `native whole-grant recovery retains charges after...` cases cover key, permission, deployment authority, exact policy source, restriction source, namespace, aggregate, expiry and credential changes. Existing create/reply canonical fence tests now count operation links as well as business writes. |
| Uncertainty and loss | Existing unknown canonical, cache discard, grant expiry, lost reservation/reconciliation response and policy renewal scenarios retain original charges. Failed recovery at expiry does not prevent a new explicitly charged interval admission. |
| Recovery partition and finite retries | `native exhausted recovery partition...`, `native parallel closure retries...`, and lost-reconciliation tests prove no borrowing, at most two attempts, one recovery reservation, all overhead retained, and no completed automatic recovery RPC replay. |
| Indexed and bounded work | Native `EXPLAIN QUERY PLAN` uses the composite operation index, no full scan/temp sort, and reads at most eight rows for a valid maximum-sized grant. A ninth-row sentinel rejects surplus evidence. Existing 64-scope, eight-operation, four-refill, two-attempt and bounded authority/lifecycle tests remain enabled. |

## Check observations and handoff

The first observed complete runtime run at `fbd7117` exited 1: 77/82 passed. Four old call-shape assertions omitted `reconcile: 0`; the fifth exposed the expired-grant renewal problem. All scenarios remain present. The seven focused renewal/accounting checks passed after correction. Earlier strict-shape/two-tenant and concurrency failures were preserved in local logs and passed after fixes. Final check results are recorded below after their actual processes complete.

Local evidence logs are under `/private/tmp/tocyn-64-recovery-*.log`; they are ephemeral evidence locations, not repository assets or external publication. The root must rerun applicable integration/CI checks after merging the independently owned customer/precondition paths. No GitHub mutation, push, Copilot request, GUI, remote migration, provider activation, release, paid capacity, owner checkout change or owner service-port change was performed by this worker.

## Remaining acceptance and explicit limits

- This closes neither #64 nor beta.2. API closure evidence is not staff/customer grant recovery, outbound/provider terminal evidence, AI/storage/realtime/job admission or a whole-operation resource proof.
- `maxReservations` still counts reconciled reservations. This increment releases provably unused resource units; it does not reclaim reservation slots or delete historical/uncertain grants. Safe durable slot/history compaction remains required for sustained operation.
- There is no periodic discovery or restart reconstruction. Untriggered, lost, unknown or expired grants remain charged. Stock is never reset merely because an interval rolls over.
- Two recovery attempts are bounded by the live cache capability. The server-only recovery composer is called by that gate; it is not a public retry API or independent scheduler.
- Recovery charges are conservative estimates. No provider completion/billing, production migration, deployment, staging-runtime or multi-tenant release clearance is claimed.
- Root retains issue/Project synchronization ownership. This local checkpoint supplies acceptance evidence without changing baseline dates, claiming arbitrary progress, or treating a local commit as accepted integration.

### Final observed checks

Application/test revision: `89fafd723f578d17574a6c331b7ce94e38109e44`, including accepted main through `f2e8ede`.

- `npm run test:budget-admission-runtime` from `apps/server`: exit 0, 82/82 native API and session tests, zero failures/cancellations/skips, 91.7 seconds. Output: `/private/tmp/tocyn-64-recovery-full-runtime.log`; actual process handle 41288 completed with exit 0.
- `npm exec -- tsc -p scripts/tsconfig.budget-runtime.json` from `apps/server`: exit 0. Output: `/private/tmp/tocyn-64-recovery-typecheck.log`; handle 81970 completed with exit 0.
- Scoped ESLint from `apps/server` over changed recovery/cache/fence/canonical-service/runtime files: exit 0. Output: `/private/tmp/tocyn-64-recovery-eslint.log`; handle 64781 completed with exit 0. Only the existing module-type configuration warning appeared.
- `git diff --check`: exit 0. No application dependency was changed or installed for this worker; dependency/provider audits are not claimed by these checks.
- Native canonical metadata with 100-receipt cleanup: API create 12 statements, 425 rows read, 130 rows written; reply 14/429/122, within the retained canonical envelope. Closure maximum lookup independently asserts eight rows read and an indexed ninth-row sentinel.

Reproduction: use existing installed dependencies and run those commands locally on the application revision above. The final checkpoint commit changes this record only. Root's next action is to integrate this API-only closure branch with the independently owned customer and #70 precondition work, preserve each canonical actor fence, run final exact-revision integration/CI, and synchronize the #64 partial-delivery receipt and Project state. No approval bypass or publication is performed by this worker.
