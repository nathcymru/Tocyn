# ADR-0015 — Privacy metadata is not an access-control authority

- **Status:** Accepted
- **Date:** 8 September 2026

## Context

Tocyn plans FidesLang-based privacy-as-code metadata under #16/#17. FidesLang describes privacy-relevant data categories, subjects and uses. Tocyn also enforces multi-tenant authentication/authorisation boundaries.

Combining those concerns would create a dangerous failure mode in which disabled, missing or malformed privacy metadata changes who can access tenant data.

## Decision

FidesLang/privacy declarations are descriptive governance metadata and are completely decoupled from system-level access enforcement.

Authentication, authorisation, verified tenant scope, scoped repositories/storage and policy-gated action controls remain authoritative regardless of whether optional privacy metadata or privacy UX is enabled.

A FidesLang declaration, privacy request, email address, tenant path or orchestrator instruction is never sufficient authority to read, export, erase or mutate tenant data.

The future metadata layer may be consumed by a Fides-based control plane or by custom/third-party orchestration, but those systems must call Tocyn/deployer-controlled tenant-scoped interfaces using explicit credentials and policy.

## Current implementation status

As of the decision date, `main` does not yet contain FidesLang declarations. #16/#17 own representation, measurable coverage, validation and optional controls. Documentation must label that architecture as planned until those issues are implemented and released.

## Consequences

- disabling privacy UX cannot disable tenant isolation;
- privacy automation must verify requester/tenant authority before execution;
- metadata may help discover data but does not determine legal entitlement or exemptions;
- vulnerabilities in privacy orchestration or exposed policy files are security-reporting scope;
- development metadata/examples must not contain real tenant data.

## Related

- `PRIVACY_POLICY.md`
- `SECURITY.md`
- `docs/privacy/privacy-architecture.md`
- issues #16 and #17
- M5.4 Privacy Metadata & Controls

## Current direction addendum

Workspace drafts, attention state, linked work, feedback and contextual assistance remain subject to this boundary: metadata, presentation state and operator feedback never grant tenant access. Their planned storage and retention treatment is described in [ADR-0018](ADR-0018-durable-operator-attention-and-continuity.md), [ADR-0022](ADR-0022-data-residency-and-storage-boundaries.md) and [ADR-0026](ADR-0026-access-identity-and-permission-boundaries.md). This is implementation pending.
