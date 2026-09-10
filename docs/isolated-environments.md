# Isolated preview and beta release preparation

This is **source preparation** for [#57](https://github.com/nathcymru/Tocyn/issues/57). It is not evidence of a deployed preview or beta, protected GitHub environment, Cloudflare resource, Access policy, Resend delivery, migration, or rollback rehearsal. The accepted beta used **local Wrangler simulations and local mail capture only**; see [local authentication capture](local-auth-capture.md). It was accepted at `049ea82a02571681f834bcd87d43253603edf71f` on 9 September 2026 and published as `v0.4.0-beta.1` on 10 September 2026. Remote actions remain prohibited for this source-preparation phase. A future `beta.2` is gated separately by the approved operator workspace and production-readiness decisions; no external beta mail delivery is a prerequisite for that gate. The owner choices below are historical future prerequisites, not instructions to perform them now.

## Prepared source controls

`deployment/preview.json` and `deployment/beta.json` define different logical identities:

| Stack | API Worker | D1 | R2 | Durable Object | Portal Pages | Dashboard Pages |
| --- | --- | --- | --- | --- | --- | --- |
| Preview | `tocyn-api-preview` | `tocyn-preview-db` | `tocyn-preview-attachments` | `tocyn-api-preview/NotificationDO` | `tocyn-portal-preview` | `tocyn-dashboard-preview` |
| Beta | `tocyn-api-beta` | `tocyn-beta-db` | `tocyn-beta-attachments` | `tocyn-api-beta/NotificationDO` | `tocyn-portal-beta` | `tocyn-dashboard-beta` |

The manifests contain no resource IDs, origins, credentials, recipient addresses, or provider tokens. Generated release configuration requires the protected environment to supply exact D1 ID and HTTPS origins and rejects blank, cross-stack, inherited `luminatick-*`, and production-like values.

The isolated entry point requires exactly `ENVIRONMENT=preview` or `beta`, valid portal/dashboard HTTPS origins, exactly those two CORS origins, inbound email disabled, and rate limiting enabled. Parked configuration has no workers.dev or preview URL, route, Pages publication, CRON, inbound routing, AI, Vectorize, Workflow, queue, webhook, or email-routing binding. These are source contracts; the final deployment test must verify the provider’s actual settings.

The manual **Isolated preview and beta release** workflow runs only from `main`, validates a full reachable main SHA and clean checkout, runs affected checks, and packages release-relative Worker, migrations, portal, and dashboard inputs. It records SHA plus binding-manifest, configuration, bundle, frontend, and provider-receipt digests. It has no pull-request deployment job and never performs remote migration, seed, provider setup, or mail send.

## Owner choices before an external run

Choose **one** stack and record its exact values outside source control.

1. Approve the separate resource identities above, account, D1 ID, API/portal/dashboard HTTPS origins, and the intended parked or restricted-ingress operation.
2. Configure the matching protected GitHub environment (`tocyn-preview` or `tocyn-beta`) with deployment approval policy and separate least-privilege deploy, provider-resource-read, and Access-read credentials. No broad local OAuth credential, production credential, or unrelated resource may be reused.
3. Configure three exact Access applications and a synthetic service-token identity for the API, portal, and dashboard origins. Before publishing application content, protect the exact Pages default domain, the wildcard preview/deployment domain, and each custom domain. Preview protection alone does not cover the default or custom domain. For new projects, configure the empty project’s custom domain before enabling its Access policy, then verify protection before publishing content; see [Cloudflare Pages Access setup and custom-domain limitations](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain). Verify actual serving aliases in the final ingress test.
4. Configure the required Worker secrets without exposing values: `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `APP_MASTER_KEY`, and `OUTBOUND_EMAIL_RECIPIENT_ALLOWLIST`. The workflow may verify secret **names**, never values.
5. Approve a minimal synthetic isolated schema/principal setup, its retention/cleanup rule, and its recovery procedure. #57 does not run remote migrations, reverse schema migrations, or D1 restore. #58 later owns reusable interactive fixture tooling and #19 the broader isolation matrix; neither is a #57 predecessor.
6. For authentication-email testing, approve a dedicated Resend test key, verified test sender, exact allowlisted synthetic recipient, isolated tenant configuration, widget key, one magic-link or OTP send, and verification. Do not use a production credential/sender or enable inbound mail.

## Required final demonstration contract

### Park and restricted ingress

A protected manual `park` run for an immutable main SHA must produce a redacted artifact, binding/configuration digests, provider-resource receipt, Worker-secret-name receipt, duration, and artifact size. Verify that the parked Worker has no public Worker/Pages route, route alias, scheduled trigger, or inbound routing.

A separately approved `rehearse` run must prove, for the exact API, portal, dashboard, Pages default domain, and all applicable Pages preview/deployment aliases:

- anonymous access is denied;
- the approved synthetic Access identity succeeds only at the intended protected origins;
- the recorded provider resources and Access domains match the artifact.

The workflow does not create or change Access policy. A successful dry run or CI run is not deployment evidence.

### Synthetic tenants and authentication email

Use the owner-approved minimal #57 synthetic setup or another explicitly approved isolated test process. Do not wait for #58. Demonstrate two tenant identities and API keys: each succeeds only in its own tenant; altered tenant token, cross-tenant ID/key, revoked or malformed key, and unauthorised operator action fail with no other-tenant write. Preserve redacted request/result evidence.

Exercise the actual customer authentication-email path, not a generic mail call: invoke `/api/v1/customer/auth/request` with an approved widget key and allowlisted synthetic recipient, receive the magic-link or OTP through the dedicated Resend credential, and complete `/api/v1/customer/auth/verify`. Confirm a non-allowlisted recipient is rejected before provider delivery. Keep tokens, magic links, OTPs, API keys, secret values, and recipient addresses out of artifacts and receipts.

### Counters, rollback, and recovery

Record before/after counters for Worker invocations/CPU, D1 rows/storage/reads/writes, R2 objects/bytes/operations, Durable Object activity, Pages deployments, Resend sends, workflow duration, and artifact size. The owner sets the allowed budget and stop threshold before the run.

Rollback must use the recorded same-environment known-good artifact, re-verify its SHA, target, binding/configuration digests, files, and provider receipt, then redeploy it and repeat the protected-ingress check. Record known-good revision, release digest, artifact run ID, and receipt. Current rollback preparation restores Worker/Pages code only. If isolated synthetic data needs recovery, follow the approved #57 synthetic-state procedure; production migration/backup/restore readiness is a separate later concern.

## Current evidence and limits

The worktree contains reviewable manifests, guards, trusted-workflow preparation, artifact/receipt checks, protected-ingress verification preparation, mail allowlist enforcement, and code rollback preparation. It does not yet evidence any external configuration or operation listed above. Record only checks actually run in the eventual #57 delivery receipt, keep #57 open until the selected isolated deployment, authentication email, counters, and rollback evidence are available, and do not treat this preparation as production cutover authority.


## Local source verification — 8 September 2026

Source checkpoint `523add383d89861b89f5e550f7df439170454bd2` passed:

- server 329, portal 12 and widget 3 tests; server typecheck/lint and portal lint;
- local D1 smoke/integration checks and dashboard, portal and widget builds;
- 19 deployment tests covering configuration, artifact tampering, path/symlink escape,
  clean source, provider mismatch, Pages ingress and rollback contracts.

Two clean checkout locations at that checkpoint used Node 22.19.0/npm 10.9.3, the
locked dependencies, identical synthetic preview origins/D1 identity and
`VITE_API_URL`, fresh dashboard/portal builds and actual Wrangler dry-run bundles.
Both packaged artifacts passed verification and the portable `--no-bundle` dry run.
All 36 files were byte-identical, totalling 2,217,507 bytes. Release digest:
`50b28abe64fcde5f17018608288103d80643e28cfa78d8127a28deb188582000`.
The packaging gate checked the Worker build metadata for browser UI/React and agent
tooling imports before removing build-only metadata.

No provider receipt was finalized and no resource was provisioned or contacted by a
deployment operation. These synthetic parked artifacts are local reproducibility
evidence, not approved deployment targets. Existing dashboard chunk-size/config
loader warnings and Wrangler's ignored minify flag with `--no-bundle` were nonfatal.
CI on the published PR and every external demonstration above remain separate gates.

The consolidated automatic-review correction fixes the trusted-revision Git existence
check and validates the Worker-secret-verifier config filename. The deployment suite
now has 21 passing tests, including real Git main/off-main/missing-revision CLI cases.
It does not change the application or artifact packaging bytes tested above.
