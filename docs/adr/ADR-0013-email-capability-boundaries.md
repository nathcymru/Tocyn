# ADR-0013 — Authentication mail and support-email conversations are separate capabilities

- **Status:** Accepted
- **Date:** 8 September 2026

## Context

Tocyn currently has an injectable email transport with Resend configuration and a separately gated inbound-email path. The roadmap also plans Cloudflare-native transactional-mail work and a canonical support-email channel.

Treating those as one feature would make infrastructure migration unnecessarily block support-channel work and could incorrectly imply that sending an authentication email means bidirectional helpdesk email is complete.

## Decision

Separate:

1. **transactional/authentication mail transport** — login/magic-link/account messages and reusable outbound transport infrastructure;
2. **support-email conversation adapter** — verified inbound routing, tenant ownership, thread/reply mapping, canonical conversation ingestion and operator-to-email delivery.

A transport migration does not automatically implement the support channel. The support channel does not depend on a particular authentication-mail provider unless a concrete implementation dependency is demonstrated.

## Consequences

- Resend can remain a temporary beta dependency without blocking the API/portal first beta.
- Cloudflare-native transactional-mail migration can be scheduled independently.
- Support-email acceptance must prove inbound verification, tenant routing, threading, retry/delivery behaviour and canonical conversation state.
- Shared transport changes require compatibility tests across both uses without merging their ownership/scopes.

## Related

- `apps/server/src/services/email/transport.ts`
- `apps/server/src/services/email/tenant-outbound.service.ts`
- `docs/architecture/channel-adapters.md`
- M1.4 Transactional Mail
- M7.5 Support Email

## Current direction addendum

The post-beta direction keeps authentication mail separate from support-email conversations. The historical local beta used local mail capture; no external beta mail delivery is required for the next workspace gate. See [ADR-0016](ADR-0016-product-boundary-and-release-gates.md) and [ADR-0027](ADR-0027-linked-work-and-workflow-continuity.md). This is implementation pending.
