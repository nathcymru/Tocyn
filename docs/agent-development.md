# Agent development tools

Tocyn uses a small, deterministic TypeScript navigation index for development inside
GitHub's Copilot environment and ordinary checkouts. It makes **no model/API calls**,
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

## Why this instead of Graphify

[Graphify](https://github.com/Graphify-Labs/graphify) offers broader language and semantic
knowledge-graph features. Its inspected `graphifyy` 0.9.55 manifest brings a separate Python
stack and many language parsers, with optional model/service integrations. For Tocyn's
current TypeScript monorepo, the smaller alternative meets the immediate need without
that additional installation and maintenance surface. This is not Graphify installed or a
claim of feature parity. Revisit it when cross-language or semantic navigation is needed,
with a pinned dependency lock, reviewed sources and explicit model-cost controls.

Querying before broad reads is intended to reduce context consumption. There is no measured
claim about Copilot credits saved: provider billing and model behavior differ. Compare
actual task usage and correctness before claiming savings. Do not trade away relevant
security context to meet a token target.

## Deployment separation

All executable tooling lives under `tools/agent-context`, outside application workspaces.
It is invoked only by development commands and the GitHub setup workflow, with a read-only
token and no deployment environment, secrets, upload step or Cloudflare command. Neither
application package scripts nor entrypoints import it. `.agent-context/` and `graphify-out/`
are ignored. Cloudflare deploys the existing Worker entrypoint and app `dist` outputs;
do not add these development paths to public asset directories or deployment scripts.
