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

If the live Wiki already contains ADR numbers above 0011 that conflict with this addendum, **do not overwrite them**. Stop publication, preserve the existing numbers, and renumber these new ADR source pages with explicit cross-links in a small follow-up PR.
