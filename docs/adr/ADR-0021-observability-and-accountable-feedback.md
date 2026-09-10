# ADR-0021 — Operational observability and service-level objectives

- **Status:** Accepted direction; implementation pending
- **Date:** 10 September 2026
- **Decision owner:** Tocyn maintainer approval,10September2026
- **Issue:** `[NEW-#159]`


## Context

Tocyn already records durable, tenant-scoped canonical conversation/audit evidence and has strong correctness/security tests. The current Worker configuration, however, has persisted Worker observability disabled. Production readiness #42 deliberately requires log redaction/access/retention safeguards before enabling persisted logs.

Tocyn also has several separate performance requirements, for example measured ingress performance in #51 and browser bundle/startup budgets in #48/#67. Without a shared operational-observability contract, future Queue consumers, dispatch, Durable Objects, Workflows and AI assistance could each emit incompatible data or accidentally log customer content.

Runtime telemetry must not be confused with:

- canonical business/security audit events, which are durable application evidence;
- customer-provided diagnostic context (#92);
- tenant-facing service/quality analytics (#85).

## Decision

Tocyn will establish a privacy-safe, Cloudflare-native operational observability layer with versioned structured events, end-to-end correlation, explicit redaction, environment-specific logging/tracing and measured service-level indicators.

### 1. Platform

Workers Logs and Workers Tracing are the initial runtime observability mechanisms.

A third-party observability service is optional and must not be required for standalone Tocyn. OpenTelemetry export may be configured by a deployer later.

### 2. Environment policy

- local-only development does not require persisted remote telemetry;
- isolated remote/staging may enable logs/traces using synthetic data to establish evidence;
- production logs/traces are enabled only after #42 verifies redaction, access, retention, sampling and cost controls;
- sampling is environment/configuration driven rather than hard-coded.

The current `observability.enabled = false` state must not be replaced by an unconditional production-on switch.

### 3. Data minimisation

Operational telemetry uses an allowlist schema.

It must not contain authentication secrets, cookies, magic links, OTPs, API keys, channel credentials, raw provider payloads, support message bodies, attachment contents, arbitrary AI prompts/outputs or unrelated tenant content.

Where per-tenant grouping is operationally necessary, prefer a pseudonymous stable tenant reference rather than customer identity/display data.

### 4. Correlation

A non-authoritative `correlationId` is propagated across:

`request/ingress -> durable journal -> Queue -> canonical processing -> outbox -> outbound Queue -> dispatch`.

Correlation metadata never grants tenant/resource authority.

### 5. Audit separation

Canonical D1 audit/event evidence remains deterministic and non-sampled.

Diagnostic logs/traces may be sampled according to policy/cost. Sampling diagnostic telemetry must never remove security or business evidence that Tocyn requires for correctness, approvals, takeover or recovery.

### 6. SLIs and SLOs

Tocyn defines service-level indicators before assigning universal numeric targets.

Initial SLI families include:

- eligible canonical API success/latency;
- authentication/portal/operator success/latency;
- D1/R2/DO binding failure/latency;
- durable ingress acceptance;
- Queue publication/processing/backlog;
- oldest pending journal/outbox age;
- DLQ/quarantine counts;
- outbound delivery attempt/uncertainty;
- vectorisation workflow completion;
- optional AI latency/fallback;
- budget admission/replenishment.

Security and tenant-isolation requirements remain release-blocking invariants rather than error-budget SLOs.

Existing issue-specific targets remain authoritative. In particular, #51's measured 50 ms warm ingress target is retained. New global latency numbers must be based on recorded Tocyn evidence rather than copied from a reference architecture.

### 7. Cost

Workers log/trace events are a resource dimension governed by #50/#64. Diagnostic sampling/retention may be adjusted for cost, but required audit/security evidence may not be discarded.

## Consequences

- production incidents have correlation and binding-level evidence;
- Queue/outbox recovery can be measured rather than inferred;
- logs do not become an accidental second copy of support conversations;
- operators can distinguish service health from tenant-facing analytics;
- observability itself is budgeted;
- SLOs become evidence-driven and versioned;
- a production deployment cannot be approved merely because local tests are green.

## Rejected alternatives

### Use D1 audit events as the only observability system

Rejected. Canonical audit is necessary but should not become a high-volume tracing store or substitute for runtime binding/handler latency.

### Mandate Workers Analytics Engine immediately

Rejected as a mandatory dependency. It can be evaluated later if aggregated high-cardinality metrics need it. Native logs/traces are sufficient to establish the first operational contract.

### Copy the reference architecture's latency thresholds

Rejected. Thresholds without Tocyn measurements are false precision.

### Log full request/provider/AI content for debugging

Rejected. This creates unnecessary privacy/security exposure and undermines Tocyn's least-data principles.

## Related

- #42 — production readiness
- #50/#64 — cost and resource budgets
- #51/#91/#87/#88 — ingress, recovery, consumer and dispatch
- #18 — transactional mail
- #48/#67 — browser/widget performance evidence
- #63 — canonical conversation audit
- #85 — tenant/product operational analytics (separate)
- #92 — customer-supplied telemetry context (separate)
- ADR-0014 — living delivery state

## Source and current authority

Source archive: `tocyn-gap-analysis-2-change-package-2026-09-10.zip`; original path: `tocyn-gap-analysis-2-change-package-2026-09-10/adr-drafts/ADR-0016-operational-observability-and-service-level-objectives.md`. Source numbering is preserved in the archive; this accepted record uses the master numbering.

Delivery owners: [#159](https://github.com/nathcymru/Tocyn/issues/159).

The [approved master decisions](../planning/post-beta-2026-09-10/decisions.md) supersede any conflicting source sequencing or release assumption: beta.1 was accepted 9 September and published 10 September 2026 at `049ea82a02571681f834bcd87d43253603edf71f`; beta.2 requires full SLA clocks/calendars/pause/resume/waiting treatment and responsible-handler ownership/routing. Independent workspace and hardening foundations proceed in parallel. Existing historical baselines are preserved; milestone taxonomy may evolve to represent dependencies. This ADR grants no remote provisioning, provider activation or customer-traffic authority.
