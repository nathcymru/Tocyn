# #64 dashboard attachment storage admission

Branch: `codex/64-storage-admission` from customer-admission revision `eb8ddaa`.

## Delivered increment

- `POST /api/attachments/upload` and `GET /api/attachments/:id/download` use the existing bounded isolate grant registry when the existing combined ticket admission policy is enabled.
- The route keeps its existing authenticated dashboard, MFA, role and tenant boundaries. It rechecks the live session and budget authority before each prepaid spend; the tenant-qualified attachment metadata lookup remains before a download's R2 read.
- Upload reserves R2 storage bytes, bounded Class A writes and bounded Class B recovery reads before any R2 call. `Idempotency-Key` is optional and bounded; when supplied it derives one tenant/actor-scoped object key independent of filename/extension. Its marker binds filename, MIME type, size and a bounded SHA-256 of the exact file bytes. A matching retry returns the existing key; a changed byte stream or metadata conflicts even after isolate-cache loss; conditional-write/lost-response ambiguity remains charged rather than refunded.
- Downloads reserve each R2 Class B read independently. They deliberately do not deduplicate response retries, because each retry can issue another storage read.
- No API/UI contract was removed. An absent budget binding preserves the legacy route; explicit combined policy activates admission and malformed explicit policy fails closed.

## Evidence

- `npm run typecheck --workspace=apps/server`
- `npm exec --workspace=apps/server -- vitest run src/handlers/__tests__/dashboard.handler.test.ts src/middleware/__tests__/budget-admission-policy.test.ts` — 28 tests passed.
- `npm exec --workspace=apps/server -- tsx --test scripts/storage-admission-runtime.test.ts` — isolated Miniflare D1/R2/DO test passed two synthetic tenants, colliding staff/idempotency identities, same-size byte conflict, cache-loss filename/extension conflict, conditional concurrent write, lost R2 acknowledgement recovery, warm recovery with no second coordinator RPC, tenant-isolated download denial, and concurrent capacity/session rejection before R2.
- The native test is part of `test:budget-admission-runtime` and the required CI runtime list.

## Remaining #64 work

This is only the authenticated dashboard attachment storage increment. It does not cover portal attachment routes, email/inbound storage, article-body storage, collaboration/composer routes (#70), provider billing measurements, owner/tenant administration (#90), or grant compaction/recovery work owned by the other #64 slices.
