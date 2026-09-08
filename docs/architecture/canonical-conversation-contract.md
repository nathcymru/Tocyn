# Canonical conversation contract

Issue #59 establishes one provider-neutral conversation projection over Tocyn's
tenant-scoped `tickets`, `articles`, and `attachments` records. It does not add
a second conversation store or activate a provider adapter.

API and portal responses add a `canonical` member without changing their current
top-level ticket, article, attachment, status-code, or body-less API behaviour.
The projection has `conversation` and `messages` members. Every fact that is not
stored or evidenced is represented by a typed field status: `unknown`,
`not-recorded`, or `not-applicable`. A `known` fact includes its value.

## Stored facts and projection

| Category | Recorded and projected now | Deliberate boundary |
| --- | --- | --- |
| Conversation | Ticket ID, optional Tocyn ticket number, workflow state, priority, subject lifecycle, and local correlation | No separate provider conversation ID or thread mapping exists yet. |
| Intake | Ticket `source`; server-observed `intake_received_at` and `intake_processed_at` for new API, portal, widget, and dashboard ticket writes | These clocks are set by the service immediately before its write. They do not claim an HTTP-edge receipt time, provider occurrence time, or transaction-completion measurement. Historical rows remain `not-recorded`. |
| Requester | A portal/widget ticket records the authenticated customer ID and email. API keeps its supplied customer email as a declared requester and never creates or impersonates a user. | A declared email does not authenticate its owner. |
| Recipient | A verified tenant scope gives customer-originated API/portal/widget messages a logical `tenant-support` destination. | Tocyn does not record an external address or provider recipient here. |
| Message | Article ID/parent correlation, stored sender type/ID, visibility, safe content reference, raw-email compatibility ID where present, and attachment metadata | `raw_email_id` remains email compatibility data. It is not a provider-neutral identifier. R2 keys are never emitted in `canonical`. |
| Message intake | `articles.intake_source`, `received_at`, and `processed_at` record the explicit route/service path and observed service clocks for new messages. | A later message never inherits the ticket's source. Legacy/direct repository rows stay `not-recorded`. |
| Direction and delivery | Customer messages created through explicit API, portal, or widget intake are inbound. Internal messages and non-customer/legacy messages keep unknown direction. Internal and inbound messages are non-delivery; other public agent/system messages have delivery `not-recorded`. | An agent/system label, persistence, or public visibility does not prove outbound provider delivery. |
| External, audit and occurrence facts | Typed absence fields make the boundary visible. | Provider IDs, provider correlation/reply IDs, external occurrence/acknowledgement, delivery receipts, and audit events are not invented from Tocyn local fields. |

The message `state.persistence` is `persisted` only because the corresponding
article record exists. It is independent of visibility and delivery.

## Tenant and visibility rules

Tenant selection continues to come from authenticated API-key/customer context
and the scoped repositories. Client tenant, provider, external-ID, correlation,
direction, recipient, delivery, and audit selectors are neither authority nor
canonical provider facts. The mapper runs after the existing route ownership and
visibility checks. Portal and API detail views exclude internal articles before
projection, and the canonical attachment view exposes only its local attachment
ID, filename, size, and content type—not an R2 storage key.

Conversation creation with an initial message is one D1 batch. A failed article
write rolls the ticket write back; ticket-only API intake remains supported and
returns a valid canonical conversation with an empty message collection.

## Compatibility and future work

The current proof covers local API and portal records. It does not claim an
enabled email, Slack, Teams, WhatsApp, Telegram, webhook, or outbound channel.
These explicit handoffs remain separate work:

- #60 owns idempotency, replay, and conflict semantics.
- #63 owns audit events.
- #87 owns provider normalisation.
- #88 owns outbound dispatch and delivery state.
- #91 owns durable ingestion and journal infrastructure.

The contract follows [ADR-0012](../adr/ADR-0012-canonical-conversations-and-channel-adapters.md): provider metadata may assist a future adapter but never establishes tenant authority.

## Local verification and recovery evidence

Run the focused checks with the repository's Node 22 runtime:

```sh
npm run typecheck:canonical-conversation --workspace=apps/server
npm run typecheck:canonical-conversation-atomic --workspace=apps/server
npm run test:canonical-conversation --workspace=apps/server
npm run test:canonical-conversation-atomic --workspace=apps/server
```

These tests initialise a disposable local D1/R2 fixture and apply the complete
checked-in migration chain through `0024_canonical_intake_facts.sql`. They do
not connect to a Cloudflare account or provider. The route proof uses two
synthetic tenants, route-issued customer credentials, and scoped API keys. It
records one synthetic attachment object, checks the local D1/R2 counters, and
proves cross-tenant reads leave ticket/article/attachment counts unchanged. The
atomic diagnostic distinguishes the two inserted intake rows (`totalPersistedIntakeRows: 2`)
from the fixture's selected `d1Rows` counter (`selectedFixtureRowsAdded: 1`),
which intentionally counts tickets but not articles. It must not be treated as
a total-record counter.

The atomic test deliberately makes the initial article's tenant-qualified
sender reference fail. The batch adds zero rows, preserves both tenant
snapshots, performs no R2 operation, and then succeeds on a clean retry with
one ticket and one article. That is D1 rollback/retry evidence for the initial
conversation write only; it is not request-idempotency evidence and does not
recover provider delivery, migrations, or external data.
