# Tocyn documentation

This directory contains the version-controlled implementation, architecture, privacy, security and operational reference for Tocyn.

## Current documentation authority

- [Architecture](architecture/README.md)
  - [System overview](architecture/system-overview.md)
  - [Data and tenant boundaries](architecture/data-and-tenant-boundaries.md)
  - [Channel adapters](architecture/channel-adapters.md)
  - [Canonical conversation contract](architecture/canonical-conversation-contract.md)
  - [Conversation audit](architecture/conversation-audit.md)
  - [AI and autonomous operations](architecture/ai-and-autonomous-operations.md)
- [Privacy engineering](privacy/README.md)
  - [Privacy architecture](privacy/privacy-architecture.md)
  - [GDPR deployer technical guide](privacy/gdpr-compliance-user-guide.md)
- [Architecture decision records](adr/README.md)
- [Agent governance](agents/README.md)
- [Roadmap pointer and forecasts](roadmap.md)
- [Security implementation material](security/)
- [Current tenant-isolation acceptance matrix](security/tenant-isolation-acceptance.md)
- [Deployment guide](deployment.md) — inherited/operational material; current issue/release gates control remote actions.
- [Isolated preview and beta release preparation](isolated-environments.md) — #57 source controls, owner operation choices, and unrun remote acceptance contract.
- [Agent development tooling](agent-development.md)
- [Repository structure](repository-structure.md)
- [Wiki synchronization bundle](wiki-sync/README.md)

Repository-level policies remain at root: `SECURITY.md`, `PRIVACY_POLICY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE` and `AGENTS.md`.

Approved roadmap: https://github.com/nathcymru/Tocyn/wiki/Approved-architectural-roadmap

Accepted ADR index: https://github.com/nathcymru/Tocyn/wiki/Architecture-decision-records

## Status convention

Current documents must explicitly distinguish:

- **Implemented** — evidenced in current repository source/configuration;
- **Approved / planned** — accepted roadmap/ADR scope not yet implemented;
- **Historical** — retained provenance that no longer controls current sequencing.

Old `v0.1.0`/`v0.2.0`/`v0.3.0`/`v0.4.0` milestone language is historical. Current architectural milestones use M0–M7 capability groups; releases/tags remain separate.

## Diagrams

Use Mermaid when a process, architecture relationship, hierarchy or timeline is materially clearer visually. Diagrams supplement complete prose and must not be the only place where security, privacy or procedural meaning appears. See `.agents/rules/documentation.md`.

## Historical material

Files under historical phase/ideas/community-draft areas remain useful provenance. Preserve them unless an approved issue explicitly retires them, but do not cite them as current authority when a newer issue/ADR/current architecture page supersedes them.
