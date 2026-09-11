# Verified standalone Spark routing — 11 September 2026

Owner explicitly required use of separately available GPT-5.3-Codex-Spark capacity. The coordinator had incorrectly treated general capacity as the effective limit; this supersedes that routing assumption.

Actual environment: standalone Codex CLI0.149.0, ChatGPT subscription authentication confirmed by login status. Explicit model gpt-5.3-codex-spark, official OpenAI provider. Existing credential store is keyring. The first --ignore-user-config launches omitted that setting, failed401 before work, and produced no result; corrected launches explicitly preserve cli_auth_credentials_store=keyring and forced_login_method=chatgpt with API-key environment variables unset. Do not repeat the failed launch. No paid/API fallback, resets, purchases or Copilot.

| Task | Environment/model | Effort | Result |
|---|---|---|---|
| Persist routing policy | Standalone Codex CLI / GPT-5.3-Codex-Spark | medium | AGENTS patch returned; root retained original adaptive/security constraints while incorporating the correction. Worker protected .agents/.git paths were not writable; root owns state/commit. |
| Forecast publisher dry run | Standalone Codex CLI / GPT-5.3-Codex-Spark | low | Found missing Project field read-back assertion; correction required before publication. No GitHub writes. |

Observed account controls before these runs: general Codex96%used; separately labelled Spark five-hour and weekly windows0%used. These are observations, not current balances or computed savings. User also confirmed Spark100%remaining. Official https://learn.chatgpt.com/docs/agent-configuration/speed explicitly identifies Spark's own usage limits; do not extrapolate this to every Work/Codex model. Coordinator shell/tooling availability is recorded separately from model billing.

Workers used isolated/non-overlapping scopes and actual CLI sessions. Native task-tree names do not include these CLI workers; account for CLI sessions explicitly. Temporary handoffs/results /private/tmp/tocyn-spark-workers, routing sourceworktree /private/tmp/tocyn-spark-delivery-routing. App source/security acceptance remains with root. Future routine work should use this verified Spark route rather than rediscovering it or exhausting the general allowance first.

## Subsequent worker checkpoint — 11 September, 19:35 BST

Three standalone Spark/medium workers ran concurrently: isolated inbox recovery tests, isolated customer-auth race tests, and a local CPU profiler harness. All stopped at the Spark five-hour limit before final validation. Observed limits: five-hour100%used, reset12September00:15:56BST; weekly45%used. General Codex96%used. No reset redeemed or capacity purchased. Do not restart Spark before its reset or count these workers as running.

Coordinator corrected incomplete tests: native credential issuance rollback cases2/2 and customer-runtime TypeScript pass; inbox workspace/state tests13/13 pass. Original unfinished patches are preserved under /private/tmp/tocyn-spark-workers. CPU harness failed local binding with EPERM; no CPU bound was established. Worker cumulative log token counts are not task billing or savings evidence.

Graphify server was exposed to Spark through mcp_servers.graphify.url=https://api.graphify.com/mcp, but calls failed because tool approval was required under a never policy. Root Graphify queries work; Spark querying is NOT verified. For the next authorised read-only probe, narrowly configure mcp_servers.graphify.tools.list_repositories.approval_mode=approve and mcp_servers.graphify.tools.query_graph.approval_mode=approve, per official MCP documentation. Preserve all other protections. Verify an actual bounded query before claiming Spark access. Do not repeatedly probe while rate-limited. Reduce bootstrap/context overhead before further worker runs.
