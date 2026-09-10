# Architecture decision records

Tocyn ADRs record durable architectural choices. Accepted historical ADRs remain on the GitHub Wiki; this repository directory gives new decisions a version-controlled source so they can be reviewed by PR before Wiki publication.

## Existing accepted Wiki ADRs

- ADR-0010 — Policy-gated actions and reference validation
- ADR-0011 — Architectural milestones and private beta

Existing ADR-0001–ADR-0009 entries must be preserved when the Wiki index is synchronized; they are not reconstructed from memory here.

## Repository-backed ADRs added under issue #96

- [ADR-0012 — Canonical conversations and channel adapters](ADR-0012-canonical-conversations-and-channel-adapters.md)
- [ADR-0013 — Authentication mail and support-email conversations are separate capabilities](ADR-0013-email-capability-boundaries.md)
- [ADR-0014 — Living delivery state uses baseline, forecast and actual evidence](ADR-0014-living-delivery-state.md)
- [ADR-0015 — Privacy metadata is not an access-control authority](ADR-0015-privacy-metadata-boundary.md)

## Accepted post-beta directions (implementation pending)

These decisions are accepted project direction and are not claims that the corresponding features, services or resources exist. They are implementation-pending until issue-owned reviewed delivery provides evidence.

- [ADR-0016 — Tocyn is a helpdesk, not a CRM or marketing-engagement platform](ADR-0016-product-boundary-and-release-gates.md)
- [ADR-0017 — Persistent operator workspace replaces route-driven ticket handling](ADR-0017-persistent-operator-workspace.md)
- [ADR-0018 — Durable operator attention state is distinct from canonical conversation state](ADR-0018-durable-operator-attention-and-continuity.md)
- [ADR-0019 — Cognitive accessibility and attention control are product architecture requirements](ADR-0019-cognitive-accessibility-and-attention-control.md)
- [ADR-0020 — Operator AI augments existing human workflows instead of creating a parallel UI](ADR-0020-human-led-ai-assistance.md)
- [ADR-0021 — Operational observability and service-level objectives](ADR-0021-observability-and-accountable-feedback.md)
- [ADR-0022 — Deployment residency and jurisdiction boundaries](ADR-0022-data-residency-and-storage-boundaries.md)
- [ADR-0023 — Realtime support communications use conversation-linked support sessions](ADR-0023-realtime-state-and-collaboration.md)
- [ADR-0024 — Operator applets are declarative views over governed Tocyn capabilities](ADR-0024-governed-workspace-applets.md)
- [ADR-0025 — Tenant AI is a logical retrieval boundary, not a separately trained model](ADR-0025-knowledge-and-contextual-assistance.md)
- [ADR-0026 — Cloudflare Access authenticates workforce entry; Tocyn authorises application capabilities](ADR-0026-access-identity-and-permission-boundaries.md)
- [ADR-0027 — Customer tickets, back-office work and service problems are distinct linked records](ADR-0027-linked-work-and-workflow-continuity.md)
- [ADR-0028 — Service feedback and reporting are bounded, event-derived support operations](ADR-0028-operator-feedback-and-learning-loops.md)

## Status convention

Each ADR states its status. A superseding ADR must link the decision it replaces; do not silently rewrite an accepted historical ADR to make current architecture look cleaner.
