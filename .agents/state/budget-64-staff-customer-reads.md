# Staff/customer read admission candidate — 11 September 2026

Owning issue #64; root integration owner. Branch codex/64-staff-customer-reads, prepared worker80c73fb, root correction34d7b4a, refreshed onto pending PR19854a7504 as8d41574. Accepted main remains28e0444 (PR197); this is not accepted code.

Scope: dashboard and portal ticket detail/history only. Combined policy uses current session/group or customer ownership before bounded business reads. Off/absent/API-only preserve established compatibility. Staff private records and portal public-only canonical/history projection remain distinct. No migration.

Review corrected the admitted portal canonical projection to use its explicit bounded reference query. Runtime instrumentation now counts actual batched reference reads, rather than silently recording zero. A600-public-message fixture returns50 and measures200 index/table reads (four bounded point-probe rows per message, ceiling204). Original private/public and authority tests remain. Targeted3/3, server691/691, types passed; original worker budget130/130. Refreshed full budget aggregate131/131 passed, exit0 in118.35s; log `/private/tmp/tocyn-reads-integrated-budget.log`; Exact-current CI is still required before integration. DraftPR199 is stacked on198; retarget only after the parent is accepted.

Next: publish one draft stacked on198, retarget to main after198 acceptance, verify required checks/tested tree/signature/review threads and record owner-only review bypass if used. Root owns this tree now; worker moved to isolated knowledge prerequisite work. Realtime and support-state/SLA workers remain isolated. No Copilot/paid resources or owner permission pending.

The inventory corrects active synchronous knowledge indexing versus legacy-only Workflow enqueue. This does not remove the exported Workflow entry from64 scope or create a whole151 dependency cycle. Current30-minute update due13:07BST; preceding update12:37BST. Full140 remains unaccepted.
