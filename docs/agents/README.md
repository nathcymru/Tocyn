# AI agent governance

Tocyn uses a vendor-neutral agent control plane.

- `AGENTS.md` — authoritative persistent rules and delivery boundaries.
- `.agents/skills/` — reusable specialist playbooks.
- `.agents/workflows/` — multi-step delivery procedures.
- `.agents/tools/` — tool-use boundaries.
- `.agents/resources/` — approved reference/context pointers.
- `.agents/state/` — definition of durable project state and handoff.
- `.github/copilot-instructions.md` and `CLAUDE.md` — compatibility shims pointing to the same authority.

## Living delivery record

Every substantial task is issue-driven and PR-based. Partial work remains visible through an existing/draft PR and issue progress receipt; complete work records merged evidence before the issue closes.

Project planning must distinguish immutable approved baseline dates from changing forecasts and actual delivery dates. This lets the roadmap show whether work is ahead or behind rather than continually moving the original target.

Persistent state belongs in GitHub, not a model's private memory. An agent should be able to resume from the issue, PR, Project and accepted documentation without access to the preceding chat.
