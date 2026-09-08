# Security review acceptance — 8 September 2026

This closes the source-review remediation work in #13, subject to the PR's final
checks and merge. The original private R1–R18 register and continuation have been
recovered and registered as a **draft GitHub security advisory**, visible to the
owner under SECURITY.md. No advisory was published or CVE requested.

The review baseline was `cd6ba5ec463fd1aa0bf4844171e9f0d6fb8ff8d8`.
Phase 1 merged in #43 (`d1c56ba`); the dependency/security batch merged in #46
(`565e6ed`). The final PR carries the session-lifecycle and retention concurrency
changes and their regression evidence. The private advisory retains the original
findings, severity, methods, historical reproductions and final disposition.

## Source acceptance register

| Original ID | Implemented control / regression evidence |
| --- | --- |
| R1 | Trusted portal origin; hostile request-origin override ignored by real HTTP issuance tests. |
| R2 | Conditional single-use redemption; concurrent claim tests permit exactly one session. |
| R3 | Random challenge binding, durable five-attempt budget, replacement invalidation, expiry and replay denial; portal challenge restoration regression. |
| R4 | Customer ownership and public article checks before object access; internal/foreign denial with no storage reads. |
| R5 | Customer-specific ticket projection; internal content omitted from customer lists. |
| R6 | Live identity plus session epoch, logout revocation, credential/role/membership invalidation; HTTP and realtime lifecycle regressions. |
| R7 | Tenant mailbox and participant authorization; inbound processing disabled until explicit gateway verification. |
| R8 | No credential fallback logging, delivery failures deny issuance; synthetic transport and logging regressions. |
| R9 | Customer role rechecked at redemption; explicit safe response fields. |
| R10 | Literal boolean MFA verification; HS256 and required subject/issued/expiry claims. |
| R11 | Streamed input and field limits; durable tenant/subject request and challenge budgets. |
| R12 | Current database visibility checked before knowledge/AI use; stale vector denial tests. |
| R13 | Configured credential origins and cookie mutation checks; widget bearer requests use uncredentialed CORS. |
| R14 | Active auth, AI, email and realtime logs omit credential/content error details; persisted Worker observability disabled by default. |
| R15 | RE2JS expressions, HTTPS origin allowlist, no URL credentials or redirects, timeouts; webhook egress disabled without trusted configuration. |
| R16 | Tenant-scoped cleanup, durable ownership freeze, external-write exclusion, retryable external deletion followed by atomic database cleanup. |
| R17 | Explicit reset credentials and safe pre-tenant seed behavior; production provisioning/resource selection is a separate gate. |
| R18 | Complete attachment-reference preflight before article persistence; invalid/foreign references cause no article writes. |

Regression evidence lives in the server repository, handler, service and realtime
tests, portal authentication tests and the full-chain local D1 integration harness.
The harness now preserves SQLite trigger statements. These tests use synthetic data;
external email, paid AI and deployed Cloudflare resources are not exercised.

## Session lifecycle contract

Logout invalidates **all sessions for that user**, including bearer copies and MFA
challenges. Other users and tenants remain unaffected. Legacy tokens correspond to
session version zero; their existing bounded lifetime remains valid only until the
first revocation. Every newly issued token includes the current version. Role/email/
password/MFA-enabled changes, rotation of an enabled MFA secret and membership
removal/update increment the version,
so reverting a role does not revive old sessions. Migration 0022 is required.

Realtime upgrade validates the signed token before forwarding trusted internal
session metadata. The token is removed from the internal URL. Attachments survive
hibernation but contain no bearer token and never appear in presence payloads.
Every incoming activity and outgoing delivery checks current identity, role, tenant,
version and expiry. Durable alarms close idle revoked/expired sessions at the next
alarm, scheduled for expiry or within 30 seconds. Cloudflare scheduling latency is
not a hard real-time guarantee. Database failures deny event delivery. Requests
already authorized before a concurrent revocation may finish; revocation does not
undo previously delivered data.

## Retention contract and recovery

Migration 0023 adds ticket cleanup claims. A retention claim freezes ticket/article/
attachment writes and deletes at the database boundary, including writes from other
Worker instances. Frozen ownership records are the immutable cleanup manifest.
R2/vector failures preserve the claim and those records; retries repeat idempotent
external deletion. Only after external cleanup succeeds does a D1 transaction remove
all ownership. Wrong/foreign/stale finalizers do not delete a ticket.

Knowledge-index writes hold a durable write claim while external work is pending.
Retention cannot begin concurrently. Failed or interrupted external writes retain
that claim because their remote outcome may be uncertain. Claims never expire
automatically: deleting a lock on a timer could allow an old writer to recreate
already-deleted data. A reconciler must stop the relevant workflow, confirm no writer
can resume, inspect the stored article/vector manifest, repair or remove its external
effects, and only then release the exact tenant/ticket/token claim. Resume retention
and verify all stores before marking the ticket deleted. This is an explicit #42
operator task; no production claim was inspected or removed here.

Missing legacy vector manifests fail closed and require #42 reconciliation. Retention
rules still require attachment deletion consent and reevaluate conditions under the
claim. A rule change does not release a cleanup claim: another runner may already be
using it. A newly nonmatching claim needs the same explicit reconciliation.
There is no claim of a distributed transaction across D1, R2 and Vectorize.

## Mandatory deployment gates — #42

Source remediation acceptance is not production or shared-tenancy clearance.
The following remain release blockers owned by the repository maintainer in #42:

- Rehearse migrations 0014–0023 on a backup with dedicated staging resources; verify
  canonical identities, foreign keys, restore and rollback. Provision new tenants
  using a reviewed process; inherited resource IDs and remote development bindings
  are not approved deployment targets.
- Exercise two-tenant HTTP, storage, workflow and hibernating realtime boundaries on
  Cloudflare, including logout, expiry, revoked membership, failed cleanup and a
  concurrent index writer. Reconcile legacy vectors/body namespaces and write claims.
- Verify actual gateway sender authentication and sanitization of attacker-supplied
  authentication headers, forwarded mail, absent/failed authentication and mailbox
  routing. `INBOUND_EMAIL_AUTH_VERIFIED` defaults disabled and must remain unset until
  this evidence is reviewed; only the literal deployment value `true` enables it.
  A message header cannot activate it. The existing negative header screen alone
  is not proof of authenticated sender authority.
- Configure trusted HTTPS portal/CORS origins and prove browser cookie/CSRF, widget
  bearer and OTP restoration behavior against the deployed origins. Verify shared
  budgets under distributed load, quotas, alerting and recovery capacity.
- Keep persisted Worker observability disabled until request URLs containing tokens
  are excluded/redacted. Permit only bounded event categories/status/counts; exclude
  tokens, cookies, authorization headers, message bodies, customer addresses and AI
  context. Restrict access to designated operators, audit access, set at most seven
  days of diagnostic retention, and verify deletion. Longer retention requires an
  explicit documented owner decision before enabling collection.
- Keep webhook egress denied until destination ownership and redirect/private-network
  behavior are verified. Do not activate CRON, migrate, seed, deploy or cut traffic
  without separate owner authorization and a recorded rollback decision.

Inactive legacy-service removal remains #44, optional major updates #45, and the
required-check configuration follow-up #12. These are tracked follow-ups, not claims
that untested release operations passed. The v0.1.0 milestone remains open.
