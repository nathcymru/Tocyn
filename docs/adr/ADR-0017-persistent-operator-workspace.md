# ADR-0017 — Persistent operator workspace replaces route-driven ticket handling

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owners:** Proposed by post-beta UX review; requires project acceptance
- **Supersedes:** the operator-layout assumption in `docs/phase-2.2-layout-redesign.md`; does not supersede canonical conversation ADR-0012

## Context

The accepted local private beta proved that operators can safely handle canonical API/portal tickets. Actual use then exposed a product-level failure outside #62's scope: the primary workflow is a ticket table followed by a separate full ticket page and explicit return to the list.

This repeatedly removes queue context, increases working-memory demand, interrupts flow and makes ticket metadata rather than the customer conversation the organising model. Rebuilding the same composition with Ark/Zag would improve control mechanics without correcting the product experience.

Contemporary helpdesks commonly preserve an inbox/list while the active conversation changes. Tocyn also needs stronger cognitive accessibility than a dense competitor clone.

## Decision

Tocyn's primary human-operator experience is a **persistent progressive workspace**.

The conceptual composition is:

1. global application navigation;
2. work-view navigator;
3. conversation list;
4. active conversation and compact work/action bar;
5. reply/internal-note composer;
6. collapsible contextual panel.

Changing the active conversation MUST NOT conceptually destroy the selected work view, its list position or resumable work.

The primary operator route is an Inbox/workspace model. A configurable Table view remains available for bulk administration, audit and overview, but it is secondary.

Deep links remain supported. Existing `/tickets` routes may be retained through compatibility routing while migration occurs.

Desktop may present multiple panes. Narrow/mobile layouts may present one pane at a time, but state continuity is the same.

The target product model is independent of rendering primitives. #48 Ark/Zag primitives implement the accepted workspace; they do not determine its information architecture.

## Consequences

- #48 must classify obsolete beta compositions rather than blindly reproduce them.
- #71 keyboard navigation targets the workspace, not legacy page transitions.
- Draft, selected view and panel state require durable/user-scoped state defined by ADR-0018.
- Provider adapters render through one operator workspace rather than creating channel-specific inboxes.
- Table/detail source files can be refactored/retired after compatibility and acceptance.
- Route compatibility needs explicit tests.
- The UX acceptance gate becomes separate from first-beta functional acceptance.

## Related

- ADR-0012 — Canonical conversations and channel adapters
- ADR-0018 — Durable operator attention state
- ADR-0019 — Cognitive accessibility and attention control
- #48, #66, #68, #71
- #127, #128, #129, #130

## Source and current authority

Source archive: `tocyn-post-beta-ux-update-2026-09-10.zip`; original path: `tocyn-post-beta-ux-update-2026-09-10/adrs/ADR-0016-operator-workspace-continuity.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#127](https://github.com/nathcymru/Tocyn/issues/127), [#128](https://github.com/nathcymru/Tocyn/issues/128).

The [approved master decisions](../planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
