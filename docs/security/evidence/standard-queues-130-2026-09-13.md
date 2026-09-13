# Standard queues and aggregate counts — 13 September 2026

This partial #130 increment starts from signed merged main
`434e58d6a08e9ecfb5bc4e64a3a78ff93b24beac`. Coordinator-approved semantics:
Mentions is canonical actionable work with at least one mention for the current
operator that has not been explicitly dismissed. Reading a mention does not
complete work. Shared snooze excludes it until canonical resurfacing. Multiple
mentions of one ticket produce one ticket/count; activity facts are not queried
or returned. Migration 0072 adds a partial `(tenant_id,recipient_user_id,ticket_id)`
index for undismissed mentions, leaving reserved 0069–0071 untouched.

The display name Needs Action uses the existing `actionable` predicate and URL/API
key. All tickets retains its existing unclassified list. Standard counts cover
All, Needs Action, Mine, Unassigned, Mentions, Drafts and Snoozed before search or
custom filters. The UI states this scope; the current list's filtered metadata
remains separate. Count failures/pending refreshes do not display invented zeroes,
and a retry control refetches authoritative counts. Successful dismissal
invalidates ticket and count queries; marking activity read preserves membership.

## Aggregate authority and cost

`GET /api/tickets/queue-counts` requires the current authenticated operator before
admission. The native aggregate first materializes tenant-visible ticket IDs and
assignees, then materializes four classification flags once: actionable, snoozed,
own draft and own undismissed mention. Aggregate expressions reuse those stored
flags for ownership/mention totals. All values are from one D1 batch snapshot;
there is no client sum of independently timed pages. Existing live group checks,
current credential and counter-growth fences remain in the statement authority.
Draft expiry uses the same local-beta-only policy and one captured server cutoff.

The configured metered path retains the spent commit authority, bound to operation,
request fingerprint, credential, counter snapshot and draft cutoff. The same D1
batch asserts current authority, records the exact durable grant operation and
executes the aggregate. Settlement reports committed only after success; failure
settles unknown. The pre-existing ticket-list authority gap remains outside this
increment and under #64; this new aggregate does not inherit that gap.

The coordinator-approved conservative aggregate reservation is:

- 4096 fixed reads plus 512 for commit/ledger overhead;
- 2 reads per ticket for source index/row, plus 2 for an agent's group lookup;
- 8 per ticket for two canonical state/definition predicates (index plus row);
- 2 each for Drafts and Mentions existence probes;
- 2 per ticket for consumption of the materialized visible rows and flags;
- existing doubled-ticket-byte margin; 16 durable writes for the fenced ledger.

Thus variable reads are 18N for agents or 16N for admins, plus fixed and byte
margins. Mentions list/count independently adds 4N membership reads alongside
existing canonical-state costs. Checked arithmetic and configured capacity gates
are preserved. More conservative admission can reject earlier under unchanged
budgets. The existence probe terminates on its first indexed matching entry;
activity history size is not scanned to determine membership.

## Native and UI evidence

Native query-plan assertions show `MATERIALIZE queue_flags` once, one scan of the
stored flags, two state probes and one probe each for drafts and mentions. The
mention probe uses the new partial ticket index. Five candidate tickets used 37
rows in the classification SELECT, with no durable SELECT writes. A real metered
HTTP aggregate executed 21 read rows and 5 durable writes in its fenced batch,
within 4627 reads/16 writes reserved for that fixture. The operation ledger grew
by exactly one; revocation after admission but before the batch returned 503 and
created no phantom completed operation.

Fixtures reconcile aggregate totals with all finite list predicates, tenant/actor
and live-group visibility, resolved/snoozed exclusions, duplicate/read/dismissed
mentions, other-recipient history, local draft policy and counter growth. The
history fixture adds 512 dismissed or other-recipient mentions. Customer/API-key
requests cannot obtain either counts or Mentions through these operator routes.

Dashboard evidence uses real page/hooks plus synthetic HTTP in JSDOM. It verifies
Needs Action route compatibility, Mentions navigation/inclusion, standard versus
filtered totals, count failure/retry and dismiss invalidation without read removal.
It does not establish real browser layout, spoken screen-reader acceptance or
production deployment. Full #130 integration/accessibility and #64/Beta.2 gates
remain separate; no issue completion is claimed.

Final validation: 12 native admission/queue/count tests passed. The 10,001-ticket
aggregate measured 80,012 native read rows against 189,627 reserved. A final
focused count run also proved old drafts remain without an explicit local cutoff
and are excluded under that policy. Thirty focused dashboard tests and all three
TypeScript projects passed. Specialist native suites remain outside routine CI.
