# Write budget recovery — 13 September 2026

Progresses #64. This is partial delivery; sustained Beta2 acceptance remains open.

## Implemented boundary

Canonical staff create/reply/responsible-owner and the six SLA mutation batches now
record the exact admitted operation journal in the same transaction. Newly admitted
receipt-race reads record their own operation without repeating the business mutation.
The shared staff authorization helper remains authorization-only, including balanced
assignment preflights. Durable journals alone do not establish terminal completion:
unknown or in-flight attempts remain charged and cannot certify closure.

Email delivery has a separate explicit accounting partition, retaining the complete
session identity while authorizing the original ticket and group on every request.
The existing exact claim/fingerprint and current authority fences remain enforced.
Database-backed, separately charged recovery is enabled for this delivery scope.

Only staff reply/update and ticket SLA initialization/state transition opt into a
single-operation grant. Full warm-operation, cold-allocation and recovery envelopes
remain unchanged. The option has its own cache partition and actual holder operation
cap; default create/configuration blocks remain unchanged. Unsupported opt-ins reject.
This does not share target-write permission or recover across credential scopes.

## Synthetic evidence and limits

The isolated native email fixture previously recreated its D1 binding proxy per
request. Its stable raw-binding proxy now attributes request measurements through
AsyncLocalStorage; concurrent attachment/no-attachment calls retain separate counters.
No external mail provider was enabled. Twenty canonical creates yield twenty committed
email operations, three email grants and two certified eight-operation closures.
An unknown delivery does not become certified merely because another block succeeds.

The budget-only twenty-distinct-reply fixture now succeeds with the unchanged
200 million log-unit policy (160 million new-work allocation). Its HTTP rate limiter
is disabled solely in that existing specialist fixture. The full local-preview probe
retains the ten-replies-per-minute limiter: its eleventh immediate reply was refused
before budget admission, so a separate fresh probe paced two batches by 61 seconds.

That persistent combined probe completed twenty creates, twenty public replies,
sixty detail/history/draft reads, queue/list reads, workspace save, preferences reads,
draft save/restore, and batch/single SLA reads. The next reply-capability read was
refused by the budget gate. The preserved coordinator state measured 67,584 encoded
bytes plus 55,188 reserved recovery-headroom bytes: 122,772 of 122,880, with 39
unfinished new-work grants. This remains a real acceptance blocker; block size and
email pooling do not solve retention across many target-write scopes.

The local-beta activities route was separately disabled by the current route inventory;
its enablement/guard accounting is being handled under #140. No permanent exclusion
from Beta2 is claimed. Existing live previews, their storage and liabilities were
preserved. No old attempt was retrospectively marked committed. Cross-scope recovery
was proposed for coordinator review and is not implemented here.

## Validation and routing

Coordinator-owned native execution covers consequential accounting and authorization.
One free-cloud gpt-oss:120b matrix proposal (572 input / 800 output tokens) was rejected:
it was truncated and contradicted the unchanged cold-envelope requirement. No output
was applied and no retry or paid fallback occurred. These counts are not measured
ChatGPT token savings. Existing verified source locations were read directly; no graph
crawl was repeated.

Integrated validation: 841 ordinary server unit tests passed. All 58 distinct native
staff/SLA/email tests passed: the initial serial run passed 57 and exposed one stale
warm-reply assertion; its corrected targeted run passed. That correction retains a
stable-create warm zero-RPC assertion and verifies the new reply allocation. The final
86 focused digest/allocator/holder tests passed, including the actual one-operation
holder cap and unchanged replay bound. The same-key concurrency/lost-response native
case was also rerun against the final actual holder cap and passed. Server and email runtime typechecks and focused
ESLint passed. The initial lint command used the repository root without the server
configuration; rerunning from the server workspace passed without a source correction.

The two 36-operation HTTP closure tests use separate fixtures, not one combined
72-operation workload. The staff fixture explicitly funds 500 million synthetic log
units; the distinct-reply proof separately preserves its original 200 million policy.
The final integration preserves merged balanced-assignment backend and UI changes.
No build, CI, production migration, remote deployment or release clearance is claimed
by this checkpoint.
