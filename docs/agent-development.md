# Agent development tools

Tocyn's development policy uses GPT-6 coordination, bounded local/free cloud workers,
and Graphify-first discovery. Read the [worker decision model](../.agents/skills/tocyn-worker-routing/SKILL.md)
and [resource snapshot](../.agents/resources/development-workers.md) for capabilities,
memory/quota limits and failure recovery. Workers return proposals; the coordinator
verifies and integrates changes. GitHub Copilot is reserved for essential final-ready
code/security review under [AGENTS.md](../AGENTS.md), with zero requests by default.

Tocyn also provides a small, deterministic TypeScript navigation index for ordinary
checkouts and the exceptional authorised GitHub Copilot environment. It makes **no model/API calls**,
requires no credentials, and adds no npm dependencies. TypeScript is already a root
development dependency. Application scripts, dependencies and Cloudflare bindings are unchanged.

## Usage

```sh
npm ci --ignore-scripts
node tools/agent-context/index.mjs build
node tools/agent-context/index.mjs query CustomerAuthService
node tools/agent-context/index.mjs impact apps/server/src/services/customer-auth.service.ts 4
node --test tools/agent-context/index.test.mjs
```

The Copilot setup workflow prepares this index automatically once merged to `main`.
Copilot also discovers the focused skills in `.agents/skills`; `AGENTS.md` routes other
agents to the same instructions. No installation into personal/global agent directories
is needed. GitHub's setup behavior is documented in [the environment guide](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment),
and project skill locations in [GitHub's skill guide](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

Lifecycle scripts are deliberately not run during setup. If a task actually needs a native
dependency, inspect its locked install script and rebuild that specific package. Existing
CI retains its application install/test process. Setup failures are visible in Actions;
an agent should use `rg` and report the failure rather than assume the index exists.

## What the index provides

- Tracked TS/JS files under `apps`, `packages` and `scripts` with identifiers and line numbers.
- Import/re-export edges resolved with TypeScript and nearby tsconfig options, including
  reverse imports for a directly affected file. External/unresolved imports remain labelled.
- An ignored `.agent-context/index.json` cache, refreshed when source, tracked configuration,
  compiler version or indexer changes. Nanosecond modification/change times and file sizes
  detect changes before reading source contents; unchanged queries reuse the parsed graph.
  Stage new files before indexing them.
- Eight results by default, a maximum of twenty, bounded symbols/edges and a 16,000-character
  output ceiling. Use a narrower query or lower limit to get smaller results.

It does not resolve computed calls, SQL relationships, runtime authorization, all framework
conventions or a transitive call graph. Some local variable identifiers are included.
Read source to confirm meaning. Files over 1 MiB, generated directories and symlinks are
excluded. It is a navigation aid, not a secret scanner; do not commit secrets in any source.
Generated output contains no source bodies, comments or literal values, and is not uploaded
as a workflow artifact. It can be deleted and rebuilt at any time.

## Hosted Graphify and local fallback

The owner has enabled hosted Graphify for Tocyn through project-scoped
[Codex configuration](../.codex/config.toml). Its full server tool catalogue is exposed,
including repository discovery, semantic queries, call paths, impact/test navigation,
workspace selection and durable memory. OAuth credentials remain in Codex's credential
storage, outside this repository. Existing sessions may require a tool refresh or reopening;
existing worktrees need this configuration and project trust before discovery succeeds.

Use the [Graphify skill](../.agents/skills/tocyn-graphify/SKILL.md) and its detailed
[workflow reference](../.agents/skills/tocyn-graphify/references/hosted-workflow.md).
They replace the earlier recommendation to defer Graphify adoption. The earlier decision
concerned installing the local Python/parser stack; hosted access does not install that
stack, change application dependencies, or require a second graph build.

The deterministic index described above remains useful offline, in clients without the
connection, and for checkout-specific navigation when the hosted graph is stale. Do not
routinely run both. Graph-derived risk and linked tests do not execute validation.

Querying before broad reads is intended to reduce context consumption. There is no measured
claim about Copilot credits saved: provider billing and model behavior differ. Compare
actual task usage and correctness before claiming savings. Do not trade away relevant
security context to meet a token target.

## Deployment separation

The checked-in navigation executable lives under `tools/agent-context`, outside application workspaces.
The optional Ollama bridge, models and credentials remain in the maintainer's host
environment; repository instructions do not install or deploy them.
It is invoked only by development commands and the GitHub setup workflow, with a read-only
token and no deployment environment, secrets, upload step or Cloudflare command. Neither
application package scripts nor entrypoints import it. `.agent-context/` and `graphify-out/`
are ignored. Cloudflare deploys the existing Worker entrypoint and app `dist` outputs;
do not add these development paths to public asset directories or deployment scripts.
