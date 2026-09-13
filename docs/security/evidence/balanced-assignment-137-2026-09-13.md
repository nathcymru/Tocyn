# Explicit balanced assignment: partial evidence, 13 September 2026

Progresses #137. The issue remains open at its existing 15% acceptance estimate. This backend slice is based on merged `a41f12a99d97ed2b72938e906b07df6e56f33044`; UI acceptance and release clearance remain separate. No remote database or provider was used.

## Contract

An explicitly authorized staff action selects one unassigned actionable ticket. It uses the existing responsible-owner current staff/session/group authority; no new capability or permission bypass is introduced. Recipients must be current staff in the ticket's tenant/group and have configured available capacity. Current work includes open and pending tickets, including snoozed and waiting work, across the tenant. Ranking is least current work, then least-recent successful balanced assignment sequence, then stable ID. Assignment, live ranking/eligibility, capacity, owner, policy and tenant sequence are fenced in one D1 transaction with canonical internal audit/activity and a durable receipt.

The first slice bounds the tenant-wide configured-available pool to 64 plus a sentinel before joining users/groups. An oversized pool, or unsupported stored candidate identifier, produces routing-unavailable; it never samples a subset or reports no capacity. Zero, full, unavailable and absent capacity policies are ineligible. No eligible candidate produces a durable internal no-capacity receipt without changing ownership. Replays preserve the original result, not a claim about current ownership. A new explicit action requires a new key. No override is implicit.

The service retains the exact admitted authority and acknowledged outcome privately. Only route completion after headers and JSON Response construction calls `finish(result)`; exceptions, foreign outcomes and uncertain commits finish unknown. Settlement is exact once. A lost commit response can be acknowledged only after durable receipt recovery; neither the route nor a caller-supplied lookalike outcome creates proof.

## Resource argument

`BALANCED_ASSIGNMENT_DECISION_SQL` materializes the policy pool, eligible candidates and winner. Native EXPLAIN confirms the `(tenant_id,availability,user_id)` policy index and covering `(tenant_id,assigned_to,status,id)` workload index. Workload probes stop at 1,001 rows; candidate filtering does not change the whole-pool limit. Each HTTP attempt has a fresh funded operation identity; its receipt key provides business replay safety.

The proposed action envelope reserves 150,000 reads and 2,048 writes. Two ranking evaluations each visit at most 64 × 1,001 covering workload entries. A conservative 32 additional index/row/materialization visits per candidate plus 256 fixed visits per evaluation, and 8,192 existing credential/grant/canonical/replay/cleanup visits, total 140,928 reads. This is an analytical allowance, not a fitted maximum. The write reservation covers the existing conservative 976-slot canonical attempt allowance, at most 100 receipt deletions × four row/index slots, and 160 slots for the additional cursor, receipt, activity and repeated assertion/grant operations: 1,536 slots, below 2,048. Read/write admission may refuse work conservatively; limits are not weakened.

The new 64-KiB stock reservation covers conservative logical encoded row/key payload and record-header padding:

| New/growing storage | Bytes |
| --- | ---: |
| Receipt row and three indexes | 6,144 |
| Tenant sequence row and primary key | 2,304 |
| Operator sequence row and primary key | 2,560 |
| Canonical event row and seven indexes | 14,848 |
| Internal system note and five indexes | 9,728 |
| Assignment activity and six indexes (including conservative partial-index allowance) | 11,264 |
| Grant-operation journal and primary key | 12,288 |
| Assertion row and primary key | 4,096 |
| Positive ticket owner growth in row and two owner-bearing indexes | 1,024 |
| **Total** | **64,256** |

Assumptions are explicit: request actor/ticket IDs and every available-pool candidate ID are bounded to 128 ASCII characters; ticket group is at most 128 UTF-8 bytes; tenant is at most 256 characters (at most 1,024 UTF-8 bytes), with the existing grant identity fence stricter where applicable. Generated IDs/messages are fixed-size. The grant helper restricts link identities to 160 characters and this repository rejects serialized operation envelopes over 2,048 bytes before canonical work. Existing names, subjects, custom fields and whole-ticket snapshots are not copied. Event before/after group fields include conservative JSON escaping allowance. No identity/security value is truncated.

This is not a physical D1 page/billing guarantee. Temporary storage, sort space, fragmentation, provider measurement, migration rehearsal and deployment stock headroom remain release prerequisites. Migration 0075 adds an index over existing capacity rows: deployment must inventory that population and reserve index backfill/temporary space before application. This slice does not clear inherited stock-admission gaps for other mutation routes. The additional capacity index contributes one bounded row/key entry per configuration, within the existing two-KiB configuration logical allowance and 32-write cap; no general stock-clearance claim follows.

## Executed synthetic evidence

Node 22.19.0 / native Miniflare D1 with all migrations and the real budget coordinator was used. The final mounted suite passed 14/14 on the integrated base. Native/server TypeScript and focused production lint checks passed. The ordinary server suite passed 85 files / 798 tests, including two Response-completion cases.

The maximum workload case used 64 policies and 64,064 open/pending tickets, plus a foreign-tenant available operator: 129,915 repository-batch reads and 16 writes, within the reservation. This measurement excludes fixture setup and separately performed admission/session reads; it is not total provider billing. EXPLAIN and analytical margins provide the bounded-path argument.

Tests cover least load/sequence/ID, unavailable/absent/zero/full exclusion, replay without duplicate canonical event/activity, concurrent final-slot assignment, manual assignment winning the same slot, intervening policy/group/session changes, same-ID cross-tenant separation, snoozed target rejection, whole-pool overflow, unsupported IDs, and exact authority/outcome settlement. Native schema inventory checks all row/index counts used above; oversized synthetic names, subject and custom fields do not appear in the new receipt/event facts.

Retention uses one indexed, gated receipt redaction per finalization step. A 130-receipt own-tenant fixture with 129 same-ticket-ID foreign receipts completed in 132 steps; each complete claim/admit/finalize/continue turn used at most 41 reads and 11 writes, below the existing 128-write cap. Gone receipts explicitly have null outcome/owner/ticket and zero sequence; they never rewrite assignment history as no-capacity. Foreign receipts remain intact. A same-key replay after synthetic ticket-ID recreation returns gone, and final ticket deletion has no growing receipt cascade.

## Remaining acceptance

The POST handler is mounted behind the same dashboard authentication, MFA, staff-role and tenant middleware as responsible-owner, with requestBounds(1024). Native HTTP evidence passes missing authentication/key, extra/oversized body, success, no capacity, replay and revoked session. Two focused route tests prove Response-before-finish ordering and unknown settlement when success Response construction fails. Action UI, complete keyboard/assistive-technology validation, full #137 acceptance and accepted B2 release remain outstanding. SLA queue priority ordering is not implemented by this action and is owned separately. No unattended routing, presence-derived availability, lease algorithm or historical productivity score is claimed. Automatic routing and production migration/runtime gates remain open.

Coordinator browser receipt (private port58638): keyboard Tab from Security Profile through Sign Out to Current Work, Enter opened the dialog focused on Close current work. Loading transitioned to the explicit retryable load error. Escape closed the dialog and returned focus to Account options. This proves opening/closing/focus and truthful error presentation only; actual capacity data and administrator form acceptance remain blocked by admission-state pressure. No save was performed.
