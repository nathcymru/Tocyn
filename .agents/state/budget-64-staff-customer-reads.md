# Staff/customer read admission candidate — 11 September 2026

Owning issue #64; root integration owner. Branch codex/64-staff-customer-reads, prepared worker80c73fb, root correction34d7b4a, refreshed onto pending PR19854a7504 as8d41574. Accepted main is101087423e56e20993342dcdf5934d95e69f3e5c (PR198); this read candidate is not accepted.

Scope: dashboard and portal ticket detail/history only. Combined policy uses current session/group or customer ownership before bounded business reads. Off/absent/API-only preserve established compatibility. Staff private records and portal public-only canonical/history projection remain distinct. No migration.

Review corrected the admitted portal canonical projection to use its explicit bounded reference query. Runtime instrumentation now counts actual batched reference reads, rather than silently recording zero. A600-public-message fixture returns50 and measures200 index/table reads (four bounded point-probe rows per message, ceiling204). Original private/public and authority tests remain. Targeted3/3, server691/691, types passed; original worker budget130/130. Refreshed full budget aggregate131/131 passed, exit0 in118.35s; log `/private/tmp/tocyn-reads-integrated-budget.log`; Exact-current CI is still required before integration. PR198 is accepted; PR199 is refreshed and must target main for exact-current checks.

Next: publish one draft stacked on198, retarget to main after198 acceptance, verify required checks/tested tree/signature/review threads and record owner-only review bypass if used. Root owns this tree now; worker moved to isolated knowledge prerequisite work. Realtime and support-state/SLA workers remain isolated. No Copilot/paid resources or owner permission pending.

The inventory corrects active synchronous knowledge indexing versus legacy-only Workflow enqueue. This does not remove the exported Workflow entry from64 scope or create a whole151 dependency cycle. Last full human update13:06BST; next due13:36BST. Full140 remains unaccepted.

## Accepted parent and active queue

PR198 merged12:17:18UTC at signed101087423e56e20993342dcdf5934d95e69f3e5c. Reviewed54a75042f1ca25ab7df47163347392d4873e6599 and CI merge7013e8972ba479e5f352b906d2b9344f6db9ef83 match accepted treec67942163b3dfc0a4b8f1a36169203ec331ce0e8. Required CI34596479763/CodeQL34596475992 passed, threads/reviews empty, signature valid. Owner PR-only approving-review bypass used; no independent approval or Copilot request.

Root refresh48c0dff first proved parenthead54a7504 ancestry and equality of acceptedmaintree, then resolved squash-only conflicts retaining this candidate and proved the entire stagedtree equals priorHEAD. No application change or local-test substitution. Exact-currentCI still required.

Workers: support/SLAe1ac518 being corrected for indexed remap read bounds, registered native tests and suspected initialized-clock remap omission (not yet confirmed; do not declare73failed). Realtime implements lease/callback accounting and an authenticated committed-broadcast handoff in isolatedtree. Knowledge implements minimal durable per-chunk accounting prerequisite under64/151, preserving10MiB sources, existingretrieval and AI-off, not fullPDF/151/152. No owner-controlled blocker.
