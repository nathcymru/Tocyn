# ADR-0011: Architectural milestones and an API/portal-first private beta

Status: Accepted by the owner, 8 September 2026; backlog migration only, implementation pending.

## Decision

Use M0.x engineering/platform/delivery and M1–M7 architectural capability milestones. Preserve and supersede historical version milestones rather than delete history. Keep releases/tags independent and SemVer prereleases based on tested content. #49 is a cross-roadmap tracker with no architectural milestone. Do not create a duplicate Project when visibility is unresolved.

The first private beta proves two-tenant API/portal intake, canonical persistence, human handling and return path, tenant isolation, attributable audit history, authentication and reproducible isolated deployment. Use invited users, synthetic/test data and isolated temporary Resend authentication mail. Optional AI must be disableable. Slack and other external adapters, inbound support email, native-mail migration, autonomous resolution and advanced analytics do not block this beta.

N37 provides narrow beta resource guardrails without requiring the full #50/N08/N34 programme. Do not weaken security, accepted-message durability or recovery. Bounded workload admission is not a zero-bill guarantee. N08 reuses rather than duplicates the guardrails. #21 accessibility acceptance is bounded to beta-included workflows; every later UI issue owns its new accessibility acceptance.

Separate preview/beta environments (M0.3) from production readiness (M0.4). Foundation conversation audit events belong in M1.1, not agent oversight M5.2. Portal, service status/SLA, cross-channel continuity and deterministic self-service have separate M6 completion points.

Authorisation is independent of CSS/theming. Support-email conversation behaviour is independent of transactional authentication-mail migration: the existing injectable transport enables separate work, with shared-code compatibility testing. The preferred native transport remains a later objective.

## Scheduling and consequences

Retain 8 productive hours/day, Monday–Saturday, mandatory 3× estimates, two bounded workstreams and shared review/integration capacity. Forecast capacity, not continuous reviewer consumption. Review meaningful PR boundaries and consolidate fixes. Code-owned declarative reference workflows precede visual authoring. No production date is implied.

First beta candidate v0.4.0-beta.1: 2026-11-21. Support email: 2027-02-04. Autonomous reference workflow: 2027-06-23. Scoped roadmap: 2027-07-16. Dates are forecasts under the approved assumptions, not completed releases.

Exact beta blockers: [#20](https://github.com/nathcymru/Tocyn/issues/20), [#57](https://github.com/nathcymru/Tocyn/issues/57), [#58](https://github.com/nathcymru/Tocyn/issues/58), [#19](https://github.com/nathcymru/Tocyn/issues/19), [#59](https://github.com/nathcymru/Tocyn/issues/59), [#60](https://github.com/nathcymru/Tocyn/issues/60), [#63](https://github.com/nathcymru/Tocyn/issues/63), [#61](https://github.com/nathcymru/Tocyn/issues/61), [#62](https://github.com/nathcymru/Tocyn/issues/62), [#21](https://github.com/nathcymru/Tocyn/issues/21), [#93](https://github.com/nathcymru/Tocyn/issues/93), [#65](https://github.com/nathcymru/Tocyn/issues/65).

[Full schedule and actual issue mapping](Approved-architectural-roadmap). [Historical reconciliation](Backlog-migration-2026-09-08).


## Owner addendum — 10 September 2026

[[Post-beta-master-baseline]] controls current sequencing and review policy. Accepted architecture remains; governed actions #79/#80/#81 are implementation pending. Beta.1 is published local-only at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full #73 SLA and #137 ownership/routing. M8/M9 are accepted direction, implementation pending. Historical dates above remain evidence; current calculated forecasts do not replace baseline history. Zero default Copilot reviews; owner PR-only review bypass after substantive checks, signing and thread resolution.
