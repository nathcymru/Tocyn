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

Do not place secrets, customer data, hidden reasoning, model transcripts or machine-specific credentials in this structure. Agent artifacts must remain outside application runtime imports and deployment assets.
