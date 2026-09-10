# Cost policy and admission contract

Issue [#50](https://github.com/nathcymru/Tocyn/issues/50) owns these version-1 contracts. The shared types and server validators are implemented in the repository. Active-path enforcement, durable accounting and runtime demonstrations remain #64/#91; owner/tenant administration remains #90. These contracts do not replace the existing local-beta guardrails or assert production capacity.

## Authority and effective policy

The deployment owner assigns capacity remaining after unrelated account workloads and already accepted obligations. Each tenant receives a separately assigned owner allocation. Server code must load that allocation using authenticated, current tenant membership and separately verified deployment-owner authority. Policy IDs, tenant IDs and schema-valid objects never authenticate a caller. No endpoint may accept a request-provided owner policy as authority.

A tenant restriction names its owner policy and revision, can lower assigned ceilings, disable features, or select Aggressive mode. It cannot add a dimension, increase a limit or undo owner Aggressive mode. Derivation retains tenant identity, restriction revision and disabled features; downstream admission must enforce all three. Unknown feature identifiers cannot enable work. Owner account ceilings must bound the aggregate of all tenant allocations; applying the same account-wide limit independently to every tenant is forbidden.

Conservative is the default. Aggressive is an explicit availability tradeoff: optional AI/background enrichment is off and intake may be tighter. Under Conservative, gratitude classification yields first, then other optional enrichment; deterministic/manual triage continues subject to reserved capacity. Ambiguous replies become ordinary work, never silent suppression. Authentication, authorization, tenant isolation, canonical audit and accepted-message recovery remain mandatory in every mode. Policy changes require current authority and an audit record with actor, scope, before/after and time (#64/#90).

## Units and windows

All amounts are nonnegative safe integers. Neurons use millionths; duration uses milli-GB-seconds. Resource dimensions are independent; CPU milliseconds are not elapsed latency. `ResourceWindow` uses explicit half-open UTC epoch-millisecond intervals or persistent stock ceilings. The dated [resource catalogue](cost-resource-catalogue.md) identifies provider periods. Monthly periods come from the account's actual subscription boundary; never infer them from calendar month alone. Storage does not become empty at a billing reset.

Each policy has one allocation per dimension, with an owner-selected allocation identity. Multiple database/bucket/account ceilings require separate policies and an atomic aggregate owner ceiling; the first implementation must not sum unrelated allocations into a fictitious common pool. Catalogue allowances are reference evidence, not automatically spendable tenant limits.

`partitionBudget` assigns 80% to new work and 20% to recovery by default. Integer rounding remains in recovery. Recovery covers accepted work, reconciliation, required security operations and bounded notifications; it cannot be borrowed for new discretionary intake. An explicit owner-approved split must preserve the obligations already admitted. Lowering a policy does not revoke already accepted recovery obligations or delete customer history.

## Durable grant semantics required of #64/#91

1. Reserve atomically against the owner aggregate and tenant allocation for every dimension/window and purpose. A reservation cannot partially succeed. Its idempotency key is scoped by tenant, holder, policy and purpose; reuse with a different envelope is rejected. Authority assigns globally unique reservation IDs and immutable grant contents.
2. Grants are bounded, versioned, owned by one holder and expire no later than any constituent interval or the maximum grant lifetime. The holder must durably subtract remaining credits before execution. Multiple processes cannot spend the same grant concurrently; process-local caches alone do not prove uniqueness. Warm admission spends preallocated credits without a central quota RPC; a miss replenishes through authority or visibly rejects.
3. Include intake, canonical journal, processing, bounded retries, outbound intent, audit, alerts and accounting overhead before acknowledging. A cached non-exhausted flag is never admission. The reserve response must be backed by committed durable allocation before returning `admitted: true`.
4. Fence both owner policy and tenant restriction revisions. No stale/missing authority permits new discretionary work. Revocation must invalidate new spending, including already cached grants, within the approved authority freshness contract. A lease interval alone cannot establish immediate revocation. Accepted work keeps separately reserved recovery capacity.
5. Reconciliation requires authenticated tenant/holder ownership and durable terminal evidence. Repeated identical evidence is idempotent; conflicting evidence is rejected. Reconcile old-revision accepted work against its original allocation without granting new old-revision work. Unknown/lost/expired credits stay charged until terminal evidence proves them safely reclaimable; expiration is not proof of non-use.
6. At reset, old grants cannot spend in a new interval; unfinished old-window work needs a separately reserved current-window recovery envelope. Stock remains charged until verified release. Releasing unused credits cannot undo actual consumption. Measured overrun is recorded as a capacity defect and blocks further unsafe admission, not clamped away.
7. Rejection precedes durable acknowledgement. API quota responses use 429 and a truthful reset/retry hint when known; adapters implement their own provider retry semantics. Provider retries are finite. Rejecting intake may lose delivery, and a free-tier ceiling or paid plan never guarantees an SLA or zero bill.

`validateSpendableReservation` verifies shape, ownership, revision, state, lifetime, window and individual purpose ceilings for a trusted durable record. It deliberately does **not** prove aggregate allocation, remaining balance, authentication or replay safety. Those require real durable service/handler integration tests in #64, not mocks purporting to prove isolation.

## Usage and representative-flow evidence

`UsageSnapshot` separates measured, estimated, reserved and uncertain values, with observation and authority timestamps. These are disjoint accounting categories: moving an estimate to measured replaces it rather than adding it twice. User-facing views must identify stale evidence and expose only the requesting tenant's allocation; platform credentials and other tenant usage never appear.

For a bounded synthetic message under 64 KB including metadata, a normal Queue lifecycle reserves three Queue operations. Two extra delivery attempts add two reads. This is five Queue operations before any dead-letter write. A full flow also includes bounded Worker invocations/CPU, canonical D1/index writes, R2 body operations, durable-budget bookkeeping and diagnostic events. `sumResourceEnvelopes` composes these estimates with integer-overflow rejection. It does not measure provider consumption.

Before #64 acceptance, measure canonical create/reply, retry, AI-off, storage-pressure and failed-notification flows in the approved isolated environment. Record D1 `meta.rows_read`/`rows_written` including index cost, R2 operations and size, Queue attempts, DO duration/storage, Worker CPU, and telemetry/reconciliation overhead. Unknown advance costs require enforceable workload caps plus conservative estimates. Record warm/cold latency separately. No remote measurements or live messages were performed for #50.

Diagnostic telemetry may be sampled under #159's explicit retention policy. Canonical business/security audit must not be sampled away. Sampling reduces diagnostic visibility and must be surfaced. Threshold alerts are deduplicated and reserve their own delivery/retry envelope; dashboard state alone is not an independent notification channel. No automatic overages, upgrades or paid activation are permitted.

## Reproducible contract verification

Run the server cost-policy test file and server typecheck. Tests cover lower-only restrictions, tenant/revision mismatch, feature-disable preservation, malformed/overflow values, purpose reserves, old-window/future/expired/uncertain grants, duplicate dimensions and monotonic AI shedding. Synthetic policies use two distinct tenant/holder identities. These are pure contract tests; they do not claim live endpoint authorization or concurrent durable implementation.

The required integration gate for #64 adds concurrent unique-holder spending, duplicate/conflicting reconciliation, policy/restriction changes, lease loss, daily/subscription reset races, unavailable authority, accepted-message recovery and existing authentication regressions. #90 adds authorized administration and accessible usage views. No UI, migration, binding, provider or active admission path changes are introduced by this contract increment.
