# Tenant-isolation acceptance evidence

This page records the local source-level acceptance evidence for issue #19. It supplements the historical [tenant-isolation review](tenant-isolation-review.md); it does not replace production migration, Cloudflare runtime, provider, or recovery approval owned by #42.

## Reproducible local fixture

The disposable `withTwoTenantFixture` helper in `apps/server/scripts/local-tenant-fixture.ts` migrates a fresh local D1 database and supplies two synthetic tenant scopes. Its A/B customer and operator records deliberately share local identifiers while preserving distinct tenant IDs, canonical customer addresses, widget routing keys, operator MFA secrets, and API keys. The fixture uses in-memory Miniflare D1/R2 only, injects the local capture transport, never reveals generated credentials in automated output, and disposes its bindings after each callback.

Run the core route evidence with:

```sh
npm run test:tenant-isolation-core --workspace=apps/server
npm run test:tenant-isolation-storage-background --workspace=apps/server
npm run test:local-tenant-realtime --workspace=apps/server
npm run test:local-tenants:focused --workspace=apps/server
npm run test:local-tenants --workspace=apps/server
npm run typecheck:tenant-isolation-core --workspace=apps/server
npm run typecheck:tenant-isolation-storage-background --workspace=apps/server
```

The tests report statuses and local counters only. The interactive fixture command is intentionally separate because it displays synthetic credentials only on a human terminal.

## Current acceptance matrix

| Surface | Local evidence | Current result and boundary |
| --- | --- | --- |
| Identity, MFA, sessions and canonical email | A/B password and customer magic-link/widget flows; route-issued app, widget, and MFA-challenge tokens; unsigned payload tampering; named session revocation; canonical-email constraint | Implemented and tested locally. Audience, signature, live session/role, and tenant/user resolution are checked before composition. A canonical email belongs to one tenant; same-email multi-tenant membership is explicitly unsupported. |
| D1 tickets, articles and tenant configuration | Colliding ticket IDs; A/B API reads; scoped create/update attempts; widget configuration from each tenant key; portal ticket/detail visibility and internal-note filtering | Implemented and tested locally. The trusted authenticated/key-derived scope controls queries; body/query tenant selectors do not change it. Denied reads and writes assert no D1 mutation. |
| API keys | Fixed tenant-scoped read/write test keys plus dashboard-owned revocation | Implemented and tested locally. Keys resolve a tenant integration scope; missing, malformed, read-only, foreign, and revoked keys deny without a write. |
| Customer portal | Real customer magic-link verification, route-issued widget JWTs, A/B list/detail and foreign ticket/message attempts | Implemented and tested locally. Customer identity and tenant scope are re-resolved before routes run; foreign identifiers and internal notes do not become portal data. |
| R2 attachments | The companion `tenant-isolation-storage-background.test.ts` uses the fixture’s same local R2 binding and operation counters | Implemented and tested locally. Colliding attachment IDs return each tenant’s own bytes; foreign/internal IDs deny before R2 I/O. A failed A retention run preserves B rows and objects, then retry deletes only A. |
| Durable Object/realtime | The companion suite exercises simultaneous A/B notification objects against fixture D1, and `local-tenant-realtime-smoke.mjs` starts the bound local Worker with two actual local WebSocket clients | Implemented and tested in the owner-local Worker runtime. It uses route-issued MFA tokens, observes A/B event isolation, revokes A, then proves A closes while B continues. This does not claim a remote or production WebSocket runtime test. |
| AI/vector and workflows | The companion suite covers local fake provider boundaries and stale/foreign/deleted records | Implemented as a local source contract. Withdrawn/deleted/foreign retries produce no AI, vector, or R2 write; B remains intact. Owner-local beta leaves optional remote AI/index/workflow bindings disabled. |
| Retention, deletion and retry | The companion suite covers scoped retention failure/retry and B preservation | Implemented and tested locally. Failure keeps A’s cleanup exclusion claim; retry is scoped and idempotent. Remote backup/restore and production recovery remain #42 release work. |
| Outbound/inbound email | Local capture uses the exact synthetic local allowlist; customer authentication messages are captured only in local runtime | Outbound local test capture is implemented for the local fixture. Inbound support-email processing is disabled and unsupported in the owner-local beta. |
| Cache and exports | No application cache or export endpoint is present in the current scope | Explicitly unsupported; no simulated control is offered as acceptance evidence. |

## Limits and resource evidence

Each fixture run starts with a new migrated local state and reports redacted D1 row, R2 object, and route-request counters. Its focused checks also prove cleanup after callback failure, restoration of temporary global request compatibility state, local R2 operation counters, and session revocation. The interactive runner rejects a piped/non-TTY standard input before it creates temporary state or reveals a synthetic password or TOTP URI. These are local test measurements only; they do not establish Cloudflare account consumption, deployed cache behavior, inbound mail, production migration, backup restoration, or gateway readiness.

The tests intentionally use route-issued credentials and synthetic records. No token-signing secret, plain credential, raw API key, or customer data is included in a test name, report, snapshot, or this document.
