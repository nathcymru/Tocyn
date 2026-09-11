# Graphify agent guidance — #218

Owner-authorized scope: enable the complete hosted Graphify catalogue for Tocyn and provide
shared agent instructions. No application feature, runtime or dependency changes.

On 11 September 2026, Codex OAuth login succeeded and native MCP discovery returned Graphify
1.28.1 with 24 tools, including workspace selection and durable memory. Project configuration
has no enabled/disabled tool filter. OAuth credentials are outside the repository.

Configuration is already present in the owner's Tocyn checkout. Instruction changes are on
`codex/graphify-agent-guidance`, isolated from ongoing beta.2 work. Existing sessions and
worktrees may require configuration refresh/trust; none were interrupted. The current chat
did not hot-load Graphify tools, so a Tocyn graph-grounded query is still unverified.

Next connection check: list repositories, resolve `nathcymru/Tocyn`, perform one bounded
lookup and compare its returned file span with local source. Do not equate catalogue/OAuth
verification with indexed-revision or query verification. Follow the Graphify skill.

Issue/PR receipts carry current integration and CI evidence. No Copilot review was requested.

## Verified after owner-requested restart

The beta coordinator resumed on 11 September and successfully called hosted list_repositories, graph_stats and a bounded query_graph. Tocyn was queryable and the indexed SHA exactly matched accepted main263479fec24030c957d698eec1aefb855985d7e9. Returned budget-authority.repository.ts lines32–46 were checked against that source revision. This supersedes the earlier session's unverified lookup status. Open feature branches remain newer than this index and require local source checks. Native workers do not automatically inherit the coordinator's connector availability. No paid extraction, provider work or Copilot review was invoked.
