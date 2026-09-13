# Completed target scope lifecycle — 13 September 2026

Progresses #64, following merged #287. This is partial acceptance of a bounded
synthetic workflow, not release clearance or unlimited admission capacity.

Only exact-success-closure-proven single-operation target-write entries can be
removed. Holders, operation links and refill counts must be zero, with no failure,
blocked state, allocation promise, recovery lock or active admission lease. The
entry generation is retired before unlinking. Failed/lost allocation, unknown
operations and active work retain their existing liability and entry state.

An admission leases its observed entry before the first authority await, leases
any newly adopted entry synchronously, and releases every acquired lease in a
finally block. Initial resolution, shared allocation and post-allocation authority
checks are protected. Recovery locks also prevent expiry-time unlinking.

Accounting revision history remains in a separately bounded registry keyed by exact
database binding, namespace, tenant and full-credential recovery-group identity.
Every eligible authority observation checks and updates that group, including new
targets and post-await checks. The registry retains monotonic authority timestamps,
deployment/policy/restriction floors and the maximum original horizon. At most 64
groups and nine policy identities per group are retained; exhaustion fails closed,
with no LRU removal. Expiry requires the original horizon and no active admission,
allocation or recovery lock. This deliberately tightens stale-snapshot rejection
across targets within the same full session identity. It does not reuse permission.

Operational compatibility: the new codec reads raw legacy, format 2 and format 3.
Pre-format-3 code cannot read newly written format 3; no downgrade compatibility is
claimed. This is a local candidate upgrade only. Separate migration and runtime gates
remain; no production migration is authorized by this receipt.

Fresh authorization, target checks, SQL completion fences, provider terminal outcome,
central acknowledgement, reservation charges and retry limits are unchanged. A
same-key admission after cleanup needs a newly charged holder. No guard, TTL, refund
or automatic recovery proof is relaxed.

## Evidence

Seventeen independently authored adversarial unit cases cover more than 64 targets
with pure central certified closure and retained charges, same-key fresh grants,
unknown/in-flight exclusions, lost reserve acknowledgements and failed installation,
initial and post-allocation leases, thrown authority reads, stale new-target snapshots,
64/65 groups, nine/ten policy identities, recovery locks, horizon retention and renewed
entries with remaining refill liability. The previous cross-scope test now expects
one remaining scope after the old acknowledged entry is removed. All 905 integrated
server unit tests pass, together with server types and focused lint.

The isolated persistent native journey passed 20 canonical creates, 20 public replies
paced across the unchanged route limiter, 60 detail/history/draft reads, the initial
shell, all 20 priority updates, all 20 support-state changes, and final queue/workspace/
preferences/drafts/SLA/reply-capability/activity reads. The fixture retained 22 scopes,
zero empty entries, 22 holders and 48 committed operations, with no unknown or
in-flight cache operations. Its coordinator retained 140 records (118 compacted and
22 unfinished), occupying 85,335 bytes plus 35,545 reserved recovery headroom:
120,880 of 122,880 bytes. Only 2,000 bytes remain; arbitrary additional bursts are
not accepted by this evidence. Existing metadata and scope guards remain relevant.

The earlier codec-only fixture's third support-state refusal at 64 scopes is preserved
as historical evidence. The new test used separate synthetic storage and local capture
transport; it was disposed after the completed journey. Existing user previews and
stored liabilities were not reset or mutated.

Four existing native generation/source-edit/monotonic-renewal/refill/identity rollback
cases and the session warm same-revision source-edit case pass. The latter initially
used the wrong working directory and passed after correcting the invocation, with no
source change. Specialist native checks remain deliberately invoked, not routine CI.
The synthetic test setup corrections and the corrected post-allocation test title do
not represent application fixes or additional acceptance claims.

GPT retained lifecycle/accounting design and execution; an existing peer agent supplied
the bounded adversarial tests. No nested workers, Copilot request, new graph crawl,
external provider activation or paid fallback was used. Whole-issue progress and Beta2
acceptance remain with the coordinator.
