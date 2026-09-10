# Post-beta implementation contracts

This ledger records contracts only; it does not claim implementation. `#79`, `#80` and `#81` remain open/Todo and their governed executor, reference validation and approval behavior is outstanding.

Issue aliases resolve through `issue-map.json`: ALIGN/PG-GOV-01 `#126`, NEW-UX-01..14 `#127`..`#140`, PG-GOV-00 `#141`, PG-RT-01..07 `#142`..`#148`, PG-TK-01/02 `#149`/`#150`, PG-KB-01/02 `#151`/`#152`, PG-AP-01/02 `#153`/`#154`, PG-FB-01 `#155`, PG-RP-01/02 `#156`/`#157`, PG-ID-01 `#158`, OBS `#159`, RES `#160`, AIG `#161`, and METRICS-FOUNDATION `#162`.

## Identity, tenancy and authorization

- Every new resource derives tenant scope from verified authority; IDs, provider IDs, client filters and metadata never grant authority.
- Access mode is optional deployment configuration. If selected, validate Access JWT signature, issuer and audience, map explicitly to a Tocyn workforce identity, then apply #79. Customer auth remains separate. Owner: `PG-ID-01`; dependencies: #79.
- Local/bootstrap auth is allowed only in explicit local mode; production Access mode has no local bypass. Owner: `PG-ID-01`.

## Realtime and telephony

- `PG-RT-01` owns provider-neutral `SupportSession`, media, telephony, recording and cost contracts plus the SFU/RealtimeKit decision. SFU is preferred, not final.
- `PG-RT-02/03` own tenant-qualified session state, media permissions, browser UX and reconnect fencing.
- `PG-RT-04/05` own verified provider events, tenant-owned credentials, calls, queues, voicemail, callbacks and transfers.
- `PG-RT-06/07` own consent-aware recording/transcription, retention manifests, citations, QA and bounded metrics.

## Knowledge, work and reporting

- `PG-KB-01` owns PDF ingestion, page/source/version manifests and retryable vector lifecycle. `PG-KB-02` owns server-derived tenant/actor retrieval scope, source revalidation, citations and deterministic fallback; #76/#77 consume this contract. Dependency is `KB01 -> KB02 -> #76/#77`, avoiding a cycle.
- `PG-TK-01/02` own private work items, problem/incident links and idempotent bounded customer updates through #88.
- `#162` owns early current-work metric semantics, denominators, freshness and late-event handling for SLA/routing. `#85` retains later QA/channel/handoff analytics and consumes that foundation. `PG-FB-01`, `PG-RP-01/02`, `PG-RT-07` and `PG-TK-02` integrate with it; they do not redefine it.

## Applets and governed actions

- `PG-AP-01/02` define declarative schemas, view models, authoring and lifecycle. #48/#68/#75 are partial or roadmap foundations; #79/#80/#81 are outstanding contracts, not implemented foundations. Every mutation must pass their eventual capability, tool-validation and approval gates.

## UX contract ownership

`NEW-UX-01` owns the interaction contract; `NEW-UX-02` the persistent workspace; `NEW-UX-03` drafts/continuity; `NEW-UX-04` queues/snooze; `NEW-UX-05` search/filtering; `NEW-UX-06` cognitive preferences/focus; `NEW-UX-07` durable activity; `NEW-UX-08` contextual panels; `NEW-UX-09` table/bulk actions; `NEW-UX-10` waiting reasons/states; `NEW-UX-11` workload/capacity; `NEW-UX-12` utility-action registry; `NEW-UX-13` measured interaction performance; and `NEW-UX-14` validation/release UX gates. Their exact acceptance bullets are retained in `traceability.md` under each prefix.

## Cross-cutting constraints

`OBS` owns SLO/health/incident evidence; `RES` owns residency and jurisdiction boundaries; `AIG` owns the evidence-based AI Gateway evaluation (adopt, limited adopt or reject), tenant-safe caching and fallback assessment. `ALIGN126` owns package reconciliation only. None of these aliases imply feature completion.

## Product and release boundaries

- Retain support/helpdesk scope; exclude CRM, marketing, public marketplace, broad parity and autonomous Fin Voice.
- Beta1 is already the accepted/published prerelease at `049ea82` (10 September 2026); beta2 is future scope. Do not preserve package claims that beta1 is merely a candidate or that M0–M7/M8/M9 taxonomy is immutable.
