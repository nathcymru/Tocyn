# Operational observability contract

Issue #159 adds a versioned, allowlisted runtime event envelope for active HTTP paths. It records a correlation ID, normalized route, method, outcome, status and latency only. The serialization boundary normalizes unknown routes/methods, validates UUID correlation IDs and finite nonnegative latency, derives outcome from a valid HTTP status, and drops every extra property. It does not accept arbitrary attributes and must never include authentication headers, cookies, OTP or magic-link material, API keys, channel credentials, provider payloads, ticket/article/attachment content, or AI prompts/outputs.

Canonical D1 audit remains the non-sampled evidence owned by #63. This diagnostic envelope is separate, can be sampled only under a later approved retention policy, and does not provide tenant analytics (#85) or customer diagnostic context (#92).

Local persistence is off. Emission requires `LOCAL_BETA_ENABLED=true`, `OBSERVABILITY_MODE=isolated-evidence`, and a non-production environment. Production is disabled pending #42 verification of access, retention, sampling and redaction. Telemetry failure is swallowed after the request outcome is set; it cannot bypass authentication, tenant isolation, durability, approval or recovery.

Initial SLI evidence is recorded as machine-readable JSON with revision, tool versions, environment, route class, request count, latency percentiles and failure counts. Do not ratify global thresholds from synthetic data. Preserve #51's separate measured 50 ms warm-ingress target. Future hooks: D1/R2/DO operation envelopes, Workflow/AI fallback, and #87/#88 journal, Queue, outbox and dispatch states.

Alert runbooks must cover DLQ/quarantine, oldest pending journal/outbox age, dispatch uncertainty, sustained active-path errors and budget-admission failures. Include diagnostic event volume and retention in #50/#64 accounting before enabling any non-local evidence channel.
