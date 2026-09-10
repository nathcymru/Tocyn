# ADR-0010: Policy-gated actions and controlled reference validation

Status: Accepted by the deployment owner, 8 September 2026. Implementation pending. Applies across Tocyn, not only messaging plugins.

## Decision

Deployment-owner policy → tenant policy → runtime gate → action. A lower layer may restrict but never expand authority. Agents receive specific revocable capabilities, not standing unrestricted backend authority. Human/customer permissions use the same mandatory boundary. Presentation or tenant theming cannot determine permission enforcement.

Classify each actual tool/action: READ_ONLY may execute when authorised; LOW_RISK_WRITE may run unattended only when expressly permitted by owner and tenant; PRIVILEGED_WRITE defaults to human approval; DESTRUCTIVE requires explicit human approval; PROHIBITED can never execute. Example names do not automatically classify real integrations.

Every proposed mutation validates schema, integration credentials, trusted tenant, target ownership, action/risk classification, owner ceiling, tenant policy and runtime context. Outcomes: ALLOW_AUTONOMOUS, REQUIRE_HUMAN_APPROVAL or DENY. Unknown authority, malformed schema, tenant mismatch, unavailable policy or invalid approval cannot result in execution. No alternate endpoint, workflow or UI may bypass the runtime gate.

## Operation-bound approvals and takeover

Bind approval to tenant, service/resource target, tool/action, material parameters, requesting actor, approving human, proposal/approval timestamps, expiry and ticket/correlation ID. Material changes invalidate approval. Generic, stale or mismatched approvals grant no authority; a prohibited action has no approval override.

Human takeover transfers explicit ownership and fences queued/in-flight future mutations using a durable execution generation or equivalent enforceable mechanism. Already-completed external actions cannot be undone by a UI flag. Preserve context/proposals and stop autonomous mutation until expressly reauthorised; test the race between validation, dispatch and takeover.

## Observable audit and verification

Record every attempt, including denials: actor/agent, tenant/ticket, integration/tool/action/target, safe parameter representation, policy versions/classification/decision, approval linkage, execution attempt/response, independent state verification, failure reason, timestamps, final outcome and takeover. Redact credentials. Audit observable events and policy decisions, never hidden model reasoning. A 200 response alone is not proof of resolution.

## Controlled reference API

Use an isolated deterministic test service, resettable state, synthetic data and test credentials. No customer backend is a prerequisite. Label it clearly as a reference integration. Representative actions:

- READ_ONLY: get_instance_status.
- LOW_RISK_WRITE: clear_test_cache; first unattended write, followed by a read proving cache_state=cleared.
- PRIVILEGED_WRITE: rotate_test_api_key; propose, pause, approve the actual operation, execute and independently verify.
- DESTRUCTIVE: delete_test_instance; prove explicit approval is mandatory (actual destructive execution is optional for the first demonstration).
- PROHIBITED: disable_audit_logging; deny despite any attempted tenant override.

Automated and manual acceptance covers owner-allow/tenant-allow; tenant-require-approval; tenant-disable; owner-prohibit/tenant-attempt-allow; invalid credentials/parameters; unknown classification; missing policy; target mismatch; expired/different approval; unavailable policy; execution timeout; unexpected backend response; idempotent retry; verification failure; takeover racing queued actions. Distinguish uncertain external effects and reconcile rather than blindly repeat mutations.

## Workflow authoring independence

First autonomous reference execution uses a typed/schema-validated, versioned, bounded, auditable, testable code-owned declarative definition. It remains subject to every policy gate and requires no visual authoring UI. M5.5 later visually authors, validates, dry-runs, versions and publishes definitions for the same proven executor. Do not build a second workflow engine.

## Consequences

Prove governed execution before choosing a real customer adapter. Later real integrations add provider authentication, permissions, resource mapping, rate limits, lifecycle and sandbox acceptance without redesigning authority. The reference harness is not production customer capability. Human-led API/portal beta remains independent of autonomous execution.

Implementation: [#79](https://github.com/nathcymru/Tocyn/issues/79), [#80](https://github.com/nathcymru/Tocyn/issues/80), [#81](https://github.com/nathcymru/Tocyn/issues/81), [#82](https://github.com/nathcymru/Tocyn/issues/82), [#83](https://github.com/nathcymru/Tocyn/issues/83), [#86](https://github.com/nathcymru/Tocyn/issues/86), [#78](https://github.com/nathcymru/Tocyn/issues/78).


## Owner addendum — 10 September 2026

[[Post-beta-master-baseline]] controls current sequencing and review policy. Accepted architecture remains; governed actions #79/#80/#81 are implementation pending. Beta.1 is published local-only at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full #73 SLA and #137 ownership/routing. M8/M9 are accepted direction, implementation pending. Historical dates above remain evidence; current calculated forecasts do not replace baseline history. Zero default Copilot reviews; owner PR-only review bypass after substantive checks, signing and thread resolution.
