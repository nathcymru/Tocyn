# #64 administration admission candidate

Coordinator-owned branch `codex/64-admin-admission`, based on accepted main `b5705ade`. This is partial #64 delivery; beta.2/#140 remain incomplete.

## Delivered scope

Settings/theme and permission reads share current session/MFA/capability and exact budget authority with their actual D1 read batch. Settings/theme writes have durable idempotency receipts. Permission changes preserve exact revision conflict behavior and all-agent session revocation; a maintained tenant agent count determines a conservative reservation, with an atomic population-growth fence before changes. Theme remains readable by authenticated operators without settings-edit permission. Migration0055 introduces only local-tested receipt/counter/index structures.

## Evidence

- Native Worker/D1/DO acceptance passes: same-key replay, payload conflict, stale policy revision/replay rejection, current-session read revocation, owner-policy write revocation, cross-tenant non-effects, theme read compatibility, and population growth after reservation causing rollback.
- 501-agent permission change with150 expired receipts measured1924 D1 reads/612 writes against3028 reserved writes (read reservation4564). No fixed actor ceiling or reduced session revocation.
- Integrated accepted201: server and budget-runtime TypeScript pass; all72 server unit files/693 tests pass; focused lint passes. Logs under `/private/tmp/tocyn-admin-final-*` and `/private/tmp/tocyn-admin-complete-lint.log`.
- Runtime tests registered in package and CI. Exact remote revision CI/security and signed integration remain pending.

## Remaining and boundaries

Other administration, usage/provider, auth/ingress, mail/jobs and broader resource overhead remain #64 work. No full-issue completion percentage asserted. Local synthetic Miniflare evidence does not establish deployed Cloudflare behavior. No remote resources, external mail or Copilot reviews requested. No owner approval missing.

Next: publish coherent draft PR, review exact-head CI/security, preserve required signing/review-thread checks, integrate under existing owner review-only bypass when accepted, then issue/Project/Wiki receipt.

## Closed-reservation final review correction

Root found the exact operation check could accept a retained operation from a now-closed grant. It now also requires absence of the whole-grant closure. Native regression stages a retained exact operation and closes its reservation before the business batch: old code returned200; fixed code returns503 with no settings mutation. Complete native case passes, runtime types and focused lint pass. Logs /private/tmp/tocyn-admin-closed-grant{,-red}.log. Previous cancelled/superseded remote runs are not final evidence; exact new revision still requires all CI/security/signing gates.


## Combined administration integration, 11September2026

PR205 is now the single integration owner for settings/theme/permissions plus saved-filterPR209(cfcf802) and group/directoryPR208(fc6f4d1). Root merged accepted20274e0abf then both reviewed branches. Shared CI registrations preserve all three native suites plus accepted ticket-list coverage. Accepted knowledge budgetGrantOperationConstraint/Statements were preserved during helper conflict resolution; no source continuation fence was discarded.

Combined head4f3baec passes shared runtime types and native12/12 (admin1,groups5,filters2,lists4), logs /private/tmp/tocyn-admin-combined-{types,native}.log. Full exact new-head CI/security remains required. PR208/209 stay draft evidence branches; do not merge them independently or close issue64. They can be superseded after205accepted. Root owns these frozen trees; workers implement separate API-key/configuration successors.

Accepted main20274e0abf has valid signature and testedtreeb25f677c408dee35d03ddafc93c77804a09d6ea7, CI34610532368/CodeQL34610525898. Issue64receipt5636319853 and151receipt5636320126 record partial acceptance. No owner input missing, no Copilot request or deployment. Full140 remains open.


## Frozen cross-path batch

PR205 now integrates204/206/207/208/209, not onlyadministration. See current [coordinating checkpoint](beta2-checkpoint-2026-09-11-1600.md). Application342c34c passes69native+server/shared/storage types with all0051–0058. New210/APIkey/DELETE/channel work explicitly remains outside. FullnewCIrequired.
