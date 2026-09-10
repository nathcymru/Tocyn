# ADR-0016 — Tocyn is a helpdesk, not a CRM or marketing-engagement platform

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owners:** Maintainer/product roadmap approval

## Context

A full-market comparison with Intercom exposes capabilities that are valuable to Intercom but are not all appropriate for Tocyn. If every competitor capability is treated as a defect, Tocyn would expand into CRM, customer-data, marketing automation, product-adoption and public app-marketplace domains.

The intended product is a world-class open-source helpdesk. It needs excellent support context, communication, service operations, knowledge, reporting and governed extensibility without becoming a general sales/marketing platform.

## Decision

Tocyn's product boundary is the support/helpdesk domain.

In scope are capabilities required to receive, understand, route, resolve, collaborate on, automate, measure and safely extend customer-support work.

Explicitly out of scope unless a later ADR changes this decision:

- leads, opportunities, sales pipelines and campaign attribution;
- behavioural customer-data targeting/audience platforms;
- marketing/lifecycle campaigns;
- Product Tours;
- marketing Tooltips and Checklists;
- product-news/engagement feeds;
- promotional mobile push/carousel campaigns;
- marketing Series/journeys;
- a public App Store;
- a central public OAuth marketplace/broker;
- broad third-party integration parity for its own sake;
- autonomous AI/Fin Voice as a customer-facing voice agent.

Support-domain customer identity, organisation, entitlement/context, custom support attributes and history remain in scope.

Support-driven proactive communication is also in scope when the target set is derived from an actual support/service relationship, such as sending an incident update to tickets linked to the same service problem.

CSAT/CES after a support interaction are service-quality functions and remain in scope even though generic marketing surveys are not.

## Consequences

- Competitive gap reviews must distinguish genuine helpdesk gaps from deliberate product boundaries.
- New CRM/marketing/ecosystem features need their own product decision rather than being added for parity.
- The applet framework may expose controlled helpdesk integrations without becoming an executable app marketplace.
- Problem/incident mass updates must not evolve into arbitrary audience/campaign targeting.
- Customer profile/custom attributes must remain support-purpose data structures rather than a generic CRM object graph.

## Related

- `docs/roadmap.md`
- issue #49
- ADR-0012
- proposed ADR-0024
- proposed ADR-0027
- proposed ADR-0028

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0016-helpdesk-product-boundary.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#126](https://github.com/nathcymru/Tocyn/issues/126), [#141](https://github.com/nathcymru/Tocyn/issues/141).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
