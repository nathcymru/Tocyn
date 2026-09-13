# #137 responsible-owner routing foundation

Branch: `codex/137-ownership-routing`.

This partial delivery treats the existing tenant-qualified `tickets.assigned_to`
column as the one responsible-handler record. The dashboard transition requires
the owner last observed by the operator and an idempotency key. Its canonical
batch rechecks the actor's live MFA session, current ticket/group access, the
target's current tenant staff role and group membership, the expected owner,
and the receipt key before committing the ticket, internal assignment audit,
and response receipt together.

The dashboard detail picker uses `/tickets/:id/responsible-owner`; it does not
derive an SLA change, availability, ceiling, queue order, or fairness result.

Evidence on this branch:

- native staff mutation runtime coverage for successful/replayed, stale,
  cross-tenant, and target-membership-revocation assignments;
- dashboard workflow coverage for the endpoint and idempotency header;
- server/dashboard type checks, focused handler/route tests, and dashboard build.

Remaining #137 acceptance: availability and assignment ceilings, automatic and
manual routing policy, concurrent hard-rule handling beyond this one owner CAS,
capacity/fairness/fallback presentation, queue and #73 SLA-priority integration,
and migration of every legacy assignment writer to this contract. This partial
delivery does not complete #137 or beta.2.


## 13 September 2026 continuation

Branch: `codex/137-legacy-owner-writer`, based on signed `c09647796a73f7e0440f8006d66230c43532e1d3`.

Existing-ticket dashboard assignment now uses the dedicated responsible-owner
transition. Generic property updates reject assignment fields atomically in both
configured and legacy modes; invalid admission configuration still fails closed.
Creation semantics and the existing dashboard owner picker are preserved.
Canonical owner changes retain durable assignment activity in the same batch as
the expected-owner check, current authorization, audit and response receipt.
Unassignment remains supported, and replay cannot duplicate activity.

Coordinator approved the bounded behavior and the shared audit-helper extension.
A native GPT worker implemented and executed the isolated-worktree tests using
Node 22 and existing installed dependencies; no additional model route, measured
saving, independent approval or release acceptance is claimed. Source locations
were verified directly from the previously merged #250 file list.

Validation: all 764 server unit tests (82 files), including 38 focused
handler/local-beta routing tests; three focused native
assignment scenarios and all 35 full native staff tests; server and staff-runtime
type checks; both npm audit modes reported zero vulnerabilities. The migrated activity regression failed before the canonical
activity integration and passed after it.

Remaining #137 scope still includes availability, ceilings, queue-dependent
fairness/fallback, and migration/acceptance of any other assignment surfaces.
This is a partial increment, not completion of #137 or Beta.2.
