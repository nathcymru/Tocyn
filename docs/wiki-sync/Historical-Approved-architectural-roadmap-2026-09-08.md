> Historical planning evidence. Superseded for active sequencing by [[Post-beta-master-baseline]]. Original dates and scope below are preserved, not current instructions.

# Approved architectural roadmap

Approved by the repository owner on 8 September 2026, including the three final dependency corrections. Implementation pending. This replaces version-based milestone scheduling, not completed source work or historical decisions.

## Release boundary

First private beta forecast: **21 November 2026**; candidate **v0.4.0-beta.1**. Two isolated test tenants, invited users, API/portal intake, canonical conversation persistence, human operator handling and replies, attributable audit events, required authentication and isolated temporary Resend credentials. AI is optional and the workflow must work without it. No Slack, Teams, WhatsApp, Telegram, support email, native-mail migration or autonomous resolution is required for this beta.

N37 provides only minimum beta resource safety; #50/N08/N34 retain the broader cost programme without beta-blocker. #21 covers only beta-included workflows; later UI owns its own accessibility. A label is a release-readiness gate, not a milestone. No release/tag is created by this migration.

Support-email readiness: **4 February 2027**. Autonomous reference-workflow readiness: **23 June 2027**. Scoped roadmap forecast: **16 July 2027**. No production deployment date is set; M0.4 describes readiness work only.

## Capacity and dependencies

Planning start 2026-09-08; Monday–Saturday, eight productive hours/day. Every baseline estimate is multiplied by exactly three. Two bounded agent-assisted workstreams with at most two issues in progress through integration; one shared four-hour/day review/integration capacity. Within 3×, 2.5× is implementation/automated validation and 0.5× review/corrections/integration. Total **1,128 baseline hours / 3,384 planning hours**. No historical estimates are invented. Holidays and external provider approval waits are not deducted.

This is a capacity forecast, not a requirement to maintain continuous review loops. Review meaningful PR boundaries; consolidate corrections before rereview and avoid unnecessary metered review calls. Dependencies are available after integration; integration-only holds are listed separately from architecture. No unlimited staffing or artificial review queue is assumed.

Final corrections: N26 consumes a typed, versioned, bounded code-owned declarative definition and never depends on visual authoring. N22 in M5.5 consumes that proven definition/executor. N33 is independent of #18; shared injectable email transport needs compatibility tests, not migration completion. N23 security enforcement is independent of N10 and can use the existing UI. #49 has no architectural milestone.

## Architectural milestones

Each milestone owns the listed issues, excludes other milestones' implementation and release/deployment execution, and closes after acceptance checks, a reproducible demonstration, documentation and limitations. Existing implemented tenancy/API/portal/notes/presence/R2/RAG foundations are extended, not rebuilt.

