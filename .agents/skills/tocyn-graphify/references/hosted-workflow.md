# Tocyn hosted Graphify workflow

## Connection and scope

Project `.codex/config.toml` contains only `[mcp_servers.graphify]` and
`url = "https://api.graphify.com/mcp"`. There is no tool allowlist or denylist.
Use `codex mcp get graphify --json` to inspect configuration and `codex mcp list --json`
to inspect authentication status. Run `codex mcp login graphify` if OAuth is needed;
let the owner complete sign-in. Never copy OAuth material into repository files or prompts.
Do not add a duplicate global server. Modern Codex requires neither an `auth = "oauth"`
TOML field nor the legacy experimental remote-client flag.

A configured/authenticated server is not proof that this running agent has loaded its tools.
Refresh the connection or reopen the task when supported, without interrupting other agents.
An isolated worktree needs the versioned configuration and its own applicable project trust.
Do not silently edit another active worktree or claim its agent now has access. Other clients
need their own connection; this Codex configuration does not configure ChatGPT or Copilot.

First lookup: `list_repositories` → confirm `nathcymru/Tocyn` and queryability → a bounded
query → verify a returned file span against the checkout. If the repo is missing, use
`list_workspaces`, then `set_workspace` with an observed handle and `make_default: false`.
Do not guess IDs, target a similarly named repo, or change the account-wide default.

## Tool selection

Catalogue verified against hosted Graphify 1.28.1 on 11 September 2026; rediscover schemas
if the server changes. Pass `repository_id: "nathcymru/Tocyn"` (or the verified returned ID)
to every repository-scoped tool. The actual catalogue includes:

| Need | Tools | Bounded use |
| --- | --- | --- |
| Repository/workspace discovery | `list_repositories`, `list_workspaces`, `set_workspace` | Resolve once; switch only if necessary. |
| Graph summary | `graph_stats` | Inspect exposed metadata; counts alone do not prove freshness. |
| Locate code | `graphify_rank_files`, `graphify_find`, `graphify_find_seeds` | Start at five results; narrow the question. |
| Semantic context | `query_graph` | Start at 1,500 tokens, three seeds, skeleton output. |
| Definitions | `graphify_expand`, `graphify_node` | Expand selected returned handles or a specific symbol. |
| Calls | `graphify_callers`, `graphify_callees`, `graphify_trace` | Prefer `strict_calls: true`; constrain result/path count. |
| Other dependencies | `graphify_references`, `graphify_imports_exports`, `graphify_file_neighbors` | Distinguish imports/references from runtime calls. |
| Paths/visual context | `shortest_path`, `graphify_render_subgraph` | Small seed set and bounded depth/nodes/edges. |
| Change and test planning | `graphify_impact`, `graphify_tests_for`, `impact_and_risk` | Static candidates only; inspect and execute actual checks. |
| Prior evidence | `recall`, `memories_about` | Start with `k: 3`; reuse relevant verified findings. |
| Durable facts | `remember` | One useful concise note, scoped to Tocyn and supported by evidence. |

Use schema-defined parameters, not tool names copied from older examples (`get_node`,
`path` and `explain_style` were not in this catalogue). Do not invent unavailable tools.

## Example: locate inbox selection and drafts

These are example requests, not assertions that a lookup has succeeded:

```json
{"repository_id":"nathcymru/Tocyn","question":"Where does the operator inbox keep selected conversation and unsent draft state?","limit":5}
```

Send to `graphify_rank_files`. Read the relevant returned file spans and inspect local
changes. If definitions are needed, use returned node handles with `graphify_expand`, or:

```json
{"repository_id":"nathcymru/Tocyn","question":"How are operator drafts restored after changing the selected conversation?","budget":1500,"k":3,"skeleton":true}
```

Send to `query_graph`. Expand only the relevant definitions afterward. For an actual
returned symbol/path, use `memories_about` to check previous decisions, then callers,
impact and linked tests as appropriate. Do not run the entire catalogue for this question.

## Freshness and negative evidence

Record local HEAD/branch and relevant uncommitted files. Compare an indexed commit when
metadata exposes it; otherwise label indexed revision unknown. A recent index timestamp
or successful OAuth login does not prove it contains the current branch. Source spans can
move. Re-read the local definition before editing and check imports/callers when consequential.

EXTRACTED, INFERRED or AMBIGUOUS confidence labels, when returned, describe graph evidence;
none proves runtime authorization, tenant isolation or correct failure handling. A missing
node/test/path is not proof of absence. Use local search for migrations, SQL, configuration,
dynamic dispatch and newly introduced code. Do not claim a semantic path is an exact call
path without supporting edges and source. Use linked tests to select checks, not to claim
coverage or passing validation. Do not upload synthetic credentials or sensitive fixtures.

## Shared memory without duplicate work

Before a new investigation, retrieve a few relevant memories with `recall` (query) or
`memories_about` (target file/symbol). Read existing repository state and issue receipts too;
avoid copying all of them into prompts. Compare memory revision/status with current evidence.

After a material finding, `remember` may store a short factual note such as:
“#NN / PR #MM; revision <verified SHA>; <file/symbol>: <verified constraint or outcome>.
Validation: <actual check>. Status: merged / branch-only / proposal. Remaining: <limitation>.”
Replace placeholders with real evidence; never publish the example as an actual receipt.
Use a small stable tag set if helpful. Omit `session_id` when cross-session recall is wanted.

Retrieve before adding a near-duplicate. For a correction, cite the old note and explain the
verified replacement; do not pretend an immutable earlier note was deleted. Current owning
issues, approved ADRs and AGENTS.md retain authority. Do not record every tool call, temporary
hypothesis, private reasoning, customer content, credentials or unpatched security findings.
Full memory-tool availability does not authorize messaging people or unrelated workspaces.

## Failure, cost and fallback

One connection/schema check is usually enough after a failure; avoid retry loops. Continue
with local source and `tools/agent-context` if hosted access is unavailable. Reuse installed
dependencies; do not run `npm ci` merely to query a graph if direct `rg` answers the question.
Do not duplicate the hosted index through local extraction, background watchers or hooks.
Graphify and model allowances are separate unknowns unless observed; no measured savings
are claimed. Do not purchase capacity, enable overages or supply an API key as a fallback.

## Upstream provenance

This is Tocyn-specific hosted guidance, informed by the
[skill directory](https://graphify.net/skills/graphify/), the
[hosted MCP guide](https://graphify.com/mcp), and the inspected
[upstream Codex skill](https://github.com/Graphify-Labs/graphify/blob/23f2ffaa43fd12f25d9eabe91e6d184b5d89b474/graphify/skill-codex.md).
The directory describes an older release. The pinned upstream version includes local
extraction/installation and multi-agent workflows; those are not installed or implicitly
authorized by this hosted integration. Use the live tool schema over outdated examples.
