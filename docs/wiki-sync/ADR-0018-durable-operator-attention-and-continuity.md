# ADR-0018 — Durable operator attention state is distinct from canonical conversation state

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owners:** Proposed by post-beta UX review; requires project acceptance

## Context

Canonical ticket/conversation state answers what has happened in the support interaction. Operators additionally need to know what work is unfinished, deferred, drafted, mentioned, due or ready to resume.

The beta retains drafts after some failures, but changing ticket resets local composer state. There is no first-class Snoozed, Drafts or Needs Action model. That pushes follow-up and interruption recovery into human memory.

Storing sensitive draft text in arbitrary browser persistence would solve one UX defect by creating a privacy/data-lifecycle problem.

## Decision

Tocyn will represent operator work-in-progress and attention explicitly, without treating it as tenant authority.

At minimum the architecture supports:

- per-user/per-ticket durable draft state;
- selected work view/workspace presentation state;
- audited ticket-level snooze/next-action state;
- waiting reason;
- derived Drafts/Snoozed/Needs Action work views;
- durable operator notifications/activity;
- revision information sufficient for collision-aware resume/send.

Sensitive draft content uses Tocyn's authenticated tenant-scoped storage/body abstractions. Long-lived browser storage is not the default canonical store for customer-content drafts.

Presentation preferences may be server persisted per tenant/user but cannot grant access or change server permission.

Canonical ticket lifecycle remains the source for ticket state. Attention/work state is additive and must not silently invent a second incompatible ticket system.

## Consequences

- #129/04 require additive data/API work.
- Draft retention and cleanup need documented retention.
- Snooze/resurface needs deterministic scheduler/query behaviour.
- #68 consumes durable drafts.
- #70 consumes base-conversation revision/collision state.
- #73 consumes waiting/next-action semantics.
- #63 audit remains authoritative for attributable ticket mutations.
- Authentication/authority changes must prevent restoration of stale prior-tenant work state.

## Related

- ADR-0012
- ADR-0014
- ADR-0017
- ADR-0019
- #60, #63, #68, #70, #73
- #129, #130, #133, #136

## Source and current authority

Source archive: `tocyn-post-beta-ux-update-2026-09-10.zip`; original path: `tocyn-post-beta-ux-update-2026-09-10/adrs/ADR-0017-durable-operator-attention-state.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#129](https://github.com/nathcymru/Tocyn/issues/129), [#130](https://github.com/nathcymru/Tocyn/issues/130), [#133](https://github.com/nathcymru/Tocyn/issues/133), [#136](https://github.com/nathcymru/Tocyn/issues/136).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
