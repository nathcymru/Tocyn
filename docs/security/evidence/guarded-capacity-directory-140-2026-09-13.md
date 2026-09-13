# Guarded capacity directory acceptance correction — 13 September 2026

Progresses #140 and #137. Both issues remain partially accepted. Existing percentages, baseline dates and completion fields remain unchanged.

## Observed defect and correction

Actual IAB on isolated candidate c3364971 at loopback52949 loaded21 conversations and current work0/unconfigured. Current work keyboard opening, initial close focus, reverse/forward wrap and Escape return to Account options passed. Settings → Users instead displayed the guard-disabled error alongside “No team members found”, making capacity configuration inaccessible. No capacity/assignment mutation or public reply occurred in that browser exercise. Authentication is bootstrapped on full reload; this is not logout/identity-reload or spoken assistive-technology evidence.

The correction admits only exact GET /api/users through the local-beta conversation-read inventory. It retains existing current staff/session/MFA, users.manage capability, tenant-scoped population, bounded pagination and directory budget admission/fenced transaction. No administration write or new budget fallback is exposed. UsersPage now provides a persistent alert and Retry team members, without the false empty state on load failure.

## Validation

- Route inventory unit tests:10 passed, including blocked methods, extra paths and API/customer variants.
- Directory failure and existing capacity UI tests:5 passed. The new regression uses the actual React Query directory hook and retries after a rejected API response; it is simulator evidence.
- Server types, dashboard TypeScript and dashboard build: passed.
- Focused real D1/DO guarded directory: passed; same-tenant only with a foreign colliding user ID, missing auth401, capability revoke403, invitation revoke403, stale session401, unsupported writes503, beta create/mutation counters unchanged. Existing directory resource envelopes are unchanged; the new guarded request remains within its current read/write allowance.
- Full existing directory native suite:7 passed, including large population, stale authority, exhaustion, bounded membership sentinel, closure and sustained reads.

No current preview source, persisted data, processes or credentials were changed. New browser acceptance awaits a reviewed signed candidate; no full #137, #140, SLA, AT or production readiness claim.
