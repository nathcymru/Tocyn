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

## Status convention

Each ADR states its status. A superseding ADR must link the decision it replaces; do not silently rewrite an accepted historical ADR to make current architecture look cleaner.
