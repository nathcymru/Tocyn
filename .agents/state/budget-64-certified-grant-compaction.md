# #64 certified grant compaction checkpoint

Date: 11 September 2026. Scope: the API whole-grant recovery follow-on only. This is a local branch receipt for `codex/64-certified-compaction`; root owns integration, PR, issue and Project updates. It does not complete #64 or beta.2.

## Retained accounting with bounded state

Only a whole API grant accepted by the existing `0040_budget_grant_closures` proof may compact. The recovery service first rechecks current API authority and its exact sealed snapshot, reserves the existing recovery-purpose envelope, and writes or re-reads the exact bounded closure. It then passes that durable certification to the coordinator. A generic reconciliation does not compact and a missing grant without certification is rejected.

The coordinator removes only that certified reconciled grant detail. Its observed measured-plus-uncertain charge is accumulated by allocation/window/dimension/purpose in `closedCharges`; every live grant and every uncertain, consumed, or capacity-defect grant remains detailed and charged. The owner aggregate includes those rollups when it admits another tenant. A released reservation slot therefore cannot reset a stock balance or an interval charge.

`budget_grant_closures` records the sealed grant expiry and has a tenant/expiry index. Expired closure proof and its at-most-eight operation links are deleted in batches of two only after the existing grant-expiry horizon, when recovery already rejects the sealed capability. This is not a new journal and it never deletes uncertain evidence. A later successful recovery uses its already reserved envelope to perform one bounded cleanup batch; no timer, provider, or unbudgeted background work is introduced. The coordinator retains only current interval rollups and fixed stock keys; obsolete allocation metadata is removed once no live grant references it.

## Local proof

- `coordinator-state.test.ts` proves certified whole-grant compaction frees a one-slot coordinator while retaining the exact allocation charge; uncertified missing-grant retries remain rejected and certified lost-response retries return `already-reconciled`.
- `owner-aggregate.test.ts` proves the retained tenant charge constrains a later tenant while the released slot admits it.
- `budget-admission-runtime.test.ts` proves the durable 0040 proof, original expiry, lost coordinator response, idle two-operation closure and expired D1-proof cleanup using local Miniflare D1/DO fixtures. The cleanup case confirms the D1 rows disappear only after expiry while `closedCharges` remains, and expiry cannot authorize recovery.

## Limits still open

This increment preserves the API recovery boundary; it does not add customer/staff closure recovery, provider completion proof, a scheduler, production migration, deployment clearance, or full #64 active-path resource coverage. The expiry cleanup is opportunistic on a later successful API recovery, so an idle tenant may retain expired closure rows until that bounded path runs; those rows cannot authorize recovery and do not reset coordinator accounting. Root must validate the final integrated revision and retain the wider #64 acceptance map.
