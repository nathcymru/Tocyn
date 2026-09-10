# Post-beta master development baseline

This page summarizes the owner-approved consolidation under [issue #126](https://github.com/nathcymru/Tocyn/issues/126). The repository planning source is maintained with the repository; this Wiki mirror is navigation, not a second authority.

The accepted local human-led API/portal beta used application revision `049ea82a02571681f834bcd87d43253603edf71f`, was accepted on 9 September 2026 and formally published as `v0.4.0-beta.1` on 10 September 2026 with PR #125 evidence. It used synthetic data and local mail capture; no remote application deployment occurred.

Future `v0.4.0-beta.2` requires the Operator Workspace gate, including full #73 SLA clocks/calendars/pause/resume/waiting semantics and #137 responsible-handler ownership/routing, together with durable drafts, activity, snooze, accessible triage, collision/retry safety, AI-off operation and tenant-isolation evidence. #42 production/cutover readiness remains separate.

The consolidated baseline retains all approved UX, product-gap and hardening requirements. It permits independent workspace, cost, residency and platform foundations to proceed in parallel. It does not authorize feature deployment, provider setup, external mail, API billing or remote resources. The review policy uses zero default Copilot/automated review requests and a standing owner PR bypass only after required checks; security, accessibility, tenant-isolation and release checks remain mandatory.

## Accepted ADRs

See the [ADR synchronization addendum](Architecture-decision-records-addendum.md) and mirrored ADR-0016–ADR-0028 pages.
