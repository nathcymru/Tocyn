# Persistent agent state

Tocyn does not use hidden agent memory as the authoritative record of project delivery.

Persistent state belongs in GitHub:

- issues: scope, acceptance, progress receipts and completion evidence;
- pull requests: implementation/review/validation history;
- Projects: status, baseline/forecast/actual dates, progress and roadmap views;
- milestones: architectural capability completion;
- Wiki/ADRs: approved durable decisions.

Before ending substantive work, ensure the next agent can recover state from the issue and PR without needing the previous chat transcript.

Never store credentials, customer/tenant data, private security findings or private reasoning in public issue/Project fields. Security findings follow `SECURITY.md`.
