# Validation and evidence matrix

Use `traceability.json` → `owningIssues` to select all source clauses for an issue. Prefixes below identify principal acceptance clauses; supplemental source-clause IDs retain the other registers, contracts and test matrices. Authoritative blocking edges are in `forecast.json`; integration references are not automatically blockers.

| Owner / mapped issue | Trace prefix | Required evidence boundary | Dependencies / gate |
|---|---|---|---|
| NEW-UX-01..14 (#127–#140) | `NEW-UX-01-` … `NEW-UX-14-` | Every Approved scope, Scope boundary and Acceptance bullet in UX source `08-new-issue-proposals.md`; LAW/COMP/COG mapping and cognitive-accessibility evidence | #48, #60, #63, #66, #71, #73, #74, #75, #79 as cited; beta2 UX gate |
| PG-GOV-00 (#141) | `PG-GOV-00-` | Tracker lists actual member issues and closes only after M8/M9/documentation reconciliation | PG-GOV-01; governance gate |
| PG-GOV-01 / ALIGN126 (#126) | `PG-GOV-01-`, `ALIGN126-ADR` | ADR/documentation alignment, no baseline falsification, verified beta.1 release, source coverage, Project/Wiki read-back, signed integration and unchanged historical baselines | #126 alignment gate |
| PG-RT-01 (#142) | `PG-RT-01-` | Synthetic architecture proof; SupportSession/telephony/recording contracts; SFU vs RealtimeKit decision; cost/failure evidence | #50/#74/#79/#87/#88/#90; architecture gate |
| PG-RT-02 (#143) | `PG-RT-02-` | Tenant-qualified session/participant/media schema, lifecycle/fencing, capability and cost-admission tests | PG-RT-01; #79 outstanding |
| PG-RT-03 (#144) | `PG-RT-03-` | Accessible browser audio/video/screen-share, preflight, reconnect and two-tenant leakage tests | PG-RT-02; #48/#68/#70/#74 |
| PG-RT-04 (#145) | `PG-RT-04-` | Provider-neutral gateway, verified webhooks, tenant credentials, identity safety, dedupe/retry and uncertain-call fixtures | PG-RT-01/02; #74/#79/#87/#88/#90 |
| PG-RT-05 (#146) | `PG-RT-05-` | Queue/office-hours, voicemail, callback, transfer, timeout/fallback and accessibility evidence | PG-RT-04; #70/#73/#79 |
| PG-RT-06 (#147) | `PG-RT-06-` | Consent/policy snapshot, tenant media ownership, transcript states, retryable deletion and budget/failure evidence | PG-RT-01/02; #50/#90; ADR-0015 |
| PG-RT-07 (#148) | `PG-RT-07-` | Timeline/QA/report integration, visibility, provenance, bounded summary and retention consistency | PG-RT-03/05/06; #76/#77/#84/#85 |
| PG-TK-01 (#149) | `PG-TK-01-` | Private linked work, composite ownership, independent assignment, audit/conflict/accessibility evidence | #70/#72/#79 |
| PG-TK-02 (#150) | `PG-TK-02-` | One-to-many incidents, target preview, explicit publish capability, idempotent #88 fan-out, retries and bounded analytics | PG-TK-01; #72/#79/#88/#85 |
| PG-KB-01 (#151) | `PG-KB-01-` | PDF validation/extraction, page/version provenance, atomic promotion, retryable cleanup, explicit parser failure and accessible UI | Current RAG; #50/#64/#79 |
| PG-KB-02 (#152) | `PG-KB-02-` | Server-derived tenant/actor scope, manifest revalidation, operator/service-user separation, citations/staleness, zero cross-tenant retrieval and deterministic fallback | PG-KB-01 → PG-KB-02 → #76/#77; #79 outstanding |
| PG-AP-01 (#153) | `PG-AP-01-` | Finite declarative schema, tenant-qualified definitions, safe reads, governed actions, tenant isolation, XSS/revocation/accessibility tests | #48/#68/#75; #79/#80/#81 outstanding |
| PG-AP-02 (#154) | `PG-AP-02-` | No-code authoring, validation, dry-run safety, immutable publish versions, audited rollback/retire and fail-closed revocation | PG-AP-01; #66/#78/#79/#80/#81 |
| PG-FB-01 (#155) | `PG-FB-01-` | CSAT/CES token scope/idempotency, portal/widget/link routes, audit, prompt limits, correlation integrity and accessibility | #73/#79/#88; #85 |
| PG-RP-01 (#156) | `PG-RP-01-` | Fresh bounded queue/SLA/assignment/feedback/problem/realtime aggregates, authorization, freshness, reconciliation and accessibility | #73/#85; PG-FB-01; later metric integrations |
| PG-RP-02 (#157) | `PG-RP-02-` | Stable metric registry, tenant-owned no-SQL definitions, parameterized bounded plans, cost limits, fixture reconciliation and UI | #50/#79/#85; PG-FB-01 |
| PG-ID-01 (#158) | `PG-ID-01-` | Access signature/issuer/audience/key rotation, explicit subject mapping, denial cases and no production local bypass | #79; optional `cloudflare_access` mode |
| OBS (#159) | `OBS-ADR` | SLO/health/incident observability requirements from gap2 ADR-0016 and acceptance matrix | H1/operational gate |
| RES (#160) | `RES-ADR` | Residency, jurisdiction and provider data-location boundaries from gap2 ADR-0017 | Deployment gate |
| AIG (#161) | `AIG-ACCEPTANCE` | Compare direct Workers AI and gateway latency, costs, model compatibility, privacy, tenant-safe cache identity, schema-preserving fallback; explicit adopt/limited adopt/reject evidence | #50/#64/#76; evaluation required, adoption undecided |
| METRICS-FOUNDATION (#162) | `PG-RP-01-`, `PG-RP-02-`, `PG-RT-07-`, `PG-TK-02-` | #85 semantics, denominators, freshness and late-event rules established before later QA/report analytics | #63/#79 → #162 → #73/#137 and later #85 |

Inventory integrity: `source-inventory.json` contains all 54 source files and verified hashes. Passing a source-level check is evidence for planning only; it is not production clearance.

## Release gates

- **Beta.1:** accepted 9 September 2026 at signed `049ea82a02571681f834bcd87d43253603edf71f`; tag/prerelease published 10 September. Local-only synthetic two-tenant acceptance, local captured authentication mail and PR #125 later evidence. No deployment assets or production clearance.
- **Beta.2 / #140:** architecture contract accepted; persistent work-view/selection/drafts; durable activity; deterministic snooze/resurface; waiting semantics; search/filter distinction; accessible keyboard and screen-reader triage; collision, retry and uncertain-send safety; AI-off operation; two-tenant/user isolation; measured performance. **Full #73 SLA clocks, calendars, pause/resume and waiting behavior, plus #137 responsible-handler ownership/capacity/routing are mandatory.** Original UX-A2 deferral does not apply to these controls. All 20 canonical task journeys and all negative scenarios in UX source `10-validation-and-release-gates.md` remain individually required, using the source ledger and their capability owners. #140 owns the core workspace journeys; the AI-enabled improve/translate journey is also acceptance for #77 when that later capability integrates, and future channel/provider journeys remain acceptance of their integration owners. This follows the approved distinction between existing-identity workspace contracts and later channel/context/AI integrations; it does not remove those later tests. New UI does not reopen historical #21 acceptance.
- **Production / #42:** separate exact-candidate migration/rollback, operational SLO, redaction/retention, residency evidence, provider and runtime gates. Synthetic fixtures cannot satisfy an explicitly real integration requirement. No production actions are authorised by this alignment.

## Alignment verification

Run `python3 schedule.py --check` and `python3 validate.py`. Then compare GitHub issue bodies and native dependency edges against the issue snapshots/graph, compare Project fields while preserving original baselines/actuals, verify milestone membership, and compare live Wiki bytes against reviewed Wiki sources. Required CI/security and signed integration remain mandatory. Record unavailable surfaces explicitly in the handover.
