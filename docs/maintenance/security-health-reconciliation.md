# Security and codebase-health reconciliation

Baseline: `d1c56ba768eade1be93e034a34e68101b57dd53c` (Phase 1 PR #43).
This is a continuation of issues #13 and #15, not production clearance.
The private 7 September review remains the source of the original R1–R18 identifiers.

## Application changes

- Customer OTP verification uses an opaque challenge, persistent attempt budget,
  replacement-challenge invalidation and atomic single-use consumption. Portal clients
  carry that challenge through the existing widget-key routing contract.
- Staff MFA requires an explicit verified claim. Existing live user/role checks and
  separate app, widget and MFA audiences remain in place.
- Inbound replies require the routed ticket's participant identity before writes.
  Provider failures no longer include response bodies in errors.
- Public knowledge results are authorized against current tenant database records and
  read current content rather than trusting cached vector text.
- Widget/customer request streams and fields are bounded. Widget operations have
  database-backed subject and tenant budgets. Credentialed origins are configured;
  cookie mutations require a trusted origin. Embedded widgets use bearer tokens.
- Automation patterns use RE2JS; webhook destinations require an explicit trusted
  origin allowlist and redirects are refused. Retention validates configuration and
  conditions, deletes external objects first and retains ownership records on failure
  so later scheduled attempts can retry. Missing vector chunk counts retain records for
  migration reconciliation instead of guessing which vector IDs to delete.
- Attachment lists are fully validated, including stored metadata, before article writes.
  A failed metadata write does not delete an upload that predates that operation.
- Local reset passwords are random and SQL/shell literals are escaped. The historical
  seed requires `--legacy-schema`, never replaces rows, and only generates SQL.

## Configuration and migration contract

Plan migrations `0020_customer_otp_attempts.sql` and `0021_tenant_request_limits.sql`
with the existing `0014`–`0019` inventory in #42. Migration 0020 invalidates old unbound
OTP challenges; magic links remain subject to their existing expiry and ownership.
No production migration was performed.

Set deployment `CORS_ORIGINS` to a comma-separated list of approved dashboard/portal
origins; `PORTAL_URL` is also recognized. HTTPS is required outside local development.
Tenant portal configuration alone does not grant a deployment CORS origin. Public widget
routes allow cross-origin bearer access without cookies. Browser cookie mutations from
an unconfigured origin are denied before dispatch.

Webhook delivery is disabled unless trusted composition supplies the explicit HTTPS
origin allowlist to `TenantAutomationService`. Rule JSON does not establish that allowlist.
No production webhook or scheduled job was enabled by this work.

## Dependency and test health

The root lockfile is authoritative. The stale nested server lock, tracked build-info files
and `.orig` handler backup were removed. Do not restore generated build-info to Git.
Root `npm test` now includes server, portal, widget, agent-context and local-reset/seed tests.
CI also runs the isolated D1 smoke and integration gates.

Security-related compatible updates were consolidated without `npm audit fix --force`.
Hono is 4.13.7 and both browser applications use React Router 7.18.3. Router 7's obsolete
`BrowserRouter.future` flags were removed. The D1 harness declares its Miniflare dependency
and uses the installed version's v4 compatibility converter. Miniflare is currently
`5.20260907.0-alpha`, matching Wrangler's tested dependency; this prerelease needs ongoing
maintenance and is development-only.

Fresh all-dependency and production-only audits returned zero reported vulnerabilities
on 7 September 2026. This is registry advisory evidence, not proof of application safety.

### Closed dependency proposals

The 19 old PRs were closed without merge before this work. They are not individually
reported as merged. Security-relevant overlapping lockfile changes replace those proposals.
The Router 7 build failure (#28) and Miniflare harness incompatibility (#27) were reproduced
from their CI logs and corrected. The Vitest 5 proposal (#31) failed portal matcher typing;
Vitest 4 remains until a separately tested migration is ready. Optional Lucide 1.x, editor
updates and Actions major updates are not prerequisites for the zero-advisory result.
Checked-in Actions remain pinned. Repository-wide SHA enforcement remains deferred.

## Remaining bounded work

- #13: reconcile session lifecycle/realtime expiry and revocation, edge mail-authentication
  assurance, and deployment-specific logging/access policy against the private register.
  HTTP deletion/demotion rejection is not a claim that open sockets or copied bearer
  sessions have a complete revocation lifecycle.
- #12: dependency-only heads previously lacked the two required default CodeQL Analyze
  contexts. A passing code-containing PR does not by itself resolve that settings gap.
- #42: provisioning for the tenant schema, backup/restore rehearsals, isolated Cloudflare
  runtime verification and all production migration/cutover work remain open.
- #44: remove inactive `KnowledgeService`, `TicketService`,
  `AutomationService` and `VectorService` only after replacing their historical test/script
  consumers. Acceptance: active entrypoint graph is unchanged, no lost regression coverage,
  exact ESLint exceptions shrink, and full CI passes. Do not confuse inactive legacy SQL
  with permission for new services to bypass repositories.
- #45: evaluate Vitest 5, Lucide/editor and Actions majors separately.
  Acceptance: matcher types, all client builds/tests and required CI contexts pass; new
  Actions SHAs are reviewed and pinned. No mass upgrade just to clear the PR list.

Keep the broader v0.1.0 milestone open. Unpatched reproduction details remain private.
