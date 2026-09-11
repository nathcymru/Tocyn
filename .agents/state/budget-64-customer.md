# #64 customer admission prerequisite — 11 September 2026

Branch: `codex/64-customer-admission`, based on `1245ec5`. This is an isolated, local-only prerequisite for #64; root owns route integration, issue/Project updates, PR work and acceptance.

## Delivered boundary

- `CustomerCurrentCredentialRepository` performs at most two indexed D1 reads before a reservation: current tenant-scoped customer identity, then exact tenant-scoped ticket ownership for replies. It requires the live `customer` role, current session version, unexpired credential, normalized email, and matching stable customer ID when the ticket has one.
- `CustomerBudgetReservationService` uses the existing `IsolateBudgetAdmissionCache` and `BudgetAuthorityRepository`. It keeps normalized reservation intent and commit authority in an opaque prepared attempt, returns no authority from admission, and provides an immutable `CustomerBudgetCommitHandoff` only for a later canonical D1-fence integration.
- No route, permission, canonical mutation/replay service, existing repository, Durable Object, store, customer article visibility, provider, or billing behavior changed.

## Evidence

- `npm run typecheck --workspace=apps/server` passed.
- `npm exec --workspace=apps/server -- tsc -p scripts/tsconfig.customer-budget-admission.json` passed.
- `node --import tsx --test apps/server/scripts/customer-budget-admission-runtime.test.ts` passed seven native Miniflare/D1/DO scenarios: colliding tenant/customer/ticket IDs, warm zero-coordinator spends, current credential failures, session revocation, customer role change, ticket owner change, malformed policy authority, and bounded indexed-query plans.
- `npm audit --json` and `npm audit --omit=dev --json` both reported zero known vulnerabilities in this checkout's shared dependency set. This is not a production/security-clearance claim.

## Exact integration seam and remaining work

The later customer route/composition phase must construct `CustomerBudgetReservationInput` only from authenticated widget claims and the current canonical target, call `prepare` then `reserve`, and pass `commitHandoff` into a customer-specific atomic canonical mutation fence. It must recheck the handoff inside the canonical D1 batch before committing. This prerequisite does not activate customer admission, create customer receipts, reserve attachment/upload capacity, or complete the customer portion of #64.
