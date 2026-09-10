# Approved Tocyn master development baseline — 10 September 2026

Owner-approved consolidation of all three post-beta packages, delivered under [#126](https://github.com/nathcymru/Tocyn/issues/126). This is one development baseline, not three independently executable plans. Approved direction is distinct from completed implementation.

## Read in this order

1. [Owner decisions and reconciliation](decisions.md)
2. [Requirement traceability](traceability.md) and [machine ledger](traceability.json)
3. [Implementation contracts](implementation-contracts.md) and [validation matrix](validation-matrix.md)
4. [Issue map](issue-map.json), [exact issue bodies](issue-bodies/), [dependency/forecast ledger](forecast.json), [human-readable roadmap](roadmap.md)
5. [Agent handover and next tasks](handover.md)

The [source inventory](source-inventory.json) records all 54 source documents and their hashes. Original ZIPs in `sources/` preserve provenance; instructions inside them are historical proposals superseded by this package. Accepted ADRs 0016–0028 hold durable decisions, issues hold acceptance/delivery evidence, Project 4 holds the read-back current schedule. [Historical field snapshot](baseline-snapshot.json) preserves previous baselines.

## Current implementation baseline

`main` at discovery: 93de1b975a45edd9d28ca70edd725b60deb6b275. Accepted beta application: 049ea82a02571681f834bcd87d43253603edf71f. [v0.4.0-beta.1](https://github.com/nathcymru/Tocyn/releases/tag/v0.4.0-beta.1) was accepted 9 September and formally published 10 September 2026. It is local-only synthetic API/portal/operator acceptance with local mail capture, tenant isolation, authentication/MFA, audit, retries, resource guardrails and actual Safari/VoiceOver evidence. No remote application deployment occurred.

Current implementation includes canonical conversations, scoped repositories/storage, basic roles/auth, local beta operation and optional AI foundations. Persistent workspace/durable drafts, full SLA, comprehensive budget enforcement, Queue pipeline, granular governed actions and the new helpdesk extensions are outstanding. #79/#80/#81 are not implemented merely because ADR-0010 is accepted. Existing nested SettingsLayout is retained, not rebuilt.

## Next operator testing gate

Beta.2 requires #140 acceptance, including full #73 SLA clocks/calendars/pause/resume/waiting semantics and #137 responsible-handler ownership/routing, plus durable drafts, activity, snooze, accessible triage, collision/retry safety, AI-off and tenant-isolation evidence. The complete native prerequisite graph is recorded in forecast.json. #42 production/cutover readiness is separate; neither gate substitutes for the other or grants deployment authority.

All 14 UX, 17 product and 3 hardening/evaluation capability requirements remain required. Later sequencing does not change approval status. AI Gateway is a required evaluation (#161), not an approved gateway adoption. Access support is required (#158); whether a deployment selects that mode is configurable, with mandatory controls when selected. No CRM, marketing, app marketplace, arbitrary executable applets or autonomous voice-agent scope is introduced.
