# #137 SLA workspace persistence fix

Branch `codex/137-persist-sla-sort`, base `087a2172fd434a6cacc120e932a52a1d7e82644d`.

Approved correction of actual browser finding: migration0077 adds the already accepted SLA sort to the persisted workspace CHECK, preserving every other column/constraint/row. [Evidence](../../docs/security/evidence/workspace-sla-sort-137-2026-09-13.md). Independent SQLite3/3, full workspace HTTP20/20, native types/lint and copied full candidate rehearsal pass; exact CI pending. No live state touched. Preserve #137 In progress/15% and baseline dates; full acceptance remains open.

Ownership: workspace_acceptance migration/SQLite/evidence; b2_dependency_audit existing HTTP test only; root final source/release review. Next: native HTTP result, root review, signed partial ready PR, exact CI/security, then explicit same-storage candidate upgrade decision. Zero Copilot or optional worker requests.