| Milestone | Start | Completion | Closed / future at migration | Demonstration |
|---|---|---|---|---|
| [M0.1: Engineering - Repository Quality](https://github.com/nathcymru/Tocyn/milestone/5) | 2026-09-08 | 2026-12-03 | 1 / 6 | Reproducible contribution and enforceable checks |
| [M0.2: Platform - Cost & Capacity](https://github.com/nathcymru/Tocyn/milestone/6) | 2026-09-08 | 2027-01-20 | 0 / 3 | Enforced owner ceilings and restricted tenant controls |
| [M0.3: Delivery - Preview & Beta Environments](https://github.com/nathcymru/Tocyn/milestone/7) | 2026-09-11 | 2026-11-21 | 0 / 3 | Isolated API/portal beta, narrow resource guardrails and release rehearsal |
| [M0.4: Delivery - Production Readiness](https://github.com/nathcymru/Tocyn/milestone/8) | 2026-12-03 | 2026-12-10 | 0 / 1 | Migration, backup/restore and rollback readiness; no production deployment date |
| [M1.1: Backend - Core Data Model](https://github.com/nathcymru/Tocyn/milestone/9) | 2026-09-23 | 2026-12-28 | 0 / 5 | Scoped canonical records, attributable events and reliable persistence under retries |
| [M1.2: Backend - API Intake & Webhooks](https://github.com/nathcymru/Tocyn/milestone/10) | 2026-10-15 | 2027-03-18 | 0 / 6 | Authenticated intake, recoverable processing and reliable outbound delivery |
| [M1.3: Frontend - Ticket Feed Validation](https://github.com/nathcymru/Tocyn/milestone/11) | 2026-11-02 | 2026-11-07 | 0 / 1 | API/portal tickets appear and can be handled by a human operator |
| [M1.4: Backend - Transactional Mail](https://github.com/nathcymru/Tocyn/milestone/12) | 2027-01-21 | 2027-01-28 | 0 / 1 | Cloudflare-native authentication/transactional transport parity |
| [M2.1: Frontend - Workspace Layout & Routing](https://github.com/nathcymru/Tocyn/milestone/13) | 2026-11-07 | 2027-02-11 | 0 / 2 | Accessible core workflows and keyboard-first triage |
| [M2.2: Frontend - Conversation Composer & Productivity](https://github.com/nathcymru/Tocyn/milestone/14) | 2027-01-29 | 2027-02-15 | 0 / 2 | Compose realistic technical responses and reuse safe content |
| [M2.3: Fullstack - Real-Time State & Presence](https://github.com/nathcymru/Tocyn/milestone/15) | 2027-02-11 | 2027-03-06 | 0 / 2 | Two operators collaborate without silent conflicting changes |
| [M2.4: Frontend - Headless Design System](https://github.com/nathcymru/Tocyn/milestone/16) | 2026-12-03 | 2027-01-12 | 0 / 3 | Shared primitives, CSS variables and isolated optional embeds |
| [M3.1: Backend - Context & Data Aggregation](https://github.com/nathcymru/Tocyn/milestone/17) | 2027-04-22 | 2027-05-03 | 0 / 1 | Authorised health/log context enriches intake with provenance |
| [M3.2: Agent - Triage & Summarisation](https://github.com/nathcymru/Tocyn/milestone/18) | 2027-05-04 | 2027-05-18 | 0 / 1 | Bounded enrichment with deterministic fallback |
| [M3.3: Frontend - Operator AI Assistance](https://github.com/nathcymru/Tocyn/milestone/19) | 2027-05-19 | 2027-05-28 | 0 / 1 | Human-reviewed drafts, translations and runbook assistance |
| [M4.1: Agent - Tool Boundaries & Execution Sandbox](https://github.com/nathcymru/Tocyn/milestone/20) | 2027-04-26 | 2027-05-26 | 0 / 2 | Reference actions demonstrate allow, approval and deny paths |
| [M4.2: Agent - Autonomous Resolution Loop](https://github.com/nathcymru/Tocyn/milestone/21) | 2027-06-08 | 2027-06-23 | 0 / 1 | A code-owned declarative workflow safely resolves a reference-service ticket |
| [M4.3: Fullstack - Contextual Human Handoff](https://github.com/nathcymru/Tocyn/milestone/22) | 2027-05-27 | 2027-06-07 | 0 / 1 | Failure or takeover stops automation and preserves context |
| [M5.1: Fullstack - Roles & Authorisation](https://github.com/nathcymru/Tocyn/milestone/23) | 2027-04-09 | 2027-04-21 | 1 / 1 | Human and agent capabilities enforce an owner authority ceiling |
| [M5.2: Fullstack - Agent Auditability & Oversight](https://github.com/nathcymru/Tocyn/milestone/24) | 2027-06-24 | 2027-07-05 | 0 / 1 | Review observable agent evidence and quality-assurance outcomes |
| [M5.3: Frontend - Operational Analytics](https://github.com/nathcymru/Tocyn/milestone/25) | 2027-07-06 | 2027-07-16 | 0 / 1 | Metrics reconcile to known fixture events |
| [M5.4: Fullstack - Privacy Metadata & Controls](https://github.com/nathcymru/Tocyn/milestone/26) | 2027-04-05 | 2027-04-24 | 0 / 2 | Measured Fides coverage and safe optional functionality |
| [M5.5: Frontend - Workflow Administration](https://github.com/nathcymru/Tocyn/milestone/27) | 2027-06-24 | 2027-07-09 | 0 / 1 | Visually author, validate, dry-run, version and publish proven governed workflows |
| [M6.1: Frontend - Portal Conversation Experience](https://github.com/nathcymru/Tocyn/milestone/28) | 2026-10-31 | 2026-11-05 | 0 / 1 | Authenticated portal conversation lifecycle |
| [M6.2: Frontend - Service Status & SLA](https://github.com/nathcymru/Tocyn/milestone/29) | 2027-02-16 | 2027-02-26 | 0 / 1 | Customer-visible service state, responsible handler and SLA progress |
| [M6.3: Fullstack - Cross-Channel Continuity](https://github.com/nathcymru/Tocyn/milestone/30) | 2027-02-27 | 2027-03-10 | 0 / 1 | Verified identity linking retains context across channels |
| [M6.4: Fullstack - Deterministic Self-Service](https://github.com/nathcymru/Tocyn/milestone/31) | 2027-06-08 | 2027-06-18 | 0 / 1 | Customers execute authorised reference actions through the same policy gate |
| [M7.1: Integration - WhatsApp](https://github.com/nathcymru/Tocyn/milestone/32) | 2027-03-19 | 2027-04-03 | 0 / 1 | Bidirectional messaging with dispatch-time reply-window enforcement |
| [M7.2: Integration - Telegram](https://github.com/nathcymru/Tocyn/milestone/33) | 2027-04-01 | 2027-04-08 | 0 / 1 | Private/group conversations and migrations route correctly |
| [M7.3: Integration - Slack](https://github.com/nathcymru/Tocyn/milestone/34) | 2027-01-13 | 2027-01-23 | 0 / 1 | Verified inbound messages and threaded operator replies |
| [M7.4: Integration - Microsoft Teams](https://github.com/nathcymru/Tocyn/milestone/35) | 2027-03-16 | 2027-03-31 | 0 / 1 | Authenticated activities and replies retain conversation context |
| [M7.5: Integration - Support Email](https://github.com/nathcymru/Tocyn/milestone/36) | 2027-01-25 | 2027-02-04 | 0 / 1 | Verified canonical support-email ingestion, threading and reply delivery |

## Exact first-beta blocker set

[#20](https://github.com/nathcymru/Tocyn/issues/20), [#57](https://github.com/nathcymru/Tocyn/issues/57), [#58](https://github.com/nathcymru/Tocyn/issues/58), [#19](https://github.com/nathcymru/Tocyn/issues/19), [#59](https://github.com/nathcymru/Tocyn/issues/59), [#60](https://github.com/nathcymru/Tocyn/issues/60), [#63](https://github.com/nathcymru/Tocyn/issues/63), [#61](https://github.com/nathcymru/Tocyn/issues/61), [#62](https://github.com/nathcymru/Tocyn/issues/62), [#21](https://github.com/nathcymru/Tocyn/issues/21), [#93](https://github.com/nathcymru/Tocyn/issues/93), [#65](https://github.com/nathcymru/Tocyn/issues/65)

## Issue schedule

| Issue | Outcome | Milestone | Baseline / 3× hours | Start | Completion | Dependencies | Integration constraints | Beta blocker |
|---|---|---|---|---|---|---|---|---|
| [#20](https://github.com/nathcymru/Tocyn/issues/20) | Verify reproducible local contributor setup | M0.1 | 8 / 24 | 2026-09-08 | 2026-09-10 | Baseline | None | Yes |
| [#50](https://github.com/nathcymru/Tocyn/issues/50) | Define enforceable cost policies and resource budgets | M0.2 | 16 / 48 | 2026-09-08 | 2026-09-15 | Baseline | None | No |
| [#57](https://github.com/nathcymru/Tocyn/issues/57) | Establish isolated preview and beta deployments | M0.3 | 24 / 72 | 2026-09-11 | 2026-09-22 | [#20](https://github.com/nathcymru/Tocyn/issues/20) | None | Yes |
| [#12](https://github.com/nathcymru/Tocyn/issues/12) | Verify required checks on dependency-only pull requests | M0.1 | 8 / 24 | 2026-09-16 | 2026-09-18 | Baseline | None | No |
| [#58](https://github.com/nathcymru/Tocyn/issues/58) | Provision isolated test tenants reproducibly | M1.1 | 12 / 36 | 2026-09-23 | 2026-09-28 | [#57](https://github.com/nathcymru/Tocyn/issues/57) | None | Yes |
| [#19](https://github.com/nathcymru/Tocyn/issues/19) | Complete tenant-isolation acceptance coverage | M1.1 | 16 / 48 | 2026-09-29 | 2026-10-06 | [#58](https://github.com/nathcymru/Tocyn/issues/58) | None | Yes |
| [#59](https://github.com/nathcymru/Tocyn/issues/59) | Map API and portal intake onto canonical conversation contracts | M1.1 | 16 / 48 | 2026-10-07 | 2026-10-14 | [#19](https://github.com/nathcymru/Tocyn/issues/19) | None | Yes |
| [#60](https://github.com/nathcymru/Tocyn/issues/60) | Make API and portal mutations validated and retry-safe | M1.2 | 16 / 48 | 2026-10-15 | 2026-10-22 | [#59](https://github.com/nathcymru/Tocyn/issues/59) | None | Yes |
| [#91](https://github.com/nathcymru/Tocyn/issues/91) | Recover accepted payloads through durable storage journals | M1.2 | 24 / 72 | 2026-10-15 | 2026-10-26 | [#50](https://github.com/nathcymru/Tocyn/issues/50), [#59](https://github.com/nathcymru/Tocyn/issues/59) | None | No |
| [#63](https://github.com/nathcymru/Tocyn/issues/63) | Record attributable ticket and conversation audit events | M1.1 | 16 / 48 | 2026-10-23 | 2026-10-30 | [#59](https://github.com/nathcymru/Tocyn/issues/59) | [#60](https://github.com/nathcymru/Tocyn/issues/60) | Yes |
| [#93](https://github.com/nathcymru/Tocyn/issues/93) | Enforce private-beta resource guardrails | M0.3 | 8 / 24 | 2026-10-27 | 2026-10-31 | [#57](https://github.com/nathcymru/Tocyn/issues/57), [#60](https://github.com/nathcymru/Tocyn/issues/60) | None | Yes |
| [#61](https://github.com/nathcymru/Tocyn/issues/61) | Validate authenticated portal conversations end to end | M6.1 | 12 / 36 | 2026-10-31 | 2026-11-05 | [#60](https://github.com/nathcymru/Tocyn/issues/60), [#63](https://github.com/nathcymru/Tocyn/issues/63) | None | Yes |
| [#62](https://github.com/nathcymru/Tocyn/issues/62) | Validate human handling of canonical ticket intake | M1.3 | 12 / 36 | 2026-11-02 | 2026-11-07 | [#60](https://github.com/nathcymru/Tocyn/issues/60), [#63](https://github.com/nathcymru/Tocyn/issues/63) | None | Yes |
| [#64](https://github.com/nathcymru/Tocyn/issues/64) | Enforce resource budgets across active application paths | M0.2 | 16 / 48 | 2026-11-06 | 2026-11-16 | [#50](https://github.com/nathcymru/Tocyn/issues/50), [#60](https://github.com/nathcymru/Tocyn/issues/60), [#93](https://github.com/nathcymru/Tocyn/issues/93) | None | No |
| [#21](https://github.com/nathcymru/Tocyn/issues/21) | Validate accessibility of core operator and portal workflows | M2.1 | 12 / 36 | 2026-11-07 | 2026-11-13 | [#61](https://github.com/nathcymru/Tocyn/issues/61), [#62](https://github.com/nathcymru/Tocyn/issues/62) | None | Yes |
| [#65](https://github.com/nathcymru/Tocyn/issues/65) | Rehearse and publish the human-led private beta | M0.3 | 16 / 48 | 2026-11-13 | 2026-11-21 | [#57](https://github.com/nathcymru/Tocyn/issues/57), [#58](https://github.com/nathcymru/Tocyn/issues/58), [#19](https://github.com/nathcymru/Tocyn/issues/19), [#60](https://github.com/nathcymru/Tocyn/issues/60), [#61](https://github.com/nathcymru/Tocyn/issues/61), [#62](https://github.com/nathcymru/Tocyn/issues/62), [#63](https://github.com/nathcymru/Tocyn/issues/63), [#21](https://github.com/nathcymru/Tocyn/issues/21), [#93](https://github.com/nathcymru/Tocyn/issues/93) | None | Yes |
| [#51](https://github.com/nathcymru/Tocyn/issues/51) | Implement authenticated durable webhook ingress | M1.2 | 24 / 72 | 2026-11-16 | 2026-11-28 | [#50](https://github.com/nathcymru/Tocyn/issues/50), [#64](https://github.com/nathcymru/Tocyn/issues/64), [#91](https://github.com/nathcymru/Tocyn/issues/91) | None | No |
| [#14](https://github.com/nathcymru/Tocyn/issues/14) | Standardise repository formatting and lint conventions | M0.1 | 8 / 24 | 2026-11-21 | 2026-11-25 | Baseline | [#65](https://github.com/nathcymru/Tocyn/issues/65) | No |
| [#44](https://github.com/nathcymru/Tocyn/issues/44) | Retire inactive services while preserving regression coverage | M0.1 | 8 / 24 | 2026-11-26 | 2026-11-30 | [#14](https://github.com/nathcymru/Tocyn/issues/14) | [#65](https://github.com/nathcymru/Tocyn/issues/65) | No |
| [#45](https://github.com/nathcymru/Tocyn/issues/45) | Evaluate deferred major dependency and Actions upgrades | M0.1 | 8 / 24 | 2026-11-30 | 2026-12-02 | [#12](https://github.com/nathcymru/Tocyn/issues/12) | [#65](https://github.com/nathcymru/Tocyn/issues/65) | No |
| [#22](https://github.com/nathcymru/Tocyn/issues/22) | Complete remaining repository launch administration | M0.1 | 6 / 18 | 2026-12-01 | 2026-12-03 | [#65](https://github.com/nathcymru/Tocyn/issues/65) | None | No |
| [#42](https://github.com/nathcymru/Tocyn/issues/42) | Validate production cutover and rollback readiness | M0.4 | 16 / 48 | 2026-12-03 | 2026-12-10 | [#65](https://github.com/nathcymru/Tocyn/issues/65) | None | No |
| [#48](https://github.com/nathcymru/Tocyn/issues/48) | Establish shared headless primitives for standalone Tocyn | M2.4 | 40 / 120 | 2026-12-03 | 2026-12-23 | Baseline | [#65](https://github.com/nathcymru/Tocyn/issues/65) | No |
| [#87](https://github.com/nathcymru/Tocyn/issues/87) | Normalise provider events into reliable conversation state | M1.1 | 32 / 96 | 2026-12-11 | 2026-12-28 | [#59](https://github.com/nathcymru/Tocyn/issues/59), [#91](https://github.com/nathcymru/Tocyn/issues/91), [#51](https://github.com/nathcymru/Tocyn/issues/51) | None | No |
| [#66](https://github.com/nathcymru/Tocyn/issues/66) | Apply tenant themes through standard CSS variables | M2.4 | 16 / 48 | 2026-12-24 | 2026-12-31 | [#48](https://github.com/nathcymru/Tocyn/issues/48) | None | No |
| [#88](https://github.com/nathcymru/Tocyn/issues/88) | Dispatch transactional outbound intents reliably | M1.2 | 24 / 72 | 2026-12-29 | 2027-01-08 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#63](https://github.com/nathcymru/Tocyn/issues/63), [#64](https://github.com/nathcymru/Tocyn/issues/64) | None | No |
| [#67](https://github.com/nathcymru/Tocyn/issues/67) | Package isolated helpdesk Web Components | M2.4 | 24 / 72 | 2027-01-01 | 2027-01-12 | [#48](https://github.com/nathcymru/Tocyn/issues/48), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#90](https://github.com/nathcymru/Tocyn/issues/90) | Expose owner and tenant Cost & Capacity controls | M0.2 | 24 / 72 | 2027-01-09 | 2027-01-20 | [#50](https://github.com/nathcymru/Tocyn/issues/50), [#64](https://github.com/nathcymru/Tocyn/issues/64), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#53](https://github.com/nathcymru/Tocyn/issues/53) | Implement tenant-owned Slack support channels | M7.3 | 24 / 72 | 2027-01-13 | 2027-01-23 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#88](https://github.com/nathcymru/Tocyn/issues/88), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#18](https://github.com/nathcymru/Tocyn/issues/18) | Migrate transactional mail to Cloudflare-native delivery | M1.4 | 16 / 48 | 2027-01-21 | 2027-01-28 | [#57](https://github.com/nathcymru/Tocyn/issues/57) | [#65](https://github.com/nathcymru/Tocyn/issues/65) | No |
| [#89](https://github.com/nathcymru/Tocyn/issues/89) | Enable verified canonical support-email conversations | M7.5 | 24 / 72 | 2027-01-25 | 2027-02-04 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#88](https://github.com/nathcymru/Tocyn/issues/88), [#57](https://github.com/nathcymru/Tocyn/issues/57) | None | No |
| [#68](https://github.com/nathcymru/Tocyn/issues/68) | Add a rich conversation composer | M2.2 | 24 / 72 | 2027-01-29 | 2027-02-09 | [#48](https://github.com/nathcymru/Tocyn/issues/48), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#71](https://github.com/nathcymru/Tocyn/issues/71) | Enable keyboard-first workspace navigation | M2.1 | 12 / 36 | 2027-02-05 | 2027-02-11 | [#66](https://github.com/nathcymru/Tocyn/issues/66), [#62](https://github.com/nathcymru/Tocyn/issues/62) | None | No |
| [#69](https://github.com/nathcymru/Tocyn/issues/69) | Add reusable responses and safe operator macros | M2.2 | 12 / 36 | 2027-02-10 | 2027-02-15 | [#68](https://github.com/nathcymru/Tocyn/issues/68) | None | No |
| [#70](https://github.com/nathcymru/Tocyn/issues/70) | Add typing awareness and private colleague collaboration | M2.3 | 24 / 72 | 2027-02-11 | 2027-02-23 | [#68](https://github.com/nathcymru/Tocyn/issues/68), [#63](https://github.com/nathcymru/Tocyn/issues/63) | None | No |
| [#73](https://github.com/nathcymru/Tocyn/issues/73) | Expose SLA progress and responsible handlers | M6.2 | 24 / 72 | 2027-02-16 | 2027-02-26 | [#63](https://github.com/nathcymru/Tocyn/issues/63), [#61](https://github.com/nathcymru/Tocyn/issues/61) | None | No |
| [#72](https://github.com/nathcymru/Tocyn/issues/72) | Split and merge tickets without losing context | M2.3 | 24 / 72 | 2027-02-24 | 2027-03-06 | [#59](https://github.com/nathcymru/Tocyn/issues/59), [#63](https://github.com/nathcymru/Tocyn/issues/63), [#70](https://github.com/nathcymru/Tocyn/issues/70) | None | No |
| [#74](https://github.com/nathcymru/Tocyn/issues/74) | Preserve conversations across verified channel changes | M6.3 | 24 / 72 | 2027-02-27 | 2027-03-10 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#53](https://github.com/nathcymru/Tocyn/issues/53), [#61](https://github.com/nathcymru/Tocyn/issues/61) | None | No |
| [#92](https://github.com/nathcymru/Tocyn/issues/92) | Attach bounded telemetry to programmatic support intake | M1.2 | 16 / 48 | 2027-03-08 | 2027-03-15 | [#60](https://github.com/nathcymru/Tocyn/issues/60), [#91](https://github.com/nathcymru/Tocyn/issues/91) | None | No |
| [#52](https://github.com/nathcymru/Tocyn/issues/52) | Deliver signed tenant webhook subscriptions reliably | M1.2 | 16 / 48 | 2027-03-11 | 2027-03-18 | [#88](https://github.com/nathcymru/Tocyn/issues/88), [#50](https://github.com/nathcymru/Tocyn/issues/50), [#64](https://github.com/nathcymru/Tocyn/issues/64) | None | No |
| [#54](https://github.com/nathcymru/Tocyn/issues/54) | Implement tenant-owned Microsoft Teams support channels | M7.4 | 32 / 96 | 2027-03-16 | 2027-03-31 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#88](https://github.com/nathcymru/Tocyn/issues/88), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#55](https://github.com/nathcymru/Tocyn/issues/55) | Implement tenant-owned WhatsApp messaging | M7.1 | 24 / 72 | 2027-03-19 | 2027-04-03 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#88](https://github.com/nathcymru/Tocyn/issues/88), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#56](https://github.com/nathcymru/Tocyn/issues/56) | Implement tenant-owned Telegram support messaging | M7.2 | 16 / 48 | 2027-04-01 | 2027-04-08 | [#87](https://github.com/nathcymru/Tocyn/issues/87), [#88](https://github.com/nathcymru/Tocyn/issues/88), [#66](https://github.com/nathcymru/Tocyn/issues/66) | None | No |
| [#16](https://github.com/nathcymru/Tocyn/issues/16) | Establish measurable FidesLang coverage | M5.4 | 16 / 48 | 2027-04-05 | 2027-04-12 | [#59](https://github.com/nathcymru/Tocyn/issues/59), [#91](https://github.com/nathcymru/Tocyn/issues/91) | None | No |
| [#49](https://github.com/nathcymru/Tocyn/issues/49) | Track delivery of the omnichannel architecture | Cross-roadmap tracker | 2 / 6 | 2027-04-09 | 2027-04-09 | [#51](https://github.com/nathcymru/Tocyn/issues/51), [#52](https://github.com/nathcymru/Tocyn/issues/52), [#53](https://github.com/nathcymru/Tocyn/issues/53), [#54](https://github.com/nathcymru/Tocyn/issues/54), [#55](https://github.com/nathcymru/Tocyn/issues/55), [#56](https://github.com/nathcymru/Tocyn/issues/56), [#90](https://github.com/nathcymru/Tocyn/issues/90), [#74](https://github.com/nathcymru/Tocyn/issues/74), [#89](https://github.com/nathcymru/Tocyn/issues/89) | None | No |
| [#79](https://github.com/nathcymru/Tocyn/issues/79) | Enforce granular human and agent capabilities | M5.1 | 24 / 72 | 2027-04-09 | 2027-04-21 | [#19](https://github.com/nathcymru/Tocyn/issues/19), [#63](https://github.com/nathcymru/Tocyn/issues/63) | None | No |
| [#17](https://github.com/nathcymru/Tocyn/issues/17) | Complete FidesLang coverage and optional user controls | M5.4 | 24 / 72 | 2027-04-13 | 2027-04-24 | [#16](https://github.com/nathcymru/Tocyn/issues/16) | None | No |
| [#75](https://github.com/nathcymru/Tocyn/issues/75) | Enrich intake with authorised operational context | M3.1 | 24 / 72 | 2027-04-22 | 2027-05-03 | [#79](https://github.com/nathcymru/Tocyn/issues/79), [#64](https://github.com/nathcymru/Tocyn/issues/64) | None | No |
| [#80](https://github.com/nathcymru/Tocyn/issues/80) | Validate governed actions against an isolated reference API | M4.1 | 40 / 120 | 2027-04-26 | 2027-05-14 | [#79](https://github.com/nathcymru/Tocyn/issues/79), [#63](https://github.com/nathcymru/Tocyn/issues/63), [#64](https://github.com/nathcymru/Tocyn/issues/64) | None | No |
| [#76](https://github.com/nathcymru/Tocyn/issues/76) | Add bounded triage and conversation summarisation | M3.2 | 24 / 72 | 2027-05-04 | 2027-05-18 | [#75](https://github.com/nathcymru/Tocyn/issues/75) | None | No |
| [#81](https://github.com/nathcymru/Tocyn/issues/81) | Bind human approvals to specific proposed actions | M4.1 | 24 / 72 | 2027-05-15 | 2027-05-26 | [#80](https://github.com/nathcymru/Tocyn/issues/80) | None | No |
| [#77](https://github.com/nathcymru/Tocyn/issues/77) | Expand the operator copilot with translation and runbooks | M3.3 | 16 / 48 | 2027-05-19 | 2027-05-28 | [#76](https://github.com/nathcymru/Tocyn/issues/76), [#68](https://github.com/nathcymru/Tocyn/issues/68) | None | No |
| [#83](https://github.com/nathcymru/Tocyn/issues/83) | Transfer live agentic work safely to human operators | M4.3 | 24 / 72 | 2027-05-27 | 2027-06-07 | [#80](https://github.com/nathcymru/Tocyn/issues/80), [#81](https://github.com/nathcymru/Tocyn/issues/81), [#70](https://github.com/nathcymru/Tocyn/issues/70) | None | No |
| [#82](https://github.com/nathcymru/Tocyn/issues/82) | Resolve reference-service tickets through bounded autonomous workflows | M4.2 | 32 / 96 | 2027-06-08 | 2027-06-23 | [#80](https://github.com/nathcymru/Tocyn/issues/80), [#81](https://github.com/nathcymru/Tocyn/issues/81), [#83](https://github.com/nathcymru/Tocyn/issues/83), [#76](https://github.com/nathcymru/Tocyn/issues/76) | None | No |
| [#86](https://github.com/nathcymru/Tocyn/issues/86) | Expose authorised deterministic self-service actions | M6.4 | 24 / 72 | 2027-06-08 | 2027-06-18 | [#81](https://github.com/nathcymru/Tocyn/issues/81), [#83](https://github.com/nathcymru/Tocyn/issues/83), [#61](https://github.com/nathcymru/Tocyn/issues/61) | None | No |
| [#78](https://github.com/nathcymru/Tocyn/issues/78) | Author and publish governed diagnostic workflows visually | M5.5 | 32 / 96 | 2027-06-24 | 2027-07-09 | [#79](https://github.com/nathcymru/Tocyn/issues/79), [#66](https://github.com/nathcymru/Tocyn/issues/66), [#80](https://github.com/nathcymru/Tocyn/issues/80), [#81](https://github.com/nathcymru/Tocyn/issues/81), [#82](https://github.com/nathcymru/Tocyn/issues/82) | None | No |
| [#84](https://github.com/nathcymru/Tocyn/issues/84) | Review agent interactions through auditable QA workflows | M5.2 | 24 / 72 | 2027-06-24 | 2027-07-05 | [#82](https://github.com/nathcymru/Tocyn/issues/82), [#63](https://github.com/nathcymru/Tocyn/issues/63) | None | No |
| [#85](https://github.com/nathcymru/Tocyn/issues/85) | Report operational performance and quality metrics | M5.3 | 24 / 72 | 2027-07-06 | 2027-07-16 | [#73](https://github.com/nathcymru/Tocyn/issues/73), [#84](https://github.com/nathcymru/Tocyn/issues/84) | None | No |

## Proposal-to-GitHub mapping

| Proposal reference | Actual issue | Outcome |
|---|---|---|
| N01 | [#57](https://github.com/nathcymru/Tocyn/issues/57) | Establish isolated preview and beta deployments |
| N02 | [#58](https://github.com/nathcymru/Tocyn/issues/58) | Provision isolated test tenants reproducibly |
| N03 | [#59](https://github.com/nathcymru/Tocyn/issues/59) | Map API and portal intake onto canonical conversation contracts |
| N04 | [#60](https://github.com/nathcymru/Tocyn/issues/60) | Make API and portal mutations validated and retry-safe |
| N05 | [#61](https://github.com/nathcymru/Tocyn/issues/61) | Validate authenticated portal conversations end to end |
| N06 | [#62](https://github.com/nathcymru/Tocyn/issues/62) | Validate human handling of canonical ticket intake |
| N07 | [#63](https://github.com/nathcymru/Tocyn/issues/63) | Record attributable ticket and conversation audit events |
| N08 | [#64](https://github.com/nathcymru/Tocyn/issues/64) | Enforce resource budgets across active application paths |
| N09 | [#65](https://github.com/nathcymru/Tocyn/issues/65) | Rehearse and publish the human-led private beta |
| N10 | [#66](https://github.com/nathcymru/Tocyn/issues/66) | Apply tenant themes through standard CSS variables |
| N11 | [#67](https://github.com/nathcymru/Tocyn/issues/67) | Package isolated helpdesk Web Components |
| N12 | [#68](https://github.com/nathcymru/Tocyn/issues/68) | Add a rich conversation composer |
| N13 | [#69](https://github.com/nathcymru/Tocyn/issues/69) | Add reusable responses and safe operator macros |
| N14 | [#70](https://github.com/nathcymru/Tocyn/issues/70) | Add typing awareness and private colleague collaboration |
| N15 | [#71](https://github.com/nathcymru/Tocyn/issues/71) | Enable keyboard-first workspace navigation |
| N16 | [#72](https://github.com/nathcymru/Tocyn/issues/72) | Split and merge tickets without losing context |
| N17 | [#73](https://github.com/nathcymru/Tocyn/issues/73) | Expose SLA progress and responsible handlers |
| N18 | [#74](https://github.com/nathcymru/Tocyn/issues/74) | Preserve conversations across verified channel changes |
| N19 | [#75](https://github.com/nathcymru/Tocyn/issues/75) | Enrich intake with authorised operational context |
| N20 | [#76](https://github.com/nathcymru/Tocyn/issues/76) | Add bounded triage and conversation summarisation |
| N21 | [#77](https://github.com/nathcymru/Tocyn/issues/77) | Expand the operator copilot with translation and runbooks |
| N22 | [#78](https://github.com/nathcymru/Tocyn/issues/78) | Author and publish governed diagnostic workflows visually |
| N23 | [#79](https://github.com/nathcymru/Tocyn/issues/79) | Enforce granular human and agent capabilities |
| N24 | [#80](https://github.com/nathcymru/Tocyn/issues/80) | Validate governed actions against an isolated reference API |
| N25 | [#81](https://github.com/nathcymru/Tocyn/issues/81) | Bind human approvals to specific proposed actions |
| N26 | [#82](https://github.com/nathcymru/Tocyn/issues/82) | Resolve reference-service tickets through bounded autonomous workflows |
| N27 | [#83](https://github.com/nathcymru/Tocyn/issues/83) | Transfer live agentic work safely to human operators |
| N28 | [#84](https://github.com/nathcymru/Tocyn/issues/84) | Review agent interactions through auditable QA workflows |
| N29 | [#85](https://github.com/nathcymru/Tocyn/issues/85) | Report operational performance and quality metrics |
| N30 | [#86](https://github.com/nathcymru/Tocyn/issues/86) | Expose authorised deterministic self-service actions |
| N31 | [#87](https://github.com/nathcymru/Tocyn/issues/87) | Normalise provider events into reliable conversation state |
| N32 | [#88](https://github.com/nathcymru/Tocyn/issues/88) | Dispatch transactional outbound intents reliably |
| N33 | [#89](https://github.com/nathcymru/Tocyn/issues/89) | Enable verified canonical support-email conversations |
| N34 | [#90](https://github.com/nathcymru/Tocyn/issues/90) | Expose owner and tenant Cost & Capacity controls |
| N35 | [#91](https://github.com/nathcymru/Tocyn/issues/91) | Recover accepted payloads through durable storage journals |
| N36 | [#92](https://github.com/nathcymru/Tocyn/issues/92) | Attach bounded telemetry to programmatic support intake |
| N37 | [#93](https://github.com/nathcymru/Tocyn/issues/93) | Enforce private-beta resource guardrails |

[Historical migration record](Backlog-migration-2026-09-08). [Architecture decisions](Architecture-decision-records).
