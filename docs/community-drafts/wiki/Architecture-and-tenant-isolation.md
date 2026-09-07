# Architecture and tenant isolation

The inherited code has an agent dashboard, customer portal, widget and Worker backend. Its configuration includes D1, R2, Durable Objects, Workers AI, Vectorize and Workflows.

Tocyn's direction is a Cloudflare-only application architecture with multi-tenant operation. A public project contact page using Web3Forms is separate from that application.

## Isolation work

Tenant boundaries must be reviewed across authentication, membership, database reads and writes, storage keys, real-time events, background tasks, email, API keys and AI retrieval. A trusted tenant context must be enforced through each operation.

[Issue #19](https://github.com/nathcymru/Tocyn/issues/19) tracks the design and cross-tenant regression tests. This page does not claim those controls are already complete.

## Privacy metadata

FidesLang work starts with an inventory of applicable data and processing boundaries. v0.1.0 targets majority coverage; v0.2.0 targets all applicable areas and optional end-user capabilities. Disabling those capabilities must not disable access control or tenant isolation.
