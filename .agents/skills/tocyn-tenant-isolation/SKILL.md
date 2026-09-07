---
name: tocyn-tenant-isolation
description: Design or review Tocyn tenant boundaries across identity, D1, R2, realtime, API keys, email, AI retrieval, background jobs and deletion; use for multi-tenant implementation or tenant-scoped features.
---

Read `docs/security/tenant-isolation-review.md`. Existing roles, customer email ownership
and support groups do not establish tenants. Never report multi-tenant readiness from them.

Establish a trusted tenant and live membership on the server. Treat a client tenant ID as a
selector requiring authorization, not as authority. Separate platform administration from
tenant administration. Define same-email membership in multiple tenants explicitly.

Carry the authorized tenant through every storage query and write, foreign-key relationship,
R2 object access, DO namespace/event, API-key scope, inbound mailbox, outbound email,
Vectorize namespace/filter, job payload, cache, webhook, export and deletion operation.
Reauthorize asynchronous work and define behavior for removed memberships and deleted tenants.

Test A and B with colliding local identifiers, customers and agents, plus missing/wrong/revoked
membership. Exercise list/detail/create/update/delete, attachments, internal notes, realtime,
AI, inbound email and retrying jobs. Assert no data returned AND no unauthorized side effects.
Do not merely assert that SQL contains a tenant_id string. Recheck database constraints and
Cloudflare behavior in isolated staging before removing the multi-tenant release block.

FidesLang metadata is optional end-user functionality; authorization and data isolation remain
mandatory regardless of whether that functionality is enabled. Preserve the v0.1.0/v0.2.0
coverage targets without asserting that unimplemented metadata already exists.
