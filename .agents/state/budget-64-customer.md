# #64 customer admission — current handoff, 11 September 2026

Branch: `codex/64-customer-admission`, refreshed through accepted main `f2e8edef`. This is partial #64 delivery evidence only; root owns integration, issue/Project updates, PR work and acceptance.

## Historical prerequisite retained

The original local prerequisite (`5ad5eae` and `a637fcb`) introduced `CustomerCurrentCredentialRepository` and `CustomerBudgetReservationService`. It establishes two indexed, tenant-scoped current-authority reads: live customer identity/session/email, then exact customer ticket ownership for replies. It keeps the reservation and its commit handoff opaque until a customer-specific canonical D1 fence consumes it.

## Active customer composition

- Customer portal create (`POST /api/v1/customer/tickets`) and reply (`POST /api/v1/customer/tickets/:id/messages`) compose authenticated customer claims, canonical receipt preparation and `CustomerBudgetReservationService` when `BUDGET_ADMISSION_POLICY=ticket-mutations-v1`.
- Authenticated widget create (`POST /api/v1/widget/tickets`) uses the same `portal.ticket.create` receipt operation with trusted `widget` source attribution. Its fingerprint differs from portal input, and its verified current session version is carried into the canonical fence. There is no widget reply route.
- Customer receipt keys are tenant/principal/operation scoped. Current role, session version, expiry, normalized email and reply ownership are rechecked before admission and inside the canonical D1 assertion batch. A saved receipt is reauthorized before replay.
- Reply admission precedes attachment-reference validation, so capacity rejection performs no R2 work. The reply envelope reserves bounded attachment validation and bounded NotificationDO fanout/cleanup; only a winning public reply invokes the broadcast. Portal/widget creates do not claim that reply broadcast allowance.
- `off` and `api-ticket-mutations-v1` preserve legacy customer/widget behavior; malformed policy configuration fails closed for these customer mutation routes.

## Local evidence

- The customer reservation native suite exercises colliding tenant/customer/ticket IDs, warm allocation behavior, current-credential/role/session/ownership denial, malformed authority, indexed-query bounds, and exact reply fanout envelope composition.
- The combined local Miniflare route proof covers portal create/reply receipt replay, customer tenant separation, cross-surface source conflict, lost acknowledgement recovery, current-session revocation at the canonical fence and widget revocation/rotation. It also proves a reply capacity rejection and its retry make zero R2 reads; a replay causes no second NotificationDO broadcast.

## Remaining #64 limits

This does not complete #64 or establish whole-operation/provider coverage. Customer upload/download and reads, widget AI chat, CPU/duration, request/response bytes, R2 storage/bytes, NotificationDO duration/storage, delivery recovery and provider billing remain outside these envelopes. No provider, production, email or remote measurement was performed.

## Coordinator integration — 11 September 2026

Combined with recovery PR #194 (`a838cb7`) at local merge `b75cf59`. Resolved shared canonical service/repository and native fixture controls additively: customer commit fence and response projection remain distinct from API whole-grant lifecycle and staff checks. Integrated package native run passed90/90, zero failures/cancellations/skips,81.5seconds (actual completed handle5205, local log `/private/tmp/tocyn-64-customer-integrated-native.log`). Full server and API runtime types pass. Customer runtime config name is `scripts/tsconfig.customer-budget-admission.json`; an attempted incorrect filename produced no check and was corrected. Required PRCI and exact accepted-base refresh remain pending.

Recovery PR194 CI is active under34582825330,CodeQL34582823135; receipt https://github.com/nathcymru/Tocyn/issues/64#issuecomment-5632194228. Root watch85459. Do not restart a running check from an observation timeout.

Collaboration dashboard bundle overrun was a measurement error: exact Node22.19 repository gzip9 gate gives569159/570000totalJS,100896/135000initialJS,15603/16000CSS. No gate changed; Astra restored experiments. Actual AT has a local fixture capacity rejection under diagnosis. Root additionally found ascending paginated conversation refresh could authorize rebasing before later material was rendered; #70 worker must fix bounded review coverage and retain a multi-page regression. No owner approval pending.

## CI compatibility correction — 11 September 2026

PR #195 at c03a2da failed its full D1 integration assertion: canonical normalization dropped widget custom fields. The corrected normalization retains validated fields only for the existing widget source; normal portal semantics remain unchanged. Native combined-mode tests now prove persisted fields, exact replay and changed-field conflict. The separate tenant's untouched request window keeps the existing rate limits intact. Full `scripts/d1-integration-test.ts` passes, including the original failing assertion and all five integration batches. Server and runtime types plus scoped lint pass. Required CI must rerun on the corrected revision; no acceptance is inferred from the earlier failure.
