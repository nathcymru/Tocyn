# Attributable conversation events

Tocyn records tenant-scoped intake, reply, assignment and state events alongside
the corresponding conversation mutation. The event table records
these facts; it is not an alternate ticket store, a provider-delivery journal, or analytics.
No audit UI or provider capability is added.

## What is recorded

| Event | Facts | Mutation actor |
| --- | --- | --- |
| `ticket.intake` | Initial status, priority, assignee/group IDs and optional initial article reference | Resolved API key, authenticated portal/widget customer, or MFA-authenticated dashboard staff |
| `message.reply` | Article reference and public/internal visibility | Resolved API key, authenticated portal customer, or MFA-authenticated dashboard staff |
| `ticket.assignment_changed` | Actual prior/new assignee and group IDs | Resolved API key or MFA-authenticated dashboard staff |
| `ticket.state_changed` | Actual prior/new status and priority | Resolved API key or MFA-authenticated dashboard staff |

Every event has a tenant/ticket relationship, schema version, local event ID,
transaction-ordered sequence, database-recorded time, source and actor provenance.
The sequence is per ticket, not a global request counter. Facts are allowlisted
and limited to 4 KiB. They contain no message body, display name, email address,
credential, idempotency key, auth link, R2 path, provider response or model reasoning.

The submitting actor is separate from the message author. An API key declaring a
customer email remains the API-key actor. When dashboard staff create a ticket on
behalf of a customer, staff are the audit actor even if the initial article names
the customer. Stored role/provenance does not grant future access.

API/portal keyed and unkeyed creation/replies, dashboard/widget intake, dashboard
replies and dashboard/API assignment/state updates record these events. Historical
rows and direct repository callers without verified actor context are not backfilled
or attributed by inference. Custom-field-only changes are not one of the four audit
event kinds. Disabled inbound/provider/background paths remain separate scope.

## Consistent writes and recovery

Intake/reply data, attachment metadata, timestamp changes and the audit event share
one D1 batch. A keyed API/portal mutation places its completed replay receipt last;
a unique receipt conflict rolls back the losing event and candidate data together.
Replaying an accepted result adds no event.

Assignment/state events select actual prior values inside the update transaction,
then the update and any dashboard compatibility note commit in that same batch.
One request changing both assignment and state records two ordered events. Values
that do not change produce no event. Compatibility notes use readable text derived
from the captured changes and remain internal; custom-field changes retain a simple
internal note without copying field values into event facts.

A failed event or later write rolls back the whole database batch. Existing R2
objects are retained; validation precedes the transaction. Broadcast and configured
mail transports remain postcommit best effort, with no exactly-once delivery claim.
Existing retention freeze checks still apply to these writes.

## Authorized history

History endpoints are:

- `GET /api/v1/tickets/:id/history` with current API-key `tickets:read` authority;
- `GET /api/tickets/:id/history` with current dashboard staff role, MFA and applicable
  group membership;
- `GET /api/v1/customer/tickets/:id/history` with current customer session, tenant and
  ticket ownership.

They accept `limit` from 1 to 50 (default 50) and an optional `cursor` identifying the
last visible event from that ticket. The response is `{events, nextCursor}`. Each
event includes its ID, kind, recorded time, source, visibility, actor projection,
allowlisted facts and optional article ID. Staff additionally receive scoped actor
IDs and sequence numbers.

API and customer history preserve the existing public-only detail policy: only
public intake/reply events are visible. Assignment, state and internal-note events
are excluded. Public responses omit private actor IDs, event facts and sequence
numbers; actor categories are requester/support with safe provenance. Current
article visibility is checked as well as stored event visibility, so an article
made internal cannot be rediscovered through old public history.

Filtering precedes pagination. Cursors are validated against the same tenant,
ticket and visibility rules, with no global counts, internal sequence gaps or
private has-next indicators. Staff can reconstruct the fixture's intake, replies,
assignment and state transitions in order, joining only currently authorized
article content. This is not reconstruction of erased content or every historical
custom-field value; older tickets may have incomplete history.

## Canonical projection and replay versions

Live public detail adds known audit event references only for visible intake and
messages. Missing historical events stay `not-recorded`. New mutation receipts use
snapshot/response version 2 and contain immutable local audit references captured
in the mutation batch. They do not embed live history or private actor metadata.

Version 1 receipts retain their original renderer and canonical projection,
including their original absent audit facts. An earlier key replays that original
response without fabricating an event. Version 2 responses likewise remain stable
across later conversation edits. Both receipt versions keep the 24-hour replay
window, tenant/credential namespace, conflict rules and current authority checks.
The semantic fingerprint remains version 1 because audit facts are server-derived.
The raw JSON request limit is 64 KiB; the separate 128 KiB normalized fingerprint
limit includes derived fields. The stored receipt byte limit remains 256 KiB.

## Deletion and lifecycle

Deleting a ticket, including scoped retention, removes its events with the ticket.
Existing attachment/article cleanup must still precede deletion of their parent
ticket; the audit migration does not change those foreign-key rules. Deleting an article clears its event's article reference; public history omits
removed replies, while staff retain the non-content event. User deletion redacts
actor IDs and assignment facts referring to that user; API-key deletion redacts
its actor ID. No body or attachment path is retained in event facts. Receipt
content deletion continues to replace snapshots with expiry-bounded tombstones.
These events follow conversation lifecycle, not a new immutable legal archive or
production retention SLA.

## Local acceptance

Use Node 22 and disposable synthetic fixtures:

```sh
npm run typecheck:conversation-audit --workspace=apps/server
npm run test:conversation-audit --workspace=apps/server
npm run test:ticket-mutation-replay --workspace=apps/server
```

The audit acceptance uses local migrated D1, actual issued A/B credentials and
staff MFA, with provider boundaries simulated. It reports resource and recovery
measurements rather than provider billing. The scripts dispose of their own state;
these commands do not authorize remote migration, provider activation or deployment.

The 9 September 2026 local acceptance passed eight cases. A subsequent targeted
lifecycle check and dedicated typecheck also passed after adding an audited bodyless
ticket through the actual retention claim/completion path. The acceptance mapping is:

| Requirement | Executed evidence |
| --- | --- |
| Attributable intake/replies | Actual API, portal, dashboard and widget routes; persisted submitting actor checked separately from message author |
| Reconstructable changes | Concurrent state updates form the exact prior/new chain; assignment records scoped IDs; unchanged fields add no event |
| Consistent persistence/recovery | Real event-insert and later receipt-insert failures leave no candidate rows; a clean retry succeeds |
| Authorized public/internal history | Current A/B tenant, API permission, MFA and customer-session checks; internal and newly hidden articles excluded from public history/detail; filtered cursor pages |
| Replay compatibility | Actual v1-to-0026 migration preserves snapshot bytes; an authorized v1 request replays absent audit facts; v2 responses remain immutable; malformed receipt versions are rejected |
| Lifecycle and resources | Scoped credential/article/ticket deletion, actual retention claim/completion and tenant-B preservation; isolated fixtures clean up after execution |

A representative lifecycle fixture measured 82 bytes of event facts against the
4 KiB constraint, zero remaining tenant-A events after deletion, one preserved
B event, zero events remaining for the separately retained ticket, zero R2 objects
and three route requests. Its selected fixture `d1Rows`
counter was 9; that counter counts users, tickets and API keys, not articles or
event rows. Event counts were queried separately. These are local operation/data
measurements, not a provider cost ceiling or production-runtime clearance.
