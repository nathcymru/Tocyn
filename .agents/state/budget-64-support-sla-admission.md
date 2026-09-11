# #64 support-state/SLA admission integration

Coordinator owns this candidate; it is not accepted. This branch is refreshed on accepted PR #199 commit `922e2ad` (tree equality checked before the retry correction). Existing draft PR #200 remains open and must be retargeted by the coordinator; it does not close #64.

Six dashboard support-state/SLA writes have current-authority admission and durable receipts through migration 0049. A confirmed deactivation regression is corrected: waiting-to-working remaps atomically resume initialized clocks, close pause intervals and record the event. Indexed 101-candidate gating prevents partial writes above the existing 100-ticket limit.

Current retry correction reserves both permitted isolate business executions. The native 100-remap fixture includes 512 same-tenant and 512 foreign-tenant ticket/history rows plus 150 expired receipts. One successful batch measured 5,437 reads / 2,810 writes. A forced final D1 duplicate executes then rolls back the first native batch; the same idempotency key succeeds on its second and final permitted execution. The logged 10,874 reads / 5,620 writes are a conservative doubled successful-run upper bound, not unavailable failed-batch metadata. The operation envelope is 16,384 reads / 8,192 writes; canonical 1,024 remains unchanged.

Current validation: Node 22.19.0 script and server typechecks passed. Focused native support runtime, receipts, migration and routes passed after the retry correction; the registered integrated budget runtime/type logs before this correction are `/private/tmp/tocyn-support-sla-integrated-budget.log` (133/133) and `/private/tmp/tocyn-support-sla-integrated-types.log`. Re-run the registered budget suite at the correction commit before acceptance.

Next: commit/push this correction to the existing branch, let the coordinator retarget PR #200 and perform exact-current checks. No Copilot reviews, remote resources or merge. Full #64/#130/#140 remain open.
