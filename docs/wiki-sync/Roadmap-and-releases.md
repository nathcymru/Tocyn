# Roadmap and releases

Tocyn separates **architecture**, **work**, **readiness** and **releases**:

- architecture/capability completion → GitHub milestones `M0.x`–`M7.x`;
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

Full milestone membership and target dates are maintained on [[Approved-architectural-roadmap]].

## First private beta

Candidate: `v0.4.0-beta.1` (not yet created)

Forecast: **21 November 2026**

Purpose: prove the core multi-tenant API/portal conversation flow with human operators and isolated test tenants. Slack, full support email and autonomous customer-backend resolution are not first-beta prerequisites unless future implementation evidence requires a roadmap change.

The authoritative beta-blocker set is the GitHub `beta-blocker` label, not this prose page.

## Release convention

Use SemVer prerelease tags such as `v0.4.0-beta.1`, `v0.4.0-beta.2` or `v0.4.0-rc.1` only for actual tested snapshots. Do not mechanically increment a version because an architectural milestone closed.

No production deployment date is currently committed.

## Living schedule

Project planning preserves baseline dates separately from forecasts and actual dates. Reforecasting must not overwrite the original approved baseline. See ADR-0014 and repository `AGENTS.md`.
