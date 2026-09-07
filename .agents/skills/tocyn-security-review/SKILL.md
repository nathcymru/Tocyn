---
name: tocyn-security-review
description: Review or modify Tocyn authentication, authorization, email, uploads, API keys, AI retrieval, dependencies and deployment defaults using private findings and synthetic regression evidence.
---

Read `SECURITY.md` and `docs/security/review-2026-09-07.md`. Locate the affected flow with
the context skill. Trace entrypoint -> middleware -> service -> D1/R2/DO/Vectorize/email.

Check trusted identity, live role/membership, MFA state, token expiry/reuse/revocation,
object ownership and internal/public visibility on every read and write path.
For email, separate routing/thread identification from authenticated sender authorization.
For AI, authorize retrieval before prompting; instructions to a model are not access control.
Check request bounds, retry behavior, logs, failure handling and external service calls.

Run real service/handler tests with two synthetic principals and an isolated database where
possible. Include own-object success, wrong-object read/write denial, missing credentials,
revoked membership and internal-content denial. Do not replace authorization with mocks
in tests purporting to prove it. Cloudflare runtime behavior requires separate staging tests.

Run `npm audit --json` and `npm audit --omit=dev --json`; distinguish affected packages,
advisory matches and demonstrated application reachability. Check existing Dependabot PRs
before duplicating updates. Never automatically use `npm audit fix --force`.

Record commit, scope, reproduction, impact, severity rationale, confidence, remediation and
regression gate. Keep unpatched exploit details private under `SECURITY.md`; public reports
contain sanitized status and release gates. Passing CI does not mean a clean security review.
Do not run remote migrations, seeding, deployment, email delivery or paid AI during review.
