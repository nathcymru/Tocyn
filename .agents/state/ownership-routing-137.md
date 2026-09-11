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
