# Development resource snapshot — 12 September 2026

Policy authority: [AGENTS.md](../../AGENTS.md). Operational decision model:
[worker-routing skill](../skills/tocyn-worker-routing/SKILL.md). Delivered under #258.
This records one verified maintainer workstation/account, not a repository-installed
service, a forever-valid allowance, or application production capacity.

| Resource | Verified capability | Limits / use |
| --- | --- | --- |
| GPT-6 coordinator | Owner-selected preferred coordinator | Retains scope, high-risk decisions, integration, actual validation and acceptance. Read the runtime's actual model; do not claim an unavailable switch. |
| `ollama_local` | `tocyn_coding_task`, default `granite4.2:3b` (Q4_K_M) | Proposal and context-request tool; no shell/filesystem access. 4096 context, 6000 combined input characters, at most 2048 output tokens (default 1024), batch 128, thinking off. |
| `ollama_cloud` | Same worker tool, default `gpt-oss:120b`; authenticated inference verified on Free | Heavier contained tasks; 8192 context, 8000 task/24000 context character ceilings, at most 8192 output tokens (default 1024). Use small packets well below ceilings to leave token headroom. One free cloud request at a time; current allowance may be exhausted. |
| Hosted Graphify | OAuth-authenticated `nathcymru/Tocyn` graph | Coordinator retrieves/verifies compact context and brokers worker lookup requests. No separate direct Graphify connection in Ollama workers. |
| Native / standalone Spark workers | Secondary execution-capable resources, if exposed | Native workers are not assumed free or a separate allowance. Spark has separately reported limits only when actually observed; preserve subscription credentials and sandbox restrictions. |
| GitHub Copilot | Scarce exceptional code/security review | Zero by default. AGENTS.md final-ready justification and repeat-review rules apply. CodeQL and required CI remain mandatory independent gates. |

## Local memory and measured result

The maintainer Mac has 16 GiB RAM. The worker uses a single-worker lock, rejects
another loaded model, and checks a **6 GiB soft loaded-model budget**, a **3 GiB
cold-load estimate**, and **3 GiB system headroom**. Thus a cold start needs 6 GiB
available; a compatible already-loaded model needs the 3 GiB reserve. These are
preflight checks, not a hard macOS RSS limit or continuous memory monitor. Other apps
can change RAM consumption during a request. A 30-second idle residency releases
the worker's model; no apps are automatically terminated. Refusals include a local
memory report and recovery suggestions for the coordinator, not model prompts.

Measured small source-analysis test: correct four-route answer, about 6.2 seconds
including startup, peak Ollama-reported model allocation 2.42 GiB, minimum available
system RAM 5.53 GiB; 642 input / 71 output worker tokens. A separate request emitted
a valid Tocyn Graphify lookup (468 input / 44 output tokens). Eight focused bridge
tests passed. This is smoke-test evidence, not an advanced-coding benchmark, total
app-footprint measurement or speed/token-savings claim. The previous 8B
`granite4.2:latest` was deleted; it is not an available local fallback.

## Cloud evidence and funding boundary

The account's Free model list at verification included `gemma4:31b`, `gpt-oss:120b`,
`gpt-oss:20b`, `nemotron-3-nano:30b`, `nemotron-3-super` and `nemotron-3-ultra`.
GLM-5.3-Flash and Kimi K2.7 Code both returned 402 requiring a subscription or usage
credits; do not route to them on the assumption they are free. gpt-oss:120b is the
chosen tested heavier worker, not a claim of universally best coding performance.

The original setup showed 0% included usage used, no purchased credit balance and
automatic reload off. Those are historical observations, not remaining capacity.
Observe current errors/usage when needed; stop on exhaustion. No paid credits,
upgrades, top-ups or billing fallback are authorised. Listing the public catalog
does not test authentication; an actual model request did.

## Host installation and invocation

The two stdio MCP servers and Python bridge are installed in the maintainer's user
environment, outside Tocyn. The compatible MCP dependency is 1.30.0 with a `<2`
constraint; cloud endpoint is `https://ollama.com`. Credentials remain in private
host storage. Nothing here grants other developers an installed worker or shares
that account. Do not commit keys, private key paths, OAuth tokens or browser state.

Discover the actual server tools before invocation. The common request is:

```json
{"task":"A bounded approved task","context":"Verified source and relevant Graphify results","max_output_tokens":1024}
```

The installed bridge uses a 180-second inference timeout and the MCP client/helper
uses a 240-second outer timeout. A timeout is failure, not permission for unlimited
retries or a paid route.

The result contains `success`, `model`, `proposal`, `graphify_requests`, `truncated`
and usage counts, or an error/memory report. The coordinator executes relevant
Graphify requests with `repository_id: nathcymru/Tocyn`, typically `budget: 1500`,
`k: 3`, `skeleton: true`, then verifies source. No worker receives credentials.

Existing desktop sessions may need a refresh/restart to see new defaults/tools.
The maintainer's installed `ollama-tocyn-workers` user skill contains the host-local
MCP helper invocation for sessions lacking native tools. Read it if available;
otherwise report the unavailable route. This repository skill remains discoverable
without installing that personal skill. It does not install a model, CLI or server.
