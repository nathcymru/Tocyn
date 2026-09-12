---
name: tocyn-worker-routing
description: Choose development resources and delegate bounded Tocyn work to local or free cloud Ollama workers with GPT-6 coordination, Graphify context, useful concurrency and scarce review allowance.
---

# Development worker routing

Follow [AGENTS.md](../../../AGENTS.md), the owning issue and the maintainer's current
instruction. This is development tooling, not Tocyn's product-agent architecture.
Use the [resource snapshot](../../resources/development-workers.md) as dated setup
evidence; discover actual tools, authentication, model identity and capacity before
counting a route as available. Do not perform a new inference probe for every task
when the current session already provides sufficient evidence.

## Decision model

Evaluate scope and risk before cost. Retain consequential decisions with the GPT-6
coordinator; an isolated low-risk part of a high-risk issue may still be delegated
using synthetic context. Route only the affected subtask, not the whole issue.

| Decision | Default route | Examples / stopping condition |
| --- | --- | --- |
| Can a bounded deterministic tool do the work without model judgment? | Coordinator invokes that tool | Exact extraction, formatting, diff/link checks, running tests. No worker merely to run a one-step command. |
| Does it decide security/tenant boundaries, architecture, migration safety, concurrency or release acceptance? | GPT-6 coordinator, appropriately higher effort | Workers may draft synthetic cases; coordinator owns the substantive conclusion and actual checks. If GPT-6 is unavailable, disclose the model and defer unsupported consequential decisions. |
| Is it small, well specified, and within local input/memory limits? | Local `ollama_local.tocyn_coding_task` | Draft a helper, small test cases, explain verified source, propose a mechanical patch. Refusal does not permit reducing headroom. |
| Is it heavier but contained, with reviewable acceptance criteria and cloud-safe context? | Free `ollama_cloud.tocyn_coding_task` | Multi-function proposal, bounded analysis or test design; GPT-6 verifies the output. Stop on quota/auth errors; no paid substitution. |
| Does it require real isolated file edits/tool execution that the Ollama proposal tools cannot provide? | Available native or subscription-authenticated CLI worker, or coordinator | Use only when capability or observed capacity justifies ChatGPT/Spark usage; separate ownership and sandboxes, actual model/effort recorded. |
| Is the task trivial, tightly dependent on current coordinator work, or more expensive to hand off than complete? | Coordinator | State a short reason for substantive work; do not create artificial parallel tasks. |
| Is essential code/security risk unresolved after implementation, focused review and checks? | Apply AGENTS.md exceptional final-ready Copilot gate | Zero by default, one justified consolidated request at final head; any repeat needs explicit maintainer authority. Not a general worker route. |

These are preferences based on capability and cost, not a promise that any model is
best at every task or that delegation always reduces total tokens. If a worker fails,
give at most one focused correction using the observed error; then take over or
choose another permitted route. Do not cycle workers on the same unresolved problem.

## Context and parallel work

1. Follow the [Graphify skill](../tocyn-graphify/SKILL.md). For unfamiliar code, start
   with a bounded repository-scoped query; compare the indexed commit with HEAD and
   uncommitted edits. Retrieve relevant bodies/tests and verify them locally. For a
   known small edit, read the file directly. Do not run both indexes routinely.
2. Prepare the smallest reusable packet: issue acceptance, exact task, file/symbol
   references and revision, verified excerpts, boundaries and expected result.
   Exclude credentials, customer/tenant data, unpatched exploit details and unrelated
   logs. Do not give each worker the entire conversation/repository or private reasoning.
3. Split independent deliverables with explicit ownership. Prefer one local and one
   cloud worker concurrently when useful; free cloud requests are serialized and
   the local lock/memory guard must pass. These workers can overlap the coordinator's
   useful work. Additional native workers require a concrete capability/capacity
   reason, not a desire to maximize the worker count. Do not duplicate investigations.
4. Workers return proposals and may emit `graphify_requests`. The coordinator checks
   relevance, executes at most three bounded read-only queries total for `nathcymru/Tocyn`,
   and resubmits compact augmented context. Spread those queries across at most two retrieval rounds before
   coordinator takeover. No independent worker Graphify login or repository crawling
   is configured. Do not copy OAuth credentials to workers.
5. One integration owner applies accepted changes, resolves overlaps and runs the
   meaningful focused checks. Inspect a proposed patch without redoing the entire
   discovery unless evidence is missing or contradictory. Use the delivery workflow
   for broader required checks, PR, signing, review findings and acceptance.

## Handoff and return contract

Supply: owning issue, specific outcome, allowed files/symbols, verified context
revision, acceptance examples, exclusions, output format and stopping bounds.

Require: concise proposal/patch or findings with source references, assumptions and
uncertainties, suggested checks, and any requested missing context. Ollama cannot
claim file edits or tests executed. Execution-capable workers must return actual
changed files/revision, commands/results and limitations. No hidden reasoning or
full transcripts. An empty/truncated/error result is not completion or approval.

Record the route, actual model/effort where exposed, successful outputs, checks,
observed token counts/limits and unresolved work. Do not equate inference token
counts with total coordinator usage, monetary cost or guaranteed savings.

## Failure and recovery

- Local memory refusal: report the supplied shortfall and approximate process groups.
  Preserve system headroom; suggest saving/closing unused work or stopping a confirmed
  idle owned service. Never kill apps/system processes or another task's model without
  authority. Recheck after an actual change and retry once, or use free cloud.
- Cloud 401/402/429 or timeout: classify the error, report it and stop repeated calls.
  Renew authentication only through the authorised login/key workflow. A public model
  list does not establish key validity or free-tier access. Don't buy credits.
- Missing/stale MCP tools: refresh/reopen when appropriate or use the already-installed
  host helper if available; report a missing installation once. Do not install a runtime
  in every worktree or silently substitute an API-billed route.
- Keep the previous roadmap baseline and verified receipts intact. Use a brief explicit
  handoff for unavailable routes rather than claiming that offloading happened.
