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

The original alignment forecast was `beta.2` acceptance on 18 February 2027 and
expanded scope on 9 February 2028; retain those values as history. The current
accepted [forecast ledger](https://github.com/nathcymru/Tocyn/blob/4fce7b6654db924d818d2ee2ad77d3c855ee9d46/docs/planning/post-beta-2026-09-10/forecast.json)
records the earlier **22 January 2027** and **21 January 2028** forecast, after evidenced
completion was incorporated in PR #171. This is the same conservative two-workstream
model, not a new baseline or a release promise. No further date change is inferred
from the partial work described below.
The owner-approved review policy uses zero default Copilot/automated review requests
and a standing owner PR bypass only after required checks; required checks and
security evidence remain mandatory.

## Living schedule

After accepted #48 integration, the same conservative model recalculates beta.2 to **23 January 2027** and expanded scope to **11 January 2028**. The two-lane scheduling order accounts for the one-day beta movement; original baselines remain immutable. The updated reproducible ledger is included with the ongoing #129 delivery record.

Project planning preserves baseline dates separately from forecasts and actual dates. Reforecasting must not overwrite the original approved baseline. See ADR-0014 and repository `AGENTS.md`.

## Delivery snapshot — 10 September 2026

Beta.2 is **not ready**. Accepted main is `32fba86fd659ca9d729ff8d0ff683b4770e81454`.

- [#48 / PR #167](https://github.com/nathcymru/Tocyn/pull/167) is accepted: retained shared controls, public TypeScript contracts, security/retry recovery, corrected built-widget styles, scoped browser/VoiceOver evidence and numeric performance gates. Exact-revision CI/security passed; the verified signed merge tree matches the reviewed head and CI runner. Owner review-only bypass was recorded, with zero Copilot reviews. Themes (#66), wrapper lifecycle (#67) and the persistent workspace (#128) retain separate acceptance.
- [#159 / PR #170](https://github.com/nathcymru/Tocyn/pull/170) merged as a **partial foundation** after required checks and a verified signed integration. Privacy-safe local diagnostics, bounded resource accounting, credential decisions and canonical mutation summaries are on main. #159 remains open for full active-path coverage and remaining runtime evidence; production telemetry stays disabled under #42. The owner-authorised review-only bypass was recorded; no independent human approval or Copilot review is claimed.

- [#129 / PR #173](https://github.com/nathcymru/Tocyn/pull/173) merged as a **partial delivery** at signed commit33dfe0b. Tenant/operator-scoped drafts, composer autosave/restore, attachment persistence, guarded navigation, conditional send cleanup, list preferences and bounded Draft indicators are integrated. Required CI/security and initialized local-beta browser checks pass; workspace writes retain atomic mutation-budget enforcement. The browser harness uses Node application routes with real Miniflare D1/R2, not a deployed full Worker runtime. Selected-ticket/panel integration and approved retention remain outstanding under129; full Drafts-view semantics remain130 and durable send idempotency131. No production expiry, scheduler, remote migration or beta.2 readiness is claimed. The owner-authorised review-only bypass was recorded; zero Copilot review requests.

Issue receipts, Project status and each branch's `.agents/state/` provide current
operational details; this dated snapshot does not replace their acceptance records.
The workspace, full SLA clocks/calendars/waiting/pause behavior and ownership/routing
remain mandatory before #140 can accept beta.2. No new release or remote deployment
has occurred. Zero routine Copilot reviews; required validation remains mandatory.
