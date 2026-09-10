# ADR-0027 — Customer tickets, back-office work and service problems are distinct linked records

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026

## Context

Tocyn's ticket model is customer-support oriented. Mature helpdesks also need private back-office work and one-to-many tracking of a service problem/incident affecting many customer conversations.

Overloading every concept into the existing customer ticket row would blur visibility, ownership and lifecycle semantics.

## Decision

Keep the canonical customer `ticket/conversation` as the unit of customer support history.

Add separate tenant-owned domains:

- **BackofficeWorkItem** — internal work with its own owner/status/priority and private discussion/evidence;
- **ServiceProblem** — a problem/incident with severity/status/timeline, internal diagnosis and customer-safe update fields.

Use explicit tenant-qualified link tables:

- ticket ↔ back-office work;
- problem/incident ↔ affected ticket.

Linking does not copy internal notes into a customer conversation.

Publishing an affected-customer incident update is an explicit authorised action. It resolves a bounded target set, writes a customer-visible article/event into each target conversation and uses the shared transactional outbound mechanism for delivery. It is not a marketing audience/campaign feature.

## Consequences

- Back-office teams can own work without taking ownership of the customer conversation.
- One incident can correlate hundreds of support cases while preserving each customer's history.
- Internal/private and customer-visible content have explicit boundaries.
- #72 split/merge remains ticket-level provenance and is not repurposed.
- Bulk incident updates need idempotent batch/target receipts and cost/rate controls.
- The model is not a full ITSM CMDB/change-management system.

## Related

- issues #70, #72, #79, #88
- proposed ADR-0016
- approved M9.1

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0021-linked-work-and-problem-management.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#149](https://github.com/nathcymru/Tocyn/issues/149), [#150](https://github.com/nathcymru/Tocyn/issues/150).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
