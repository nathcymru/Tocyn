# Operator workspace contract

**Issue:** [#127](https://github.com/nathcymru/Tocyn/issues/127)  
**Status:** Accepted direction; implementation pending. This is an interaction contract, not an application implementation.

The contract is split into:

- [Interaction contract](operator-workspace-interaction-contract.md): information architecture, routes, continuity, responsive behavior, search, attention and focus.
- [Current surface inventory](current-surface-inventory.md): retain, migrate, replace, context-move and retire decisions for the beta surfaces.
- [Critical finding map](critical-finding-map.md): named surface/state coverage for every Critical LAW, COMP and COG finding.

The contract follows [ADR-0017](../adr/ADR-0017-persistent-operator-workspace.md), [ADR-0018](../adr/ADR-0018-durable-operator-attention-and-continuity.md), [ADR-0019](../adr/ADR-0019-cognitive-accessibility-and-attention-control.md), and [ADR-0020](../adr/ADR-0020-human-led-ai-assistance.md). It preserves the current beta's error, retry, public/internal, attachment, audit and tenant/actor-authority behavior as non-regression requirements.

Evidence reviewed: `apps/dashboard/src/components/layout/Layout.tsx`, `TicketListPage.tsx`, `TicketDetailPage.tsx`, `DashboardPage.tsx`, and the focused dashboard accessibility/workflow tests. Source findings are in `docs/planning/post-beta-2026-09-10/sources/tocyn-post-beta-ux-update-2026-09-10.zip`, read directly with `zipfile`.
