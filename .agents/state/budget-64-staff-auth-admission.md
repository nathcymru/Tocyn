# #64 staff authentication admission candidate

Branch `codex/64-staff-auth-admission`, based on accepted main `70b75ab`. This is partial #64 delivery; production activation and beta.2 remain incomplete.

## Delivered scope

Combined-policy admission now covers the verified-tenant business effects for staff MFA verify, setup, confirm, logout and current-user reads. Each operation uses the existing session admission service, rechecks tenant, actor, role, session version, token expiry, MFA stage and owner policy, and persists its exact grant operation/envelope in the same D1 batch as the protected read or write. Setup and confirm continuation batches recheck and persist the same exact link alongside their MFA mutation. The commit object is one-use within an attempt.

MFA setup writes a secret only when none exists. An uncertain acknowledgement keeps that encrypted secret, and a retry returns the same provisioning URI without requiring another positive D1 stored-byte allocation. Confirmation signs the app token before its one-way MFA/session mutation so a signing failure cannot enable MFA without a usable credential. Logout increments the current account's session version through the exact fenced batch. Undefined, `off`, and API-only policy modes retain existing behavior; malformed combined configuration fails closed.

No migration is required. Login credential/password effects remain owned by the global owner-ingress admission work and are not duplicated here. Customer authentication, Turnstile and mail are unchanged.

## Evidence

- Native Miniflare Worker/D1/BudgetCoordinatorDO: 9/9. It covers MFA verify, setup, confirmation, `/me`, logout, two tenants, strict exhaustion before full-user access, incomplete MFA, session/role/owner-policy changes after reservation, MFA-state collision, uncertain setup acknowledgement and zero-stock setup recovery.
- Actual native D1 metadata for admitted verify: 10 rows read / 5 rows written within 4096/16; `/me`: 11/4 within 4096/16. Setup/confirm/logout are also asserted against their 4096/32 envelopes on each request.
- Focused unit compatibility: 55/55 across the new service contract, tenant repository authentication workflow and auth middleware.
- Server TypeScript and budget-runtime TypeScript pass; `git diff --check` passes. This package has no lint script.
- The localhost portal workflow was attempted but could not bind shared port 8787 (`EADDRINUSE`); the running workspace process was left untouched.

## Integration dependency and remaining evidence

Owner-ingress PR216 is revising its concurrent pre-admission and warm-block retirement contract. This branch exposes durable `budget_grant_operations` rows for all five staff operations so that work can register/reconcile tenant proof without a staff-specific migration. Root must refresh the final ingress interface and verify that its tenant handoff consumes these exact links.

MFA confirmation invalidates the challenge when migration0022 advances the session. If the HTTP response is lost after the D1 commit, that challenge cannot retrieve the already-signed token. The implementation avoids permanent token/secret receipts; cross-attempt response recovery remains explicit #64 authentication acceptance work unless the approved ingress contract supplies a bounded secure mechanism.

No remote resources, provider billing, deployment or Copilot review were used. This branch does not claim full #64 or production readiness.
