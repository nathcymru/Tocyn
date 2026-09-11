# #64 staff authentication admission candidate

Branch `codex/64-staff-auth-admission`, based on accepted main `70b75ab`. This is partial #64 delivery; production activation and beta.2 remain incomplete.

## Delivered scope

Combined-policy admission now covers the verified-tenant business effects for staff MFA verify, setup, confirm, logout and current-user reads. Each operation uses the existing session admission service, rechecks tenant, actor, role, session version, token expiry, MFA stage and owner policy, and persists its exact grant operation/envelope in the same D1 batch as the protected read or write. Setup and confirm continuation batches recheck and persist the same exact link alongside their MFA mutation. The commit object is one-use within an attempt.

MFA setup writes a secret only when none exists. An uncertain acknowledgement keeps that encrypted secret, and a retry returns the same provisioning URI without requiring another positive D1 stored-byte allocation. Confirmation signs the app token before its one-way MFA/session mutation so a signing failure cannot enable MFA without a usable credential. Logout increments the current account's session version through the exact fenced batch. Undefined, `off`, and API-only policy modes retain existing behavior; malformed combined configuration fails closed.

No migration is required. Login credential/password effects remain owned by the global owner-ingress admission work and are not duplicated here. Customer authentication, Turnstile and mail are unchanged.

## Evidence

- Native Miniflare Worker/D1/BudgetCoordinatorDO: 10/10. It covers MFA verify, setup, confirmation, `/me`, logout, two tenants, strict exhaustion before full-user access, incomplete MFA, session/role/owner-policy changes after reservation, MFA-state collision, uncertain setup acknowledgement, zero-stock setup recovery, and a discarded successful-confirmation response followed by fresh password login and MFA verification.
- Actual native D1 metadata for admitted verify: 10 rows read / 5 rows written within 4096/16; `/me`: 11/4 within 4096/16. Setup/confirm/logout are also asserted against their 4096/32 envelopes on each request.
- Focused unit compatibility: 55/55 across the new service contract, tenant repository authentication workflow and auth middleware.
- Server TypeScript and budget-runtime TypeScript pass; `git diff --check` passes. This package has no lint script.
- The localhost portal workflow was attempted but could not bind shared port 8787 (`EADDRINUSE`); the running workspace process was left untouched.

## Integration dependency and remaining evidence

Owner-ingress PR216 is revising its concurrent pre-admission and warm-block retirement contract. This branch exposes durable `budget_grant_operations` rows for all five verified-tenant staff operations so that work can register/reconcile tenant proof without a staff-specific migration. Root must refresh the final ingress interface and verify that its tenant handoff consumes these exact links.

Staff `/login` is preidentity work: request body parsing, email lookup, password verification and challenge-token signing occur before a verified tenant exists. Accepted main `70b75ab` has no budget admission for those effects. PR216's owner-ingress middleware is confirmed to run before route/auth composition and cover `/login` under its separate strict switch; the final integration must prove denial before the login handler and retains `workerCpuMs` as an explicit #64 provider/runtime-estimation gap.

MFA confirmation invalidates the old challenge when migration0022 advances the session. A lost successful response does not strand the operator: native route evidence proves a fresh password login reads session version2, returns a new version2 MFA challenge, and successful MFA verification returns a current app token. No token replay or permanent token/secret receipt is needed.

No remote resources, provider billing, deployment or Copilot review were used. This branch does not claim full #64 or production readiness.
