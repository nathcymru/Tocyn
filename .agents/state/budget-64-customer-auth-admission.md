# #64 customer authentication admission — partial evidence

The customer-auth fencing increment from `codex/64-customer-auth-admission` is included in integration PR #216; acceptance remains pending its required checks and merge. It uses a tenant-qualified customer/session or widget admission fence for request, verification, logout and current-session effects. Migration `0068_customer_auth_admission.sql` retains one current OTP pointer per tenant/customer, with a tenant-qualified user cascade. It replaces the prior historical-token invalidation write without deleting audit history.

Native Miniflare evidence measures request, verify, logout and session D1 writes against their declared operation envelopes. The request proof seeds 512 expired historical OTP rows and observes no history-proportional write growth. This is D1 row-write evidence, not persistent byte accounting.

## Remaining required #64 accounting

`d1StorageBytes` is a stock dimension in `packages/shared/cost-policy.ts`. Customer auth requests can create a shadow user, auth token and current-OTP pointer, but this partial increment does not yet derive a schema/lifecycle byte bound or reserve/reconcile that stock. It must remain an explicit #64 acceptance gap; no byte quantity is inferred from row counts.

This increment also does not establish Worker CPU, Turnstile or email-provider/external-provider units, token-retention reclamation accounting, production billing, or release readiness. It must not be represented as complete customer-auth or complete #64 resource acceptance.
