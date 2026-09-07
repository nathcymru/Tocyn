# Tenant-isolation review and release gates

Reviewed `cd6ba5ec463fd1aa0bf4844171e9f0d6fb8ff8d8` on 7 September 2026.
**Result: multi-tenant deployment blocked.** The inherited application is single-tenant.
Completing this review does not complete the multi-tenant implementation in issue #19.

## Boundary assessment

| Surface | Observed model | Required boundary before shared tenancy |
| --- | --- | --- |
| Identity | Global users, unique email, role in JWT | Tenant records, live memberships, tenant/customer/staff roles; explicit platform-admin authority |
| D1 | Global tickets, groups, config, keys, knowledge and automation | Authorized tenant context in every read/write; tenant-safe unique keys and foreign keys |
| Customer portal | Ownership by customer email | Tenant membership plus stable customer identity; same email across tenants must not merge ownership |
| Staff dashboard | Application-wide staff visibility; groups used for some operations | Consistent tenant and group policy on list/detail/write/search/attachments |
| R2 | Ticket/article/user/document keys | Tenant-derived keys plus DB ownership checks before get/put/delete; reject forged and reused references |
| Realtime | Shared notification Durable Object | Tenant-specific objects and subscriptions; recipient authorization, expiry/revocation and event filtering |
| API keys | Application-wide key validation | Key identity, tenant, allowed operations, revocation and auditable usage |
| Email | Global mailboxes and ticket threading | Trusted recipient-to-tenant mapping, authorized senders and tenant-scoped thread matching |
| Knowledge/AI | Global index, public/internal tiers | Tenant-scoped retrieval plus current visibility authorization; prevent stale/deleted content retrieval |
| Workflows | Document/article IDs in jobs | Validated tenant context, authorization on execution, idempotency and deletion/tombstone behavior |
| Automation | Global webhook/retention rules | Tenant-scoped rules and payloads; bounded egress, retention and failure-safe cleanup |
| Cache/logs/export | No tenant contract | Namespaced caches, redacted/auditable logs, tenant-only exports and tested deletion across all stores |

Primary source locations: `apps/server/migrations`, `src/middleware`, `src/handlers`,
`src/services`, `src/durable_objects` and `src/workflows` under `apps/server`.
The assessment follows actual storage and entrypoints, not just absence of a tenant_id string.

Two synthetic customers confirmed the existing portal's wrong-customer ticket read/write
checks. A staff principal without a group association could read the other customer's ticket,
consistent with the application's global staff model. Neither result is a two-tenant test:
there is no tenant/membership model to instantiate. Group filtering is not an isolation boundary.

## Implementation and verification gates

1. Define tenant provisioning, trusted tenant selection and membership lifecycle. Decide
   shared D1 versus per-tenant resources explicitly; migrate existing single-tenant data to
   an identified tenant. Client-provided IDs must always be authorized server-side.
2. Implement the boundaries in the matrix, including background work and deletion. Reject
   missing tenant context rather than defaulting to a global namespace. Establish current
   user/membership authorization, not solely historic token claims.
3. Build integration fixtures for tenants A/B, including colliding local IDs and the same
   email in both. Cover customer, agent, tenant administrator and platform administrator.
4. Exercise missing/wrong/revoked membership and forged tenant/resource IDs across
   list/detail/create/update/delete, upload/download, internal notes, websocket events,
   API keys, inbound/outbound email, search/AI, jobs, webhooks, exports and deletion.
   Assert both response denial and absence of writes/events/email/AI side effects.
5. Verify database constraints, retries, stale vectors/cache, deleted tenant jobs and
   membership revocation during an open websocket. Test authorization at execution time.
6. Run the same boundary scenarios in isolated Cloudflare staging with dedicated resources
   and synthetic data. Review migrations, rollback, backup/restore and operational access.
7. Resolve the private security release blockers, retain regression evidence and obtain a
   fresh review before advertising shared multi-tenant readiness.

FidesLang classification can document data use but must not be used as an authorization
mechanism. End users may disable optional privacy tooling; tenant/security controls remain
mandatory. Existing v0.1.0 and v0.2.0 FidesLang objectives remain unchanged.
