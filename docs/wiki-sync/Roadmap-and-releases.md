# Roadmap and releases

Tocyn separates **architecture**, **work**, **readiness** and **releases**:

- architecture/capability completion → GitHub milestones `M0.x`–`M9.x`;
- implementation work → GitHub issues and dependencies;
- release readiness → cross-cutting labels such as `beta-blocker`;
- deployable snapshots → SemVer Git tags and GitHub Releases.

Version-number milestones (`v0.1.0`, `v0.2.0`, `v0.3.0`, `v0.4.0`) were superseded on 8 September 2026 and remain historical only.

## Architectural phases

| Phase | Focus |
| --- | --- |
| M0 | Engineering quality, cost/capacity and delivery environments |
| M1 | Core data model, intake, ticket-feed validation and transactional mail |
| M2 | Human workspace, productivity, real-time state and design system |
| M3 | Context aggregation, triage/summarisation and operator AI assistance |
| M4 | Tool boundaries, autonomous reference resolution and human handoff |
| M5 | Authorisation, audit/oversight, analytics, privacy and workflow administration |
| M6 | Portal/service-user experience, SLA, cross-channel continuity, deterministic self-service |
| M7 | WhatsApp, Telegram, Slack, Teams and support-email integrations |
| M8 | Realtime support sessions, browser media, telephony and recording |
| M9 | Linked work, knowledge, applets, feedback/reporting and Access |

Full milestone membership and target dates are maintained on [[Approved-architectural-roadmap]].

## First private beta

Accepted application: `049ea82a02571681f834bcd87d43253603edf71f`.
`v0.4.0-beta.1` was accepted on 9 September 2026 and formally published on 10
September 2026, with PR #125 as repository evidence. It was local-only synthetic
API/portal/operator acceptance with local mail capture; no remote application
deployment occurred.

Future candidate: `v0.4.0-beta.2`, gated by the Operator Workspace acceptance,
including full SLA clocks/calendars/pause/resume/waiting semantics and responsible-
handler ownership/routing (#73/#137). Production/cutover #42 remains separate.

Purpose: prove the core multi-tenant API/portal conversation flow with human operators and isolated test tenants. Slack, full support email and autonomous customer-backend resolution are not first-beta prerequisites unless future implementation evidence requires a roadmap change.

The authoritative beta-blocker set is the GitHub `beta-blocker` label, not this prose page.

## Release convention

Use SemVer prerelease tags such as `v0.4.0-beta.1`, `v0.4.0-beta.2` or `v0.4.0-rc.1` only for actual tested snapshots. Do not mechanically increment a version because an architectural milestone closed.

No production deployment date is currently committed.

The consolidated baseline forecasts `beta.2` acceptance for 18 February 2027 and
expanded scope for 9 February 2028. These are forecasts, not release promises.
The owner-approved review policy uses zero default Copilot/automated review requests
and a standing owner PR bypass only after required checks; required checks and
security evidence remain mandatory.

## Living schedule

Project planning preserves baseline dates separately from forecasts and actual dates. Reforecasting must not overwrite the original approved baseline. See ADR-0014 and repository `AGENTS.md`.
