# ADR-0020 — Operator AI augments existing human workflows instead of creating a parallel UI

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owners:** Proposed by post-beta UX review; requires project acceptance

## Context

The beta ticket detail exposes an `AI Suggestion` action which creates a separate AI Auto-Draft card with Replace/Append controls. This introduces another visual region and interaction mode into an already dense page.

Tocyn's architecture already requires AI-off human operation, explicit operator control and later governed action boundaries. A separate AI-centric workspace is unnecessary for normal support work.

## Decision

Human-operator AI is optional augmentation of the same conversation, context and draft surfaces.

Permitted patterns include:

- summarise conversation;
- draft a reply into the existing composer;
- improve/clarify selected or drafted text;
- shorten;
- change tone;
- translate;
- find/cite relevant authorised knowledge/runbook context.

AI output:

- never auto-sends a human operator reply;
- never silently mutates ticket state;
- is previewed/accepted by the operator;
- preserves provenance/freshness where external/knowledge context is used;
- does not replace original customer content;
- fails closed to the complete normal human workflow when unavailable.

Future governed autonomous actions remain controlled by ADR-0010 and M4. This ADR concerns operator assistance, not expansion of autonomous authority.

## Consequences

- #76 summary UI is progressive/contextual.
- #77 writing/translation/runbook features integrate with composer/context.
- #68 exposes stable extension points in shared composer.
- Legacy separate AI suggestion/card presentation can retire after parity.
- AI-disabled acceptance remains mandatory in workspace release gates.

## Related

- ADR-0010 — Policy-gated actions and reference validation
- ADR-0017
- #68, #75, #76, #77, #80–#83

## Source and current authority

Source archive: `tocyn-post-beta-ux-update-2026-09-10.zip`; original path: `tocyn-post-beta-ux-update-2026-09-10/adrs/ADR-0019-operator-ai-augments-human-workflows.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#68](https://github.com/nathcymru/Tocyn/issues/68), [#76](https://github.com/nathcymru/Tocyn/issues/76), [#77](https://github.com/nathcymru/Tocyn/issues/77).

The [approved master decisions](../planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
