# Development routing policy — issue #258

Owner instruction, 12 September 2026: GPT-6 coordinates; use local/free cloud workers
for suitable bounded tasks and useful parallel delivery; reserve scarce GitHub
Copilot allowance for essential final-ready code/security review only.

Canonical decisions: [AGENTS.md](../../AGENTS.md), [worker skill](../skills/tocyn-worker-routing/SKILL.md),
[dated resource snapshot](../resources/development-workers.md). Earlier Spark routing
is retained as historical evidence. No application or release scope changes.

## Delivery checkpoint

- Issue: [#258](https://github.com/nathcymru/Tocyn/issues/258).
- Branch: `codex/258-worker-routing-policy`.
- Policy and cross-file alignment drafted; final acceptance requires PR checks and integration.
- Resource setup was verified in the preceding owner-authorised workstation session;
  this PR documents it and does not install the bridge or distribute credentials.
- One native read-only audit identified instruction conflicts; a follow-up validated
  five decision scenarios, with the query budget clarified to three total queries
  across at most two retrieval rounds. Native model/effort inherited the coordinator;
  no independent allowance is claimed.
- One free cloud gpt-oss:120b policy-edge-case probe ran using compact supplied
  context (593 input / 360 output tokens). Its proposed serialisation, expanded
  context bounds and approval-token machinery conflicted with owner scope or actual
  controls and were rejected. Worker output is not authority or independent approval.
- Local inference was not needed for this documentation-only change. Mechanical
  edits and deterministic documentation validation stay with the coordinator.
- Live ruleset 22454811 retains deletion/non-fast-forward protections but has no
  automatic Copilot review rule. Checked-in Copilot setup remains workflow_dispatch
  only. Required CI/security rules are preserved. Copilot requests: zero.
- Project status In progress; Actual start and Forecast target 2026-09-12. No new
  approved baseline/milestone and no historical roadmap dates altered.

Next: complete focused documentation validation, open the coherent ready PR, verify
exact-revision required checks/signing and resolve findings, then record integration
and issue/Project acceptance. Do not treat this checkpoint as merged completion.
