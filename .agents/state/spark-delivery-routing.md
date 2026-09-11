# Verified standalone Spark routing — 11 September 2026

Owner explicitly required use of separately available GPT-5.3-Codex-Spark capacity. The coordinator had incorrectly treated general capacity as the effective limit; this supersedes that routing assumption.

Actual environment: standalone Codex CLI0.149.0, ChatGPT subscription authentication confirmed by login status. Explicit model gpt-5.3-codex-spark, official OpenAI provider. Existing credential store is keyring. The first --ignore-user-config launches omitted that setting, failed401 before work, and produced no result; corrected launches explicitly preserve cli_auth_credentials_store=keyring and forced_login_method=chatgpt with API-key environment variables unset. Do not repeat the failed launch. No paid/API fallback, resets, purchases or Copilot.

| Task | Environment/model | Effort | Result |
|---|---|---|---|
| Persist routing policy | Standalone Codex CLI / GPT-5.3-Codex-Spark | medium | AGENTS patch returned; root retained original adaptive/security constraints while incorporating the correction. Worker protected .agents/.git paths were not writable; root owns state/commit. |
| Forecast publisher dry run | Standalone Codex CLI / GPT-5.3-Codex-Spark | low | Found missing Project field read-back assertion; correction required before publication. No GitHub writes. |

Observed account controls before these runs: general Codex96%used; separately labelled Spark five-hour and weekly windows0%used. These are observations, not current balances or computed savings. User also confirmed Spark100%remaining. Official https://learn.chatgpt.com/docs/agent-configuration/speed explicitly identifies Spark's own usage limits; do not extrapolate this to every Work/Codex model. Coordinator shell/tooling availability is recorded separately from model billing.

Workers used isolated/non-overlapping scopes and actual CLI sessions. Native task-tree names do not include these CLI workers; account for CLI sessions explicitly. Temporary handoffs/results /private/tmp/tocyn-spark-workers, routing sourceworktree /private/tmp/tocyn-spark-delivery-routing. App source/security acceptance remains with root. Future routine work should use this verified Spark route rather than rediscovering it or exhausting the general allowance first.
