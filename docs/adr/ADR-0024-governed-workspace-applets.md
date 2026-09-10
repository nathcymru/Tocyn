# ADR-0024 — Operator applets are declarative views over governed Tocyn capabilities

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026

## Context

Operators benefit from small context-specific tools inside a support conversation: account status, order detail, diagnostic state, guided escalation, replacement/refund forms and similar workflows.

A conventional plugin marketplace with arbitrary JavaScript, embedded secrets and per-app OAuth would materially increase supply-chain, tenant-isolation, CSP and governance risk. Tocyn already plans headless UI primitives, governed context reads, typed actions, policy gates, action-bound approvals and visual workflow administration.

## Decision

Tocyn will provide a versioned **declarative operator applet** format.

An applet definition is data, not executable tenant code. It may compose an allowlisted set of Tocyn UI nodes and bind them to:

- canonical conversation/ticket context;
- authorised read connectors;
- typed governed tools;
- published governed workflows.

Supported presentation surfaces may include:

- conversation sidebar;
- conversation timeline;
- composer recipe/slash-command entry.

Every mutating action continues through the existing capability, policy, approval, execution and result-verification path. An applet cannot lower a tool risk class, supply hidden credentials or grant permission.

The runtime will not accept arbitrary JavaScript, arbitrary HTML/CSS, external executable packages or embedded integration secrets.

Applet definitions are tenant-scoped, schema validated, versioned and moved through draft/published/retired states. Publishing and rollback are audited.

No public App Store or central OAuth marketplace is created by this decision.

## Consequences

- Tocyn gains Canvas-like operator extensibility without a second execution engine.
- #78 workflow authoring and #80/#81 action governance remain authoritative.
- #48 primitives and `--tocyn-*` tokens remain the presentation foundation.
- Applet schema versions become public compatibility contracts and need migration rules.
- Connectors/credentials are configured through Tocyn's controlled integration layer and referenced by ID, not embedded in applet definitions.
- CSP and tenant isolation are materially simpler than arbitrary plugin execution.

## Related

- ADR-0010 — Policy-gated actions and reference validation
- issue #48
- issues #68, #75, #78, #79, #80, #81
- approved M9.3

## Source and current authority

Source archive: `tocyn-product-gap-change-package-2026-09-10.zip`; original path: `tocyn-product-gap-change-package-2026-09-10/adrs/ADR-0018-governed-declarative-operator-applets.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#153](https://github.com/nathcymru/Tocyn/issues/153), [#154](https://github.com/nathcymru/Tocyn/issues/154).

The [approved master decisions](../planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
