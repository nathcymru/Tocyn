# #64 dashboard summary reads — PR #221 update (11 September 2026)

The admitted SLA projection endpoint accepts up to 25 unique ticket IDs. Its
single D1 authority guard previously expanded three metadata conditions for
each ticket, and the native maximum-size request returned 503 before it could
read projections. The guard now passes the immutable snapshot as one JSON
parameter and checks every ticket's pause count, policy-calendar size, and
handler-name size inside the same atomic batch.

Red: the real Miniflare Worker/D1 fixture returned
`budget_admission_unavailable` (503) for 25 synthetic IDs. Green: the same
fixture returns all 25 projections. Existing foreign-ticket opacity,
revocation, pause-history-growth rejection/retry, complete 601-row history,
and operation-envelope checks also pass in that native run.

Checks: native runtime test passed; server TypeScript passed; focused ESLint
passed; `git diff --check` passed. The combined Vitest command passed the
dashboard handler file (22 tests) but its local-beta repository file could not
load `better-sqlite3`: the available binary is Node ABI 127 and this shell
requires ABI 147. No rebuild was performed. Full #64 acceptance and PR #221
integration remain open.
