# Architecture decision records — synchronization addendum

When publishing issue #96 to the live Wiki, **preserve all existing ADR-0001–ADR-0011 entries and their history**. The current connector cannot read/write the Wiki Git repository, so this file intentionally does not reconstruct older ADR titles from memory.

Append/publish the repository-reviewed ADRs:

- **ADR-0012 — Canonical conversations and channel adapters** — provider adapters normalise into the canonical Tocyn conversation model; provider/path identifiers do not grant tenant authority.
- **ADR-0013 — Authentication mail and support-email conversations are separate capabilities** — transactional mail transport/migration and the helpdesk email adapter have independent acceptance/dependencies.
- **ADR-0014 — Living delivery state uses baseline, forecast and actual evidence** — issue-owned PR delivery, partial-work receipts and immutable baseline dates.
- **ADR-0015 — Privacy metadata is not an access-control authority** — future FidesLang metadata remains descriptive and cannot weaken authentication/authorisation/tenant isolation.

Canonical source files: https://github.com/nathcymru/Tocyn/tree/main/docs/adr

Also ensure the index continues to link:

- ADR-0010 — Policy-gated actions and reference validation
- ADR-0011 — Architectural milestones and private beta

The accepted post-beta source pages are mirrored in this bundle and remain implementation pending:

- [ADR-0016 — Helpdesk product boundary and release gates](ADR-0016-product-boundary-and-release-gates.md)
- [ADR-0017 — Persistent operator workspace](ADR-0017-persistent-operator-workspace.md)
- [ADR-0018 — Durable operator attention and continuity](ADR-0018-durable-operator-attention-and-continuity.md)
- [ADR-0019 — Cognitive accessibility and attention control](ADR-0019-cognitive-accessibility-and-attention-control.md)
- [ADR-0020 — Human-led operator AI](ADR-0020-human-led-ai-assistance.md)
- [ADR-0021 — Operational observability and service-level objectives](ADR-0021-observability-and-accountable-feedback.md)
- [ADR-0022 — Deployment residency and jurisdiction boundaries](ADR-0022-data-residency-and-storage-boundaries.md)
- [ADR-0023 — Realtime support communications](ADR-0023-realtime-state-and-collaboration.md)
- [ADR-0024 — Governed declarative operator applets](ADR-0024-governed-workspace-applets.md)
- [ADR-0025 — Tenant knowledge grounding and document ingestion](ADR-0025-knowledge-and-contextual-assistance.md)
- [ADR-0026 — Cloudflare Access workforce identity](ADR-0026-access-identity-and-permission-boundaries.md)
- [ADR-0027 — Linked work and problem management](ADR-0027-linked-work-and-workflow-continuity.md)
- [ADR-0028 — Bounded service feedback and operational reporting](ADR-0028-operator-feedback-and-learning-loops.md)

If the live Wiki already contains ADR numbers above 0011 that conflict with this addendum, **do not overwrite them**. Stop publication, preserve the existing numbers, and renumber these new ADR source pages with explicit cross-links in a small follow-up PR.
