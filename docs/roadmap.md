# Tocyn roadmap

The previous version-based roadmap in this file was superseded by the owner-approved backlog migration on 8 September 2026.

The authoritative roadmap is maintained through GitHub architectural milestones, issues/dependencies and the Wiki:

- Approved master baseline: [10 September reconciliation](planning/post-beta-2026-09-10/README.md)
- Migration receipt: https://github.com/nathcymru/Tocyn/wiki/Backlog-migration-2026-09-08
- Issues: https://github.com/nathcymru/Tocyn/issues

## Architectural phases

| Phase | Outcome family |
| --- | --- |
| M0 | Engineering, platform cost/capacity and delivery environments |
| M1 | Core data, canonical intake/webhooks and transactional mail |
| M2 | Human workspace, productivity, real-time state and headless design system |
| M3 | Governed context aggregation, triage and operator AI assistance |
| M4 | Policy-gated tool execution, autonomous resolution and human handoff |
| M5 | Roles, auditability, analytics, privacy controls and workflow administration |
| M6 | Portal/service-user experience, SLA, continuity and deterministic self-service |
| M7 | WhatsApp, Telegram, Slack, Teams and support-email integrations |
| M8 | Realtime sessions, browser media, telephony and recordings |
| M9 | Linked work, knowledge, applets, feedback/reporting and Access |

Architectural milestones describe capabilities. Git tags/releases describe tested software snapshots. They are deliberately independent.

## Accepted local beta outcome

The approved local-only human-led API/portal testing boundary was completed on
9 September 2026. The [readiness report](private-beta-readiness.md) identifies the
accepted application revision, full rehearsal, actual reader evidence and scope.
The accepted application revision was `049ea82a02571681f834bcd87d43253603edf71f`.
`v0.4.0-beta.1` was formally published on 10 September 2026, with acceptance on
9 September and PR #125 as the repository evidence. The release was local-only
synthetic API/portal/operator acceptance with local mail capture; no remote
application deployment occurred.

The next candidate, `v0.4.0-beta.2`, is future and requires the Operator Workspace
gate, including full #73 SLA clocks/calendars/pause/resume/waiting semantics and
#137 responsible-handler ownership/routing. #42 production/cutover readiness is
separate.

## Historical preserved planning forecasts (superseded)

These original forecasts remain planning history, not production commitments, and are
superseded for current sequencing by the consolidated post-beta baseline below.
Current issue/Project actual and forecast fields take precedence for delivery status:

- first human-led API/portal private beta: **21 November 2026**, historical candidate `v0.4.0-beta.1` forecast;
- support-email readiness: **4 February 2027**;
- autonomous reference-workflow readiness: **23 June 2027**;
- scoped roadmap completion: **16 July 2027**;
- no production deployment date is approved.

The original versioned roadmap and forecasts above are historical baseline material;
the consolidated [post-beta master baseline](planning/post-beta-2026-09-10/README.md)
and current issue/Project forecasts control sequencing. The owner-approved review
policy uses zero default Copilot/automated review requests and a standing owner PR
bypass only after required checks; checks are not weakened and approvals must not be
fabricated.

The first-beta blocker set is tracked by the `beta-blocker` label. Baseline schedule dates must be preserved when reforecasting so actual/forecast variance remains measurable.
