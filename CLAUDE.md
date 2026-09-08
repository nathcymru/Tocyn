# Claude instructions for Tocyn

`AGENTS.md` is the authoritative repository-level instruction set. Read and follow it before making changes.

Use the relevant reusable playbooks under `.agents/skills/` and `.agents/workflows/`. Treat `.agents/resources/` as reference material and `.agents/state/` as the definition of persistent project state.

Do not create Claude-specific policy that conflicts with `AGENTS.md`, accepted ADRs, the current GitHub issue, or the approved roadmap. If instructions conflict, follow the authority order in `AGENTS.md` and report the conflict.
