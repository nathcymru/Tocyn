# ADR-0012 — Canonical conversations and channel adapters

- **Status:** Accepted
- **Date:** 8 September 2026
- **Decision owners:** Tocyn roadmap/backlog approval

## Context

Tocyn is intended to support API/portal intake plus later Slack, support email, Teams, WhatsApp and Telegram. Making each provider a separate ticket model would duplicate business logic, fragment operator UX and weaken tenancy/idempotency controls.

The first private beta deliberately validates API/portal conversations before adding Slack or full omnichannel breadth.

## Decision

Tocyn's core support state is provider-independent. External systems connect through authenticated adapters that normalise provider events into canonical Tocyn ticket/article/conversation state and translate outbound Tocyn messages back to the originating provider.

Provider identifiers and route/path fields are metadata, not tenant authority. Tenant ownership must be established through verified credentials/signatures/connections and stored mappings before normalisation.

Shared ingestion, deduplication, dispatch, retry and delivery-state infrastructure may be reused across adapters. Provider-specific semantics stay in their adapter/milestone.

## Consequences

- API/portal can prove the canonical core before Slack becomes a beta dependency.
- Provider adapters must preserve threading/topic/reply IDs without changing the core operator model.
- A new provider should not require redesign of core ticket state.
- Idempotency and tenant-boundary tests are required at every adapter.
- Provider-specific limitations remain visible rather than being hidden behind a false universal delivery model.

## Related

- `docs/architecture/channel-adapters.md`
- M1.2 shared intake/webhook architecture
- M7.1–M7.5 provider milestones
- tracker #49

## Current direction addendum

The accepted post-beta direction keeps canonical conversation state provider-independent while requiring every provider UI to render through the persistent operator workspace and shared composer. See [ADR-0017](ADR-0017-persistent-operator-workspace.md), [ADR-0020](ADR-0020-human-led-ai-assistance.md) and [ADR-0027](ADR-0027-linked-work-and-workflow-continuity.md). This is implementation pending and does not change the historical decision.
