# Architecture decision records

Accepted by the repository owner on 8 September 2026. These are design decisions, not claims of implemented features or production clearance. Changes require a superseding ADR; preserve decision history.

Roadmap: [#49](https://github.com/nathcymru/Tocyn/issues/49). Cross-cutting prerequisite: [#50](https://github.com/nathcymru/Tocyn/issues/50).

- [ADR-0001: Critical: cost efficiency without weakened correctness](ADR-0001-Cost-efficiency-without-weakened-correctness)
- [ADR-0002: Owner ceilings, delegated budgets and strict admission](ADR-0002-Delegated-budgets-and-strict-admission)
- [ADR-0003: Tenant-owned provider applications for v1](ADR-0003-Tenant-owned-provider-apps)
- [ADR-0004: Durable raw ingestion and measured latency](ADR-0004-Durable-ingestion-and-measured-latency)
- [ADR-0005: Encrypted credentials and bounded ingress caching](ADR-0005-Credentials-and-bounded-ingress-cache)
- [ADR-0006: Every configured support-channel thread creates a ticket](ADR-0006-Support-channel-thread-ticketing)
- [ADR-0007: One active direct-message ticket and conservative gratitude handling](ADR-0007-Direct-message-lifecycle-and-gratitude)
- [ADR-0008: WhatsApp free-form-only replies in v1](ADR-0008-WhatsApp-free-form-window)
- [ADR-0009: Normalized events and reliable delivery](ADR-0009-Normalized-events-and-reliable-delivery)

- [ADR-0010: Policy-gated actions and controlled reference validation](ADR-0010-Policy-gated-actions-and-reference-validation)
- [ADR-0011: Architectural milestones and API/portal-first private beta](ADR-0011-Architectural-milestones-and-private-beta)

Current schedules and ownership: [approved architectural roadmap](Approved-architectural-roadmap). Earlier ADR principles remain; #50 is not a first-beta blocker and the narrow beta guardrails are tracked separately.

## Repository-reviewed decisions — issue #96

- [ADR-0012 — Canonical conversations and channel adapters](ADR-0012-canonical-conversations-and-channel-adapters)
- [ADR-0013 — Authentication mail and support-email conversations are separate capabilities](ADR-0013-email-capability-boundaries)
- [ADR-0014 — Living delivery state uses baseline, forecast and actual evidence](ADR-0014-living-delivery-state)
- [ADR-0015 — Privacy metadata is not an access-control authority](ADR-0015-privacy-metadata-boundary)

Accepted decisions describe architecture; implementation status remains governed by current code and the linked roadmap issues.

## Accepted post-beta direction — implementation pending

The owner-approved [[Post-beta-master-baseline]] reconciles source number collisions by topic. ADR-0001–0015 remain preserved; explicit addenda supersede changed scheduling/release guidance.

- [ADR-0016 — Tocyn is a helpdesk, not a CRM or marketing-engagement platform](ADR-0016-product-boundary-and-release-gates)
- [ADR-0017 — Persistent operator workspace replaces route-driven ticket handling](ADR-0017-persistent-operator-workspace)
- [ADR-0018 — Durable operator attention state is distinct from canonical conversation state](ADR-0018-durable-operator-attention-and-continuity)
- [ADR-0019 — Cognitive accessibility and attention control are product architecture requirements](ADR-0019-cognitive-accessibility-and-attention-control)
- [ADR-0020 — Operator AI augments existing human workflows instead of creating a parallel UI](ADR-0020-human-led-ai-assistance)
- [ADR-0021 — Operational observability and service-level objectives](ADR-0021-observability-and-accountable-feedback)
- [ADR-0022 — Deployment residency and jurisdiction boundaries](ADR-0022-data-residency-and-storage-boundaries)
- [ADR-0023 — Realtime support communications use conversation-linked support sessions](ADR-0023-realtime-state-and-collaboration)
- [ADR-0024 — Operator applets are declarative views over governed Tocyn capabilities](ADR-0024-governed-workspace-applets)
- [ADR-0025 — Tenant AI is a logical retrieval boundary, not a separately trained model](ADR-0025-knowledge-and-contextual-assistance)
- [ADR-0026 — Cloudflare Access authenticates workforce entry; Tocyn authorises application capabilities](ADR-0026-access-identity-and-permission-boundaries)
- [ADR-0027 — Customer tickets, back-office work and service problems are distinct linked records](ADR-0027-linked-work-and-workflow-continuity)
- [ADR-0028 — Service feedback and reporting are bounded, event-derived support operations](ADR-0028-operator-feedback-and-learning-loops)
