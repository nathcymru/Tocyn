# Mine and Unassigned queue evidence — 13 September 2026

This partial #130 increment is based on merged Drafts commit
`8b0a30de3bc6b7ce1764c5b63640a52d8547723d`. The coordinator approved the
following finite definitions: Mine is canonical actionable work assigned to the
current operator; Unassigned is canonical actionable work with `assigned_to IS
NULL`. Both require open/pending canonical support state and no active shared
snooze. Neither introduces team-capacity routing or a new ownership projection.

The HTTP boundary requires a current authenticated operator before admission.
The repository binds Mine to verified scope rather than a caller-supplied actor,
retains live group visibility, and applies the same queue and saved-filter
predicate to count and page. Explicit request filters can only narrow results.
Customer/API-key credentials cannot use the new queues. Existing Drafts expiry
and nonqueue route semantics are preserved.

## Native evidence

Synthetic native tests cover own/colleague/unassigned tickets, identical local
IDs in two tenants, hidden and subsequently revoked groups, open/pending versus
resolved/closed state, shared snooze and controlled due resurfacing, current
assignment changes, saved filters, pagination and matching counts. A separate
real HTTP fixture exercises both queues with admission disabled and enabled,
conflicting caller assignment filters, customer/API-key denial and revoked
operator sessions. No fixture credentials are captured in this receipt.

The native query plan probes support state with the tenant/snooze/ticket index;
its exact tenant/ticket equality is bounded by the unique state primary key.
Definitions use their unique tenant/id primary-key index. Scalar ownership adds
no additional lookup or join.

A larger fixture exposed an existing reservation defect. At 10,001 tickets, the
previous group/filter/all-miss path read 40,011 native rows against 39,101
reserved. Mine and Unassigned each read 40,308 against the same allowance. The
regression retains all three failures and tests the corrected envelope.

The coordinator approved an analytical correction rather than a fitted margin:

- Retain two ticket passes; reserve two covering group-membership primary-key
  probes, one each for count and page, giving `4 * ticketRows` when restricted.
- For Actionable, Snoozed, Mine and Unassigned reserve another `8 * ticketRows`:
  two statements, each with a state and definition lookup, conservatively
  charging index plus row for each.
- Preserve the fixed 4096, search and byte margins, existing Drafts addition,
  queue fingerprint, and checked multiplication/addition overflow behavior.

This conservative reservation can reject work earlier under the same configured
budget. No capacity or production gate is increased or weakened. These are local
native measurements and query-plan evidence, not deployed D1 performance claims.

## Dashboard evidence and limits

The real workspace page exposes Mine/Unassigned tabs, authoritative queue request
keys, current-view captions, inclusion labels and factual empty states. Deferred
synthetic responses demonstrate that retained Mine rows do not receive new
Unassigned claims while refreshing. The empty response is shown in list and table
presentations. These tests use JSDOM and synthetic HTTP; they do not prove real
browser layout, keyboard/screen-reader acceptance or the real reply composer.

Remaining #130 acceptance includes Mentions, Needs Action reconciliation,
aggregate counts and full integration/accessibility. #64 and Beta.2 release gates
remain separate. This increment does not complete #130.

Final corrected native run: all six list-admission tests and four queue tests
passed. At 10,001 candidates, the all-miss path read 40,011 within 49,102 reserved;
Mine and Unassigned each read 40,308 within 129,110 reserved. Eleven-candidate
fixtures read 40 within 4,235. Twelve focused dashboard tests and all three
server/dashboard/native-script TypeScript projects passed; diff checks passed.
The specialist native suites remain outside routine PR CI.

Coordinator final review requested all four canonical-key plans. Actionable,
Mine and Unassigned use exact tenant/snooze/ticket equality. Snoozed instead
uses the unique `(tenant_id,ticket_id)` state primary-key index and covering
unique definition index. Assertions for all four pass; no index hint is needed.
