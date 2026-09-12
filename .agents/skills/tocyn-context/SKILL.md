---
name: tocyn-context
description: Locate Tocyn implementation and tests with bounded context, inspect import impact, and choose focused checks when investigating or changing this repository.
---

For delegation, use [worker routing](../tocyn-worker-routing/SKILL.md): the coordinator
retrieves and verifies a compact packet once, reuses it across non-overlapping
assignments, and brokers only needed follow-up lookups. Ollama workers cannot crawl
the checkout; proposed patches still need source verification and actual tests.

1. Inspect the task, `git status --short` and relevant diff. Reuse findings already established.
2. For unfamiliar areas, use [tocyn-graphify](../tocyn-graphify/SKILL.md) when available.
   Verify graph findings against this checkout; skip graph discovery for a known small edit.
   When hosted context is unavailable or insufficient, run `node tools/agent-context/index.mjs query CustomerAuthService` (replace the symbol).
   For callers, use `node tools/agent-context/index.mjs impact apps/server/src/services/customer-auth.service.ts`.
   Default output is eight files; lower the limit if needed. The cache refreshes automatically.
3. Read relevant source ranges, then tests. Use `rg -n` for SQL tables, routes, configuration,
   dynamic imports and unresolved aliases. No match does not establish absence.
4. Run the smallest meaningful check first. Server: `npm run typecheck --workspace=apps/server`
   and `npm exec --workspace=apps/server -- vitest run <path-relative-to-apps/server>`.
   Portal: `npm run lint --workspace=apps/portal` and its targeted Vitest tests.
   Navigation tool: `node --test tools/agent-context/index.test.mjs`.
5. Run broader required CI checks before delivery when affected. Summarize evidence, failures
   and untested behavior; do not repeatedly rerun successful checks without a concrete reason.

The local fallback graph contains identifiers, source locations and import edges, not a call graph or
security proof. Only tracked TS/JS is indexed; new files need `git add` before indexing.
Do not ingest `.agent-context/index.json` wholesale, install global agent packages,
add a second ingestion service, or include development tooling in application bundles.
Read `docs/agent-development.md` only for setup, limitations or extending the tool.
