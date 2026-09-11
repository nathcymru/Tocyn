# #64 owner ingress admission increment

Draft PR #216 on branch `codex/64-owner-ingress-admission` owns the private owner ingress ledger, HTTP request-entry composition, migration `0063`, focused native proof, and the combined-mode inbound-email readiness guard. It does not own tenant or owner ceilings, the approved 80/20 purpose split, deployment configuration, dashboard business sections, knowledge/channel migrations, or full #64 acceptance.

## Bounded contract

`OWNER_INGRESS_ADMISSION_POLICY=owner-ingress-v1` enables the boundary. Unset or `off` preserves current request behavior; any other value fails closed with 503. The switch is deliberately separate from the existing business policy so merging this increment does not silently activate an unfinished #64 release profile. The final strict profile must enable it and demonstrate complete route coverage before #64 can be accepted.

Before downstream HTTP work, the boundary accepts exactly one indexed active deployment/current owner-policy candidate and loads its full sentinel-bounded tenant allocation snapshot. Migration `0063_owner_ingress_authority_indexes.sql` bounds the deployment and policy candidates. A serialized cold acquisition reserves one block of eight executions. Each execution prepays `workerRequests:1`, `d1RowsRead:1536`, eight DO requests/reads/writes, and `logEvents:67`; the deliberately conservative DO units also cover the bounded block settlement. Thirty-two concurrent requests share one pending discovery/reservation rather than entering D1/DO independently. Up to three failed acquisition waves are retained and prepaid by the next success; later work for that binding and purpose fails closed until isolate replacement.

Owner ingress uses the existing allocation IDs, windows, limits, 80/20 purpose partitions, reservation slots, authority lease, and capacity-defect behavior. MFA/logout/customer verification routes select recovery; ordinary intake selects new work. Exhaustion returns the existing 429 plus an interval reset hint when known. Missing, malformed, stale, or ambiguous authority returns 503. No request value selects an owner, allocation, or tenant ledger.

Warm executions perform no owner quota RPC. The downstream business grant omits the Worker invocation already held by owner ingress and writes its exact operation identity to `budget_grant_operations` in the canonical D1 batch. After eight requests finish, at most eight indexed proof reads select exact tenant/reservation/holder/operation/fingerprint/envelope rows. One Durable Object transition closes the owner block and records one ingress envelope for each proven operation in its verified tenant ledger. Missing, late, wrong-tenant, or mismatched proof remains in the owner charge. The transition commits once or not at all, preserves total owner charge, applies tenant limits, and cannot briefly release or double-reserve capacity. A lost response retries the same SHA-256-bound block certificate once.

If current credentials reject, no tenant is debited and the block retains that execution in owner ingress. Partial blocks and uncertain settlement stay conservatively charged. No fixed refill count was added: valid sustained traffic may acquire later blocks while the existing owner window, authority lease, reservation and metadata limits permit it.

Combined business mode rejects inbound email before legacy raw MIME/provider work until #51/#91 supplies its complete admission path. Off-policy email behavior remains compatible. `workerCpuMs`, `doDurationMilliGbSeconds`, and `doStorageBytes` are #50 resource dimensions, but this ingress envelope still lacks verified/estimated units for them. Scheduled, workflow, queue and provider billing also remain release-gate gaps. Enabling the ingress switch does not establish full #64 coverage by itself.

## Local synthetic evidence

Node 22 checks completed against the existing dependency overlay:

- server source typecheck passed;
- dedicated native-runtime typecheck passed;
- scoped server ESLint passed;
- owner aggregate/isolate/policy unit suite: 43/43;
- existing budget admission native runtime: 89/89;
- coordinator/authority native runtime: 5/5;
- dedicated owner-ingress native runtime: 5/5.

The dedicated native suite covers an enabled explicit switch, current signed staff principal, two complete eight-execution blocks, exact durable operation proof, no client-selected tenant debit, no duplicate Worker charge, post-admission session revocation, conservative owner-only and recovery blocks, unset/off/invalid/missing/ambiguous authority, 429 reset hint, indexed plan and positive D1 read metadata below 1,536 rows, lost reserve and block-settlement acknowledgements, and 32-way concurrent failed discovery with the three-wave latch.

All runtime evidence uses local synthetic D1 and Durable Objects. No provider call, remote deployment, customer data, Copilot review, configuration activation, merge, issue closure, or full #64 acceptance is claimed.
