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
