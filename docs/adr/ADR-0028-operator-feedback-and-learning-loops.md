# ADR-0028 — Service feedback and reporting are bounded, event-derived support operations

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026

## Context

Tocyn's approved #85 scope defines operational metrics but does not provide customer feedback collection, a live support-management dashboard or a custom report builder.

A naïve custom-report feature that exposes SQL/raw tables would weaken tenant isolation and cost controls. Generic survey/campaign functionality would also cross the approved helpdesk product boundary.

## Decision

Tocyn will add support-service feedback and bounded operational reporting.

Core feedback types are:

- CSAT;
- CES;
- optional free-text service comment.

NPS is not a core milestone requirement. The schema may be extensible for a later approved feedback type, but Tocyn will not build a marketing survey platform.

Operational reporting will use:

- canonical/audit/event-derived metric definitions;
- an allowlisted server-side metric/dimension registry;
- tenant-scoped aggregate/query plans;
- parameterised filters;
- bounded timeframe/cardinality/result limits;
- permission and CostPolicy enforcement.

Tenant-defined report definitions contain metric/dimension/filter/time-grouping identifiers, never raw SQL.

The live support-management dashboard consumes bounded authoritative aggregates/snapshots rather than repeatedly scanning unbounded ticket/message history.

## Consequences

- #85 remains the semantic metric foundation.
- CSAT/CES can correlate to channel, SLA, operator/team, AI handoff and problem/realtime-session context.
- Reporting UX can grow without exposing database implementation details.
- Incident/realtime metrics can join the registry as their owning milestones land.
- Feedback prompts remain support-transactional and cannot be repurposed as arbitrary campaigns without a new product decision.

## Related

- issue #73
- issue #85
- proposed ADR-0016
- proposed ADR-0027
- approved M9.4

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0022-bounded-service-feedback-and-operational-reporting.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#155](https://github.com/nathcymru/Tocyn/issues/155), [#156](https://github.com/nathcymru/Tocyn/issues/156), [#157](https://github.com/nathcymru/Tocyn/issues/157).

The [approved master decisions](../planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
