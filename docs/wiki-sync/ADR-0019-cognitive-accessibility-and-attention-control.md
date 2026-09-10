# ADR-0019 — Cognitive accessibility and attention control are product architecture requirements

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owners:** Proposed by post-beta UX review; requires project acceptance

## Context

The first beta has strong conventional accessibility foundations, including keyboard/focus/error semantics and actual screen-reader evidence. Post-beta use nevertheless shows substantial cognitive barriers: context loss, information overload, icon-only navigation, transient interruptions, motion, duplicate controls and weak resumability.

WCAG conformance is necessary but does not by itself guarantee a low-cognitive-load operator workflow. W3C cognitive accessibility guidance explicitly addresses attention, memory, comprehension and personalisation, including users with ADHD and autism.

## Decision

Tocyn adopts cognitive accessibility as a product-level design constraint alongside WCAG.

Defaults:

- healthy infrastructure is visually quiet;
- current conversation and next action dominate;
- no actionable information is available only transiently;
- state survives interruption;
- recognition is preferred to recall;
- secondary information uses progressive disclosure;
- critical actions are never hover-only;
- target sizing meets WCAG 2.2 minimums and frequent primary controls target larger comfortable hit areas;
- nonessential motion responds to `prefers-reduced-motion` and explicit user preference;
- routine interruptions are user controllable;
- labelled navigation is available and persistent;
- focus/density/font/context preferences are supported without storing diagnostic labels about the user;
- colour is not the sole state signal;
- tenant themes cannot defeat essential focus/contrast/target protections;
- keyboard shortcuts are optional accelerators, never exclusive access paths.

## Consequences

- #66 token contract expands for motion, density, typography and salience.
- #132 owns user workspace preferences/focus mode.
- #133 owns durable attention/notifications.
- #140 adds cognitive/usability acceptance rather than relying on automated accessibility scanning.
- Dense competitor UI patterns are not automatically acceptable merely because they are familiar.
- Product documentation distinguishes WCAG accessibility evidence from cognitive-usability evidence.

## Related

- W3C Cognitive Accessibility: https://www.w3.org/WAI/cognitive/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- ADR-0017
- ADR-0018
- #21 historical first-beta accessibility evidence
- #66, #71
- #132, #133, #140

## Source and current authority

Source archive: `tocyn-post-beta-ux-update-2026-09-10.zip`; original path: `tocyn-post-beta-ux-update-2026-09-10/adrs/ADR-0018-cognitive-accessibility-and-attention-control.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#132](https://github.com/nathcymru/Tocyn/issues/132), [#140](https://github.com/nathcymru/Tocyn/issues/140).

The [approved master decisions](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
