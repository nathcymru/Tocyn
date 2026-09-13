# SLA workspace sort persistence — partial #137 evidence

Source base: `087a2172fd434a6cacc120e932a52a1d7e82644d`. This corrects the actual isolated-browser failure recorded in [#137](https://github.com/nathcymru/Tocyn/issues/137#issuecomment-5654616104). Queue/SLA priority integration is approved #137 scope; workspace persistence also supports #128.

## Defect and narrow change

The API's `OPERATOR_WORKSPACE_SORTS` already accepts `sla_priority`, but migration0029's `operator_workspace_state.sort_key` CHECK permits only the six older sorts. The repository writes the accepted value directly. A copy-only update reproduced the CHECK rejection while preserving the row after rollback; observed candidate budget headroom is not evidence of a budget denial.

Migration0077 rebuilds only that table and adds only `sla_priority` to the CHECK. All12 fields, revisions, JSON and byte constraints, default timestamps, selected ticket/panel, tenant/user PK and user-delete cascade remain unchanged. Every existing field is copied verbatim. There is no API, UI, permission, runtime budget or fallback change. No new index/probe is introduced; the new enum value is shorter than an existing maximum sort value.

## Executed evidence

- Three independent native SQLite tests apply real migrations through0076, preserve complete two-tenant workspace rows with colliding local user IDs, verify PK/FK/cascade and constraints, admit the new sort, reject unsupported values/invalid JSON/oversize values, and atomically abort corrupt historical data without dropping it.
- Fresh copy of the candidate cold database after0076 rehearsal: all97 table content digests unchanged across0077, including21tickets/1draft/1capacity/1workspace/1presentation-preference row. No incoming workspace FK or dependent trigger/view blocks rebuild. A subsequent SLA update succeeds inside a rolled-back test transaction. Foreign-key/integrity checks pass. The live store and original cold backup were not opened or modified by this rehearsal.
- Full existing workspace-admission Worker/D1 suite:20/20 passed, no skips (35.3seconds). Includes the new admitted SLA PUT, two exact GET reloads, stale revision409 with preserved state and foreign-tenant same-user sentinel, plus existing session/role/MFA/membership/policy, CAS, population and draft-resource checks. The new case first passed focused1/1 and existing negatives6/6 before the broader suite. Native test TypeScript and scoped lint checks passed.
- A reusable copy-only tool subsequently rehearsed0076 and0077 together from a fresh original cold backup; both migrations preserved existing fields and all96 other tables, with unchanged original file hashes and successful FK/integrity checks.

## Limits and delivery

This is a preserving schema fix, not full #137/#128/#140 acceptance. Actual browser SLA save/reload on the updated candidate remains required. The rehearsal uses a cold synthetic snapshot, not current live changes or a physical D1 billing/temporary-space proof. Candidate upgrade remains a separate coordinator decision after merge and a fresh cold backup; no reseed, reset or live migration was performed.

GPT owns the consequential schema correction/review. A second GPT owns the independent existing native HTTP test file; no cloud/local worker or Copilot request was needed for this small deterministic fix.
