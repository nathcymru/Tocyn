# #64 customer attachment storage admission

Branch: `codex/64-customer-storage-admission`, based on PR #196 storage revision `fcfb5ab` (which includes the customer admission stack). This is a bounded active-storage increment, not full #64 acceptance.

- Authenticated customer attachment upload and download compose only when the existing combined `ticket-mutations-v1` policy is enabled. `off`, API-only, and an absent optional binding retain the existing path; malformed explicit configuration fails closed before R2.
- The admission service rechecks live tenant, customer role, session version, expiry, and normalized email through `CustomerCurrentCredentialRepository`. Customers do not acquire an MFA requirement. Download retains the existing tenant-scoped attachment metadata, public-content, and customer-email ownership check before admission and R2.
- Upload precharges two HTTP attempts, 1,538 bounded D1 reads including cold authority/customer controls, two R2 Class-A writes, four R2 Class-B marker reads, named diagnostics, and one stock-byte amount. The idempotency object key is tenant/actor scoped and independent of mutable extension; its marker binds filename, MIME type, size, and SHA-256 content digest. Conditional-write, concurrent, cache-loss, and lost-acknowledgement recovery return only an exact marker match; ambiguity remains charged.
- The shared native Miniflare D1/R2/DO storage proof now covers customer same-key tenant separation, no-MFA current session, content/extension conflict after cache loss, lost R2 acknowledgement with three observed marker reads inside the four-read envelope, customer-owned download, capacity refusal, and session revocation before R2.

Validation on this revision:

- `npm exec --workspace=apps/server -- vitest run src/handlers/__tests__/customer.handler.test.ts` — 18 passed.
- `npx eslint src/budgets/customer-storage-admission.service.ts src/handlers/customer.handler.ts scripts/storage-admission-runtime.test.ts` — passed (existing Node module-type warning only).
- `npm run typecheck --workspace=apps/server` — passed.
- `npm run test:budget-admission-runtime --workspace=apps/server` — 95 passed, 0 failed, completed session 57408 in 73.5 seconds.

No remote storage, deployment, provider, billing, or customer data was used. CPU/duration, transfer bytes, and provider billing remain unmeasured dimensions under the wider #64 acceptance map; full administration remains #90 scope.
