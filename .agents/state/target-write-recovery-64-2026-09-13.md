# Certified target-write recovery — 13 September 2026

Progresses #64, following merged #282. This is a bounded accounting change, not
permission sharing, issue completion or Beta2 release clearance.

A current database-backed session cold admission may recover at most one quiescent
single-operation ticket-write holder from the same full session identity. Own-scope
recovery has priority; the cross-scope choice replaces it rather than adding another
recovery pass. The in-memory scan remains bounded by 64 entries, with no selection SQL.

Only target-write entries retain a deep-frozen original credential/requirements
snapshot plus exact credential and recovery-group keys. The credential/requirements
serialization remains limited to 16,384 bytes, with two separately bounded keys.
No prior request database, observer, repository, clock or callback is retained. The
current request reconstructs original-target authorization and the existing recovery
service. The business cache partition, operation fingerprint and terminal fences stay
unchanged. Tenant, actor, role, session version, expiry and MFA remain in the group key.

Selection matches binding identity, namespace, tenant, actor and recovery group. It
excludes pending, locked, unknown and in-flight work. Sealing and a recovery lock occur
before I/O; the lock clears only if still owned by that attempt. Every recovery outcome
is followed by fresh authorization/authority for the new target. Only acknowledged
central reconciliation earns existing holder/refill credit. Shared read/email pools
are not cross-scope candidates. Original-target revocation leaves liability intact.

## Evidence

The persistent synthetic full-policy probe on merged #283 plus this change completed
20 canonical creates, 20 public replies paced across the unchanged ten-per-minute
limiter, 60 detail/history/draft reads, queue/list reads, workspace save, preferences,
draft save/restore, batch and single SLA, reply capability and activities. All passed.
The fixture was disposed; its separate persistent state and prior failing states remain.
No existing user preview, provider or storage was changed.

After that probe the cache retained 41 scopes and 20 holders, with 34 committed and
zero unknown/in-flight operations. Coordinator encoded state was 70,859 bytes plus
33,488 bytes reserved recovery headroom: 104,347 of 122,880, leaving 18,533 bytes.
The prior equivalent path failed with 108 bytes remaining. The new code recovers
holder metadata; it does **not** reclaim active cache scopes. The 64-scope bound remains
and arbitrary distinct ticket/action workloads are not accepted by this evidence.
Twenty-ticket update/support-state journeys remain a separate acceptance probe.

A native recovery-stage observer measured 21 recoveries during 20 distinct replies,
with maxima of 38 D1 reads and 6 writes per recovery, inside the unchanged 4,096/64
allowance. This is a measured synthetic workload, not a measured worst-case claim.
Current authorization keeps its 512-read estimate and indexed 65th membership sentinel;
current authority retains its 1,024-read snapshot bound and 128/129 allocation sentinel.
Closure reads at most nine operation rows and prunes at most two expired receipts.
The existing allocation sentinel native test passes at 128 and rejects 129.

The capability native fixture now explicitly admits 64 distinct memberships and then
rejects the 65th. Its earlier repeated synthetic group name could trigger a uniqueness
error before the sentinel; that generic rejection was not accepted as proof. The
corrected fixture uses unique names. An initial recovery test deleted membership and
correctly revoked the entire session through the existing trigger; it was replaced
with a live-session test moving the original ticket to an inaccessible group. That
original holder stays unclosed while the independently authorized new ticket loads.
No session version or trigger was reset to make the test pass.

Twelve focused cache adversarial tests use real pure coordinator reservations and
holder installation, plus a restored current-request construction spy. Service tests
verify all six identity fields, exact original requirements, candidate-only descriptors
and current repository/clock use. Final checks passed: 863 ordinary server tests, server and email-runtime typechecks,
focused lint, all 22 affected native cases (14 email, five staff and three SLA),
and the two native membership/allocation sentinel cases. No broad unchanged API
suite is represented as rerun. The current source preserves merged #283 guards.

GPT coordination retained the accounting/authorization decisions and actual execution;
a separate GPT agent implemented the bounded adversarial test file and reported actual
checks. Known source packets were reused; no independent graph crawl, private cloud
review, Copilot request or paid fallback was used.
