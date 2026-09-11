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

## Customer-branch integration refresh

Merged customer candidate `54db56b` (including accepted main #194 and the widget custom-field integration correction) into this storage candidate as `841fb06`. The storage R2 native controls, budget policy closures and customer admission fences are preserved.

- `npx tsx scripts/d1-integration-test.ts` — real Miniflare D1 integration batches 1–5 passed.
- `npx tsc -p scripts/tsconfig.customer-budget-admission.json` — passed.
- `npm run typecheck` — passed.
- `npx eslint src/budgets/storage-admission.service.ts src/handlers/dashboard.handler.ts scripts/storage-admission-runtime.test.ts scripts/budget-admission-runtime-entry.ts` — passed (existing Node module-type warning only).
- `node --import tsx --test --test-concurrency=1 scripts/storage-admission-runtime.test.ts` — 3 passed, 0 failed.

No full 93-test rerun was needed: the refresh merged disjoint customer/branding work, produced no conflicts and did not change the storage implementation. No remote action was taken; root owns stacked PR creation after #195 is accepted.

### Coordinator retry-envelope correction — 11 September, 11:03 BST

Review of both permitted HTTP attempts found the initial two-Class-B allowance insufficient: a lost R2 acknowledgement followed by an HTTP retry performs three native metadata reads. Upload now prepays four Class-B reads, two Class-A writes and two request diagnostics; download reserves both allowed attempts. Both include the existing 1,536-read cold authority refresh plus two metadata reads. Stock bytes remain charged once per immutable upload object; ambiguous work is not refunded.

The native regression observes the three reads, compares actual calls with the declared envelope, and proves an exhausted third attempt performs no R2 read. Storage native tests 3/3, server typecheck and scoped lint passed on this correction. Log: `/private/tmp/tocyn-64-storage-retry-envelope.log`. This is a bounded admission increment; full #64 remains open.

### Combined customer/dashboard storage increment — 11 September

Existing PR #196 now includes customer storage commit a1e707a and coordinator tuple-framing fix ab79507, avoiding a separate overlapping storage PR. Customer authentication remains customer-specific (current session/email/tenant, no staff MFA); public attachment ownership is checked before R2. Customer identity hashes now use unambiguous JSON tuple encoding. Full native admission suite passed 95/95 before this one-line framing correction; all five storage-native tests passed afterward. The branch also incorporates #195 revision ee3194e and accepted login changes via a clean merge. Retargeting to main and exact required CI remain pending #195 acceptance. No full #64 completion is claimed.
