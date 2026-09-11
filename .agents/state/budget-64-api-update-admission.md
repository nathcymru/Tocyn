# #64 API PATCH admission receipt

- Branch/worktree: `codex/64-api-update-admission` at base `aeef928`.
- Added `api.ticket.update` as an API-key mutation with a durable version-3, 200-response ticket receipt and the existing current-key/budget commit fence. Migration `0044_api_ticket_update_receipts.sql` preserves prior receipt versions and redaction behavior.
- PATCH retains partial update fields and optional client idempotency. A supplied key replays the immutable ticket response or conflicts on a changed normalized payload. An unkeyed compatibility PATCH receives a private one-shot receipt/fence without replay headers.
- Native evidence: `test:ticket-mutation-replay` (14/14), `test:conversation-audit` (9/9), and `test:budget-admission-runtime` (118/118; 106.8s). The last suite measured update worst-case expired-receipt cleanup: 9 statements, 427 reads, 119 writes, within the canonical envelope; it also covers all post-admission authority/policy/key/permission/expiry fences.
- Remaining independent #64 work: API detail pagination/admission is owned separately; it must bound the normal detail default rather than leave optional pagination beside the unbounded legacy path.
