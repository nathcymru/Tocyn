# Beta.2 coordinated delivery

Active goal: complete #140 beta.2 acceptance, including full SLA/ownership/routing, durability, accessibility and tenant isolation. Alignment #126 is accepted; its historical pause is superseded. Approved scope remains in [the master package](../../docs/planning/post-beta-2026-09-10/README.md). One coordinator owns acceptance, integration and planning publication.

## Accepted work

#127 interaction contract: PR #164 merged at `ec99b5a48a8c9de2c935f0a08423e0461bdd9441` on 10 September 2026 at 14:17:30 UTC. GitHub signature verified, all required checks passed, no review threads/findings. Source archive comparison covered all 22 Critical LAW/COMP/COG findings. Wiki commit `48bf051` read back byte-identically. Issue closed; Project Done/100/Actual completion 2026-09-10. This completes a contract, not workspace implementation.

## Current allocation and integration queue

| Issue | Environment / owner | Actual model / effort | Branch and location | Current evidence / next action |
|---|---|---|---|---|
| #50 cost contract | dedicated Codex / coordinator | current coordinator configuration; switching unavailable | codex/50-cost-contract; primary checkout; PR #165 | 36 targeted tests, server typecheck/scoped lint, root npm test and three frontend builds passed. Original PR CI passed; rebased onto #164 with forecast update, so new exact-revision CI required. Active enforcement remains #64/#91. |
| #160 residency foundation | dedicated Codex / coordinator after product_package_audit | worker Luna/medium; consequential correction escalated to coordinator | codex/160-residency-foundation; /private/tmp/tocyn-beta2-160; PR #166 | 21 targeted tests and original PR CI passed. Rebase after #165 integrates, then required checks. Hard profiles rejected by current unrestricted generator; #42/#57 own live provisioning. |
| #79 permissions | dedicated Codex / permissions_79 | Terra / high | codex/79-resource-permissions; /private/tmp/tocyn-beta2-79 | Active implementation; Project In progress/Actual start 2026-09-10. Live revocation must fence mutation/side-effect boundaries, not merely request start. |
| #48 shared primitives | dedicated Codex / ux_package_audit | Luna / medium retained worker | codex/48-headless-primitives; /private/tmp/tocyn-beta2-48 | First foundation commit `5f3fbdb` returned, awaiting coordinator review. ALL retained application migration, complex-control/accessibility and measurements remain. Do not close for a partial foundation. |

The #48 worker must not edit AgentPermissionsPage or permission APIs owned by #79. Coordinate its final primitive adoption at integration. Domain-only packages/shared must not import UI. Preserve historical dirty worktrees.

A dedicated Codex Luna/low worker completed bounded forecast analysis. An additional Terra/medium UI worker could not start because the native thread limit was reached; no such execution is claimed. Existing workers are reused where useful, with coordinator review proportional to risk. No callable Work-worker or normal-Chat delegation route was found. Verified documentation treats Work/dedicated Codex allowances as shared; no separate balance is assumed. Subscription-backed route only; no API billing, purchases, resets or overages. Last observed Codex capacity: 28% remaining, reset 15 September 02:24 BST; current/task-specific consumption unknown.

## Critical path and forecast

#50 unlocks #159 observability, #64 budgets and #91 journals. #127 unlocks #48; #79 then enables #129 drafts/#136 waiting. #162 metrics feeds #73 SLA and #137 ownership/routing. #128 integrates workspace behavior. Preserve all edges in the master graph, including #50 → #64/#91 → #51 → #87 → #88. #160 is independent production-readiness foundation.

Recalculated beta.2 forecast: **15 February 2027**, expanded forecast **5 February 2028**, pending publication with PR #165. Only #127 newly accepted effort was removed. Two reference lanes, 8h/day Monday–Saturday, 3× allowance including shared review remain unchanged. Frozen new-issue baseline dates were copied from the accepted alignment forecast; the historical baseline snapshot is byte-identical. The calculator now retains completed-node forecast evidence and honors actual prerequisite completion dates. Source/lane/review invariants and delayed-completion regression pass. Actual start is recorded separately from remaining-work forecasts.

Publish issue/Project/Wiki forecast updates after the recalculation integrates. Do not infer percentages from commits. Human updates every 30 minutes must include the evidenced estimate and active blockers; latest update reported #127 acceptance, #165/#166 checks, #79 active and #48 returned for review.

## Review and operational boundaries

Zero Copilot reviews requested. Repository auto-review removed; personal automatic review disabled and reloaded under owner authority. Its clearance receipt was posted 13:40:44 UTC; PRs were created after 14:11 UTC. The `Copilot development setup` CI job on #166 is deterministic dependency/index validation triggered by package.json, not a code-review request; no reviews were posted.

PR #164 used the standing sole-maintainer PR-only approving-review bypass after exact-revision checks. This is not independent human approval. Local GPG is unavailable; require and verify GitHub-signed squash integration. Preserve required CI/security, linear history and other protections. No production/provider activation, remote Cloudflare changes or external mail.

## Exact next actions

1. Finish PR #165 forecast/state validation; push rebased revision and wait for required CI. Merge only after exact-head validation and verify signed commit.
2. Refresh #166 from accepted main, pass required checks, integrate and publish reviewed Wiki sources and issue/Project receipts.
3. Review #48 foundation, keep a coherent draft PR for partial work and continue retained-behavior migration; integrate #79 authorization only with real negative/revocation/isolation evidence.
4. Reforecast only from accepted progress, update dependent GitHub records and this state, and keep newly cleared work ready.
5. Do not declare beta.2 ready until every #140 prerequisite and acceptance outcome is evidenced.

## Integration update — 10 September, 14:43 UTC

PR #165 merged at `6d6a6ef163da093a4277385e8f34b6fd0e439585` using owner-authorized review bypass after all exact-head checks and no review findings. Dedicated Codex Luna/low `publish_cost_acceptance` is verifying signature/tree, publishing its Wiki sources and assessing #50 closure/Project acceptance. Forecast publication remains pending.

PR #166 rebased onto this main; head `56436a5fc822d4c4c71c8206c373b1f9e2fc73a4`. Lint/typecheck/build/CodeQL passed; test job 102915857641 in run 34490551362 still running at last observation. Do not merge until all exact-head checks pass.

#48 is now draft PR #167. Coordinator corrected native event composition, loading-state handling, standalone CSS focus hooks, real keyboard activation and dialog focus-return tests; typecheck and five focused tests passed before rebase. Full retained application migration and complex-control keyboard/browser/performance evidence remain. Follow-up worker restart was rejected by native thread limit; do not claim that worker is running. Coordinator must resume this work or reuse a freed slot.

#79 worker returned commit `6f58bc9` then resumed to address Node22 full-suite execution and atomic revocation fencing review. Its acceptance is not yet approved. Feature scope and beta.2 gate remain unchanged.
