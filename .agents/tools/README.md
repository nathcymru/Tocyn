# Agent tool policy

Use the least-privileged tool that can complete the authorised task.

Approved categories include:

- local shell and repository commands for inspection, tests and builds;
- `tools/agent-context` for bounded code navigation;
- Git/GitHub APIs for branches, PRs, issues, checks, dependencies and Project metadata when authorised;
- browser/API tooling needed by a specifically scoped integration task;
- isolated local or staging data stores explicitly authorised by the issue.

Rules:

1. Read before write and verify the target repository/resource.
2. Prefer deterministic local checks before remote actions.
3. Never use a tool's technical capability as evidence of authority.
4. Do not deploy, provision, seed remote data, enable providers/email, change releases/tags or mutate production unless explicitly authorised.
5. Do not expose secrets or tenant/customer data through tool output, logs or agent prompts.
6. Record meaningful external mutations in the issue/PR completion receipt.
7. If a required tool or permission is unavailable, report the exact limitation; do not fabricate synchronization or create substitute infrastructure without approval.
