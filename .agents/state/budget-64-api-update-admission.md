# #64 API PATCH admission receipt

- Branch/worktree: `codex/64-api-update-admission` at base `aeef928`.
- Added `api.ticket.update` as an API-key mutation with a durable version-3, 200-response ticket receipt and the existing current-key/budget commit fence. Migration `0044_api_ticket_update_receipts.sql` preserves prior receipt versions and redaction behavior.
- PATCH retains partial update fields and optional client idempotency. A supplied key replays the immutable ticket response or conflicts on a changed normalized payload. An unkeyed compatibility PATCH receives a private one-shot receipt/fence without replay headers.
- Native evidence: `test:ticket-mutation-replay` (14/14), `test:conversation-audit` (9/9), and `test:budget-admission-runtime` (118/118; 106.8s). The last suite measured update worst-case expired-receipt cleanup: 9 statements, 427 reads, 119 writes, within the canonical envelope; it also covers all post-admission authority/policy/key/permission/expiry fences.
- Remaining independent #64 work: API detail pagination/admission is owned separately; it must bound the normal detail default rather than leave optional pagination beside the unbounded legacy path.

## Refreshed integration evidence

- Merged root candidate `6781d9b` with no conflicts. The shared staff precondition, internal-mention projections, customer fences, public-history projection, and revised canonical envelope remain composed with PATCH.
- Corrected the API PATCH unit double to return its new v3, 200 receipt snapshot.
- Validation from the merged head: Node 22.19.0 `npm test` 69 files/676 tests; server `typecheck`; mutation replay 14/14; conversation audit 9/9; staff mutation runtime 28/28; combined collision runtime 1/1; budget admission runtime 118/118 (103.7s).
- The first merged full-unit attempt under system Node 26 was invalid because its shared `better-sqlite3` binary targets Node 22; it was rerun under the repository-required Node 22.19.0 and passed.
