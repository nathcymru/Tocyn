# Tocyn roadmap

These are maintainer-approved targets, not statements of completed work or promised dates. Coordinate implementation with active contributors before starting overlapping work.

| Milestone | Outcome |
| --- | --- |
| v0.1.0 | Repository and security foundations; agreed coding conventions; FidesLang across the majority of applicable application code |
| v0.2.0 | Systematic whole-codebase FidesLang review and coverage across all applicable areas |
| v0.3.0 | Replace Resend with Cloudflare-native email, including migration and operational documentation |

## v0.1.0: foundations

Establish working PR checks and appropriate repository rules. Review the whole codebase for vulnerabilities and general health, triage findings and resolve release-blocking risks. Define and implement coding conventions in a separate formatting change.

Inventory privacy-relevant data structures, processing operations, storage and integration boundaries. Define the FidesLang representation and validate coverage against that inventory. Report the numerator, denominator and exclusions when claiming majority coverage.

Define the tenant-isolation model and meaningful cross-tenant tests. An early release is not a claim of production readiness.

## v0.2.0: complete privacy coverage

Review every application area against the inventory, implement the remaining applicable metadata and document justified exclusions. Add validation to prevent regression.

Make the functionality that consumes this metadata available as an option to end users, with documented configuration, enabled/disabled behaviour and examples. Metadata and optional tooling do not replace mandatory security or tenant isolation.

## v0.3.0: Cloudflare email

Verify native email capabilities against required inbound/outbound flows, authentication messages, replies, attachments, delivery failures and operational needs. Replace Resend, document migration and remove obsolete dependencies, configuration and instructions.

The public project page's Web3Forms contact form is separate from application hosting and remains outside this migration.

## Later proposals

Queues-based processing, audio/video, Signal integration and remote-support orchestration remain proposals until scoped and implemented. Discuss requirements and feasibility before committing delivery dates.

## Tracked work

- [v0.1.0: verify CI and align repository protection](https://github.com/nathcymru/Tocyn/issues/12)
- [v0.1.0: review the whole codebase for security vulnerabilities](https://github.com/nathcymru/Tocyn/issues/13)
- [v0.1.0: agree and implement coding standards](https://github.com/nathcymru/Tocyn/issues/14)
- [v0.1.0: audit general codebase health and test coverage](https://github.com/nathcymru/Tocyn/issues/15)
- [v0.1.0: inventory and implement majority FidesLang coverage](https://github.com/nathcymru/Tocyn/issues/16)
- [v0.2.0: complete FidesLang coverage and optional end-user capabilities](https://github.com/nathcymru/Tocyn/issues/17)
- [v0.3.0: replace Resend with Cloudflare-native email](https://github.com/nathcymru/Tocyn/issues/18)
- [v0.1.0: define tenant isolation and cross-tenant regression tests](https://github.com/nathcymru/Tocyn/issues/19)
- [v0.1.0: verify contributor setup from a clean checkout](https://github.com/nathcymru/Tocyn/issues/20)
- [v0.1.0: review dashboard and portal accessibility](https://github.com/nathcymru/Tocyn/issues/21)
- [v0.1.0: complete repository settings and community launch](https://github.com/nathcymru/Tocyn/issues/22)
