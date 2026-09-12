# Tocyn agent control plane

This directory contains reusable, vendor-neutral support for coding agents. `../AGENTS.md` is the authoritative repository rule set.

| Area | Purpose |
| --- | --- |
| `skills/` | Reusable capability-specific playbooks. |
| `workflows/` | Multi-step delivery procedures. |
| `tools/` | Approved tool boundaries and usage guidance. |
| `resources/` | Authoritative context and reference pointers. |
| `state/` | Persistent project-state rules and handoff expectations. |
| `rules/` | Scoped additions to `AGENTS.md`; they may not contradict it. |

Start substantive development with the [worker-routing decision model](skills/tocyn-worker-routing/SKILL.md)
and [dated resource snapshot](resources/development-workers.md). GPT-6 coordinates;
local/free cloud workers handle useful bounded tasks, with Graphify context and
AGENTS.md's zero-default, final-ready-only exceptional Copilot review policy.

Do not place secrets, customer data, hidden reasoning, model transcripts or machine-specific credentials in this structure. Agent artifacts must remain outside application runtime imports and deployment assets.
