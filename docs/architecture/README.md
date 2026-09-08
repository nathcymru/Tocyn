# Tocyn architecture

This directory is the repository-backed technical architecture reference for Tocyn. It describes both the implementation currently present in `main` and approved future architecture. Where those differ, documents use explicit **Implemented**, **Approved / planned**, or **Not yet implemented** labels.

## Start here

- [System overview](system-overview.md) — application surfaces, Worker/runtime services and request flow.
- [Data and tenant boundaries](data-and-tenant-boundaries.md) — tenant authority, D1/R2/Vectorize ownership and isolation invariants.
- [Channel adapter architecture](channel-adapters.md) — canonical conversation boundary and external-channel model.
- [AI and autonomous operations](ai-and-autonomous-operations.md) — current advisory AI and planned policy-gated execution.
- [Multitenancy evidence](multitenancy/) — Phase 1 implementation/review artefacts retained for provenance.

## Authority

Approved roadmap issues and accepted ADRs define the target architecture. Runtime code and migrations establish how much is implemented; actual environment evidence establishes what is deployed. Present the target first, with delivery status separately stated. Current code must not silently redefine the approved end-state topology. Historical `phase-*` design documents may explain provenance but do not override current code, issues or ADRs.

Diagrams in these pages supplement the prose. The same material is described in text so the documentation remains understandable without Mermaid rendering.
