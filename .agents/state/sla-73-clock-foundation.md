# #73 calendar and clock foundation — 11 September 2026

This branch adds the pure, server-only SLA calendar module at `apps/server/src/domain/sla-clock.ts` and synthetic unit coverage at `apps/server/src/domain/__tests__/sla-clock.test.ts`.

The module exposes bounded, IANA-timezone calendar validation; a 24/7 UTC default; weekly schedules and date exceptions; explicit fold/gap DST handling; elapsed working-time and deadline arithmetic; explicit pause intervals; response/resolution target evaluation; and an explicit reopen policy selector. It owns no ticket lifecycle inference, persistence, API payload, metric, ownership/routing, customer display, migration, or UI behavior.

Integration must wait for accepted #136 waiting/lifecycle transition facts and #162 metric semantics. The integrator should persist and load tenant-qualified calendar/rule configuration, translate accepted lifecycle facts into explicit clock anchors and pause intervals, choose the approved DST and reopening policies, provide resource limits appropriate to the request/job, and retain deadline/calculation evidence needed by #162. #137 remains responsible for routing and handler identity. This prerequisite cannot close #73 or its beta.2 gate.

Deliberate pure-module limits: instants and configured exception dates use Gregorian years 0100–9999; schedules use minute precision and same-day windows (overnight work is split by the caller); exceptions are capped at 3,660, daily windows at 48, pause intervals at 4,096, and caller-provided evaluation limits at 3,660 calendar dates / 65,536 intervals. The timezone formatter cache is capped at 64 entries. DST gap resolution searches at most 180 local minutes; a larger historical gap returns the typed nonexistent-local-time failure instead of unbounded work.

Synthetic checks cover default UTC behavior, business-day/calendar closures, overlapping pauses, DST spring gap/fall fold policy, folded adjacent windows, malformed and extreme inputs, empty calendars, reopening policy selection and configured resource ceilings. No remote action, migration, API, or external data was used.
