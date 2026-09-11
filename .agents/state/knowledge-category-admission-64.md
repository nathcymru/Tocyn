## Combined coordinator integration — 11 September 2026

PR #213 incorporates frozen #215 ead4bf76b5ff66db2ccd4d14bbb8d45baa35e603. Adjacent handler helpers/imports and runtime includes are combined; no category behavior is discarded. Combined native DELETE/category19/19, shared runtime types, category units and targeted ESLint pass. Required CI now includes both native suites. This is a candidate, not signed main acceptance; #64 remains open. Producer-unresolved and legacy-manifest recovery limitations under #151 remain explicit. No Copilot review requested.

# Knowledge category admission — #64 partial delivery

- Branch: `codex/64-knowledge-category-admission`
- Base: accepted `main` at `70b75aba7de8876328691d1c7f80664d34494974`
- Scope: `GET /api/knowledge/categories`, `POST /api/knowledge/categories`, and `DELETE /api/knowledge/categories/:id` only.
- Migration: `0064_knowledge_category_admission.sql`.

## Implemented boundary

- Combined policy uses the existing category authorization contract: authenticated tenant-scoped `agent` or `admin`, current database role/session version, and current MFA. There is no category capability in the accepted capability catalogue, so this slice does not invent one.
- A maintained category row/byte counter prices the complete retained list before its rows are loaded. Empty tenants remain `[]`; unsafe or missing accounting with retained rows fails closed.
- The D1 batch repeats current identity, owner/deployment/tenant budget authority, exact grant/closure, durable `budget_grant_operations`, population, target/parent, and document-population constraints before the list or mutation.
- Create/delete responses retain status 200 and their existing JSON shapes. Optional idempotency keys have immutable one-day receipts, bounded cleanup, collision detection, and lost-ack recovery.
- Delete checks all tenant documents and child categories atomically. Its dynamic envelope uses maintained document/category populations, avoiding a new `knowledge_docs` index or trigger that would change article-source write costs.
- Off-policy routes continue through `TenantKnowledgeService` unchanged.

## Focused evidence

- Server TypeScript: passed `npm run --workspace=apps/server typecheck`.
- Budget runtime TypeScript: passed `npm run --workspace=apps/server typecheck:budget-admission-runtime`.
- Server ESLint on all changed TypeScript: passed.
- Existing handler/service plus new unit tests: 53 passed across 3 files.
- Native Worker/D1/Durable Object category test: 12 passed. It covers two tenants, an uncapped 240-row list, empty tenant, exact spent-operation links, session/role/MFA/owner-authority changes after reservation, concurrent population growth, exhausted admission without list load or mutation, authorization before invalid body parsing, idempotency collision/replay, lost-ack receipt recovery, stale-create rejection, bounded expired-receipt cleanup, and atomic document/child references.
- Native measured successful list/create/delete D1 reads/writes: `287/6`, `56/12`, `1025/11`; all fit their exact stored operation envelopes. Cleanup of the maximum 32 expired receipts used 45 D1 writes against 128 admitted.

## Integration boundary

- Root owns shared CI registration and integration with the pending #64 candidates.
- This is partial #64 evidence. It does not clear deployment combined-policy, provider billing reconciliation, document/source deletion, owner ingress, customer auth, or the future disabled-path issues.
