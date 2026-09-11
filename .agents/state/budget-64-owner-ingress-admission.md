# #64 owner ingress admission increment

Draft PR #216 on branch `codex/64-owner-ingress-admission` owns the private owner ingress ledger, HTTP request-entry composition, migration `0063`, focused native proof, and the combined-mode inbound-email readiness guard. It does not own tenant or owner ceilings, the approved 80/20 purpose split, deployment configuration, dashboard business sections, knowledge/channel migrations, or full #64 acceptance.

## Bounded contract

`OWNER_INGRESS_ADMISSION_POLICY=owner-ingress-v1` enables the boundary. Unset or `off` preserves current request behavior; any other value fails closed with 503. The switch is deliberately separate from the existing business policy so merging this increment does not silently activate an unfinished #64 release profile. The final strict profile must enable it and demonstrate complete route coverage before #64 can be accepted.

Before downstream HTTP work, the boundary accepts exactly one indexed active deployment/current owner-policy candidate and loads its full sentinel-bounded tenant allocation snapshot. Migration `0063_owner_ingress_authority_indexes.sql` bounds the deployment and policy candidates. One execution reserves `workerRequests:1`, `d1RowsRead:1536`, eight DO requests/reads/writes, and `logEvents:67`. The eight-DO envelope covers two possible refresh/reserve deliveries, two possible atomic tenant-handoff deliveries, and two possible terminal owner closures. Up to three unresolved pre-admission executions are retained and prepaid by the next success; further work for that binding and purpose fails closed until isolate replacement.

Owner ingress uses the existing allocation IDs, windows, limits, 80/20 purpose partitions, reservation slots, authority lease, and capacity-defect behavior. MFA/logout/customer verification routes select recovery; ordinary intake selects new work. Exhaustion returns the existing 429 plus an interval reset hint when known. Missing, malformed, stale, or ambiguous authority returns 503. No request value selects an owner, allocation, or tenant ledger.

After a current credential and tenant allocation are verified, one Durable Object transition closes the exact owner ingress reservation to zero and records the complete ingress envelope as a certified, compacted charge in that tenant ledger. The transition commits once or not at all. It preserves total owner charge, applies the tenant limit, and cannot briefly release or double-reserve owner capacity. A lost response retries the same immutable transfer once; exact replay returns `already-handed-off`. The downstream business holder remains warm and unchanged. Its Worker dimension is reduced by the one invocation already charged through ingress, while downstream D1, DO, R2, and business work remains in the existing tenant grant.

If current credentials reject, no tenant is debited and terminal closure retains the full charge in owner ingress. If both transfer acknowledgements are lost, the request cannot proceed and the transferred or owner charge remains unavailable. Acknowledged transfer makes request finish a local closed result; it does not issue a second refund write.

Combined business mode rejects inbound email before legacy raw MIME/provider work until #51/#91 supplies its complete admission path. Off-policy email behavior remains compatible. Scheduled, workflow, queue, and provider/CPU/duration units absent from the approved catalogue remain release-gate gaps. Enabling the ingress switch does not establish full #64 coverage by itself.

## Local synthetic evidence

Node 22 checks completed against the existing dependency overlay:

- server source typecheck passed;
- dedicated native-runtime typecheck passed;
- scoped server ESLint passed;
- owner aggregate/isolate/policy unit suite: 43/43;
- existing budget admission native runtime: 89/89;
- coordinator/authority native runtime: 5/5;
- dedicated owner-ingress native runtime: 4/4.

The dedicated native suite covers an enabled explicit switch, current signed staff principal, twelve exact tenant handoffs, no client-selected tenant debit, no duplicate Worker charge, post-admission session revocation, owner-only and recovery accounting, unset/off/invalid/missing/ambiguous authority, 429 reset hint, indexed plan and positive D1 read metadata below 1,536 rows, lost reserve and owner-closure acknowledgements, lost atomic handoff acknowledgement with exact replay, bounded failed bootstrap, and combined-mode email rejection.

All runtime evidence uses local synthetic D1 and Durable Objects. No provider call, remote deployment, customer data, Copilot review, configuration activation, merge, issue closure, or full #64 acceptance is claimed.
