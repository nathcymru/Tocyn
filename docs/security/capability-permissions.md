# Capability permission foundation

Issue #79 implements a finite server-side capability catalog for the existing operator administration routes. It is an application authorization foundation, not an implementation of the governed reference executor, approvals, or external integrations owned by #80 and #81.

## Authority order

Each capability is evaluated at the request and again immediately before a protected database mutation:

1. the deployment-owner capability ceiling;
2. the deployment-owner role grant;
3. the tenant's delegated agent policy; and
4. any deny-only constraint from the actor's existing ticket group memberships.

An unknown capability, missing row, unavailable policy read, disabled ceiling, disabled role grant, disabled tenant policy, or disabled group constraint denies the operation. Tenant administration only changes the agent policy. It cannot write `deployment_capability_ceiling` or `deployment_role_capability_grants`, so it cannot grant beyond the owner/role authority.

The initial migration retains existing configurable agent settings as explicit agent role grants and migrates the legacy `agent_settings_permissions` boolean map into per-tenant restrictive policy rows. Administrators receive explicit deployment-owner role grants; the previous middleware bypass was removed. Reference-tool capabilities are catalogued but receive no agent role grant until a reviewed owner change adds one.

Deployment-owner ceiling and role-grant changes are an owner-only operational contract: make them through a reviewed migration or authenticated deployment-level D1 administration, record the new revisions, and run the focused permission checks before rollout. Tocyn exposes no tenant-admin HTTP route for either table.

## Revocation and recovery

A tenant policy update uses an optimistic revision. A stale browser save returns `409` and must reload the policy before retrying. A successful update increments all affected tenant agent session versions, so their next authenticated request is rejected and an in-flight mutation fails its boundary revalidation when its original policy/session fingerprint no longer matches.

This cannot recall an external action that completed before revocation. Future governed tools must use the same revalidation fence at dispatch and a durable execution generation before any resumable side effect, as required by ADR-0010.

The existing Agent Permissions page exposes the tenant's delegated agent policy. Disabled controls identify capabilities that the deployment owner or role has not delegated. Its native checkbox controls retain keyboard focus, screen-reader labels, and visible focus styling through the existing static CSS utility classes; it does not use runtime CSS-in-JS or enter Worker bundles.

## Local demonstration

Run these checks from the repository root with synthetic/local data only:

```sh
npm exec --workspace=apps/server -- vitest run src/middleware/__tests__/permission.guard.test.ts src/handlers/__tests__/permissions.handler.test.ts
npm exec --workspace=apps/server -- vitest run src/handlers/__tests__/dashboard.handler.test.ts src/handlers/__tests__/groups.test.ts src/handlers/__tests__/channels.handler.test.ts src/handlers/__tests__/settings.handler.test.ts src/handlers/__tests__/filters.handler.test.ts
npm run typecheck --workspace=apps/server
npm run build --workspace=apps/dashboard
```

The permission tests demonstrate owner/role/tenant intersection, group denial, tenant-admin denial of owner-managed capabilities, stale policy handling, and a paused mutation that is revoked before its side effect commits. Policy reads add bounded D1 lookups at authorization and mutation boundaries; there is no cache, provider call, remote migration, or background retry. When D1 policy data is unavailable, authorization fails closed and callers must retry only after the policy store is healthy.

## Limitations

Current route coverage is the pre-existing settings, channels, groups, ticket fields, automations, API-key, filter, and usage surfaces. Resource scopes such as existing group membership and ungrouped-ticket behavior retain their current route-specific semantics. #80/#81 remain responsible for tool schema validation, approvals, dispatch/retry reconciliation, and external-effect verification.
