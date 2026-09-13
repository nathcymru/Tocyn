# #64 cold scope recovery — partial evidence, 13 September 2026

Base: `24cda3293ad0c65bfd4a2ae82e175d23c1f9bace`. Owning issue: #64. Progress remains partial; no defensible new percentage or baseline change.

An isolated native reproduction showed four authenticated staff/customer detail/history scopes returning across three grant expiries accumulated twelve holders with zero recoveries. Each scope was below the former four-refill trigger. The regression failed before the correction (zero versus eight expected reconciliations).

The cache now attempts at most one eligible quiescent grant recovery during its existing serialized cold allocation. Warm spends do not perform recovery RPCs. Binding, namespace, tenant, exact credential/work scope, generation and current authority fences are retained; no cross-credential sweep is introduced. Only confirmed reconciliation returns a local refill slot. Unknown or in-flight operations remain ineligible, and each grant retains its two-delivery bound.

Earlier recovery exposed a second stale-authority path: an unconfirmed recovery could refresh central authority before the subsequent allocation. The cache now resolves current authority after any attempted recovery callback, including pending/throw, before allocating. It does not return credit on an unconfirmed result.

## Actual validation

Node 22.19.0; installed dependencies reused. Final affected native HTTP read suite: 18/18 passed (34.3 seconds), including sparse expired scopes (eight recoveries, four holders), sustained staff/customer reads, warm RPC counts, concurrent refill, lost reconciliation acknowledgments, unknown completions, and policy/credential revocation during an awaited recovery reservation. Initial stale test assumptions were corrected: expired successful retirement removes prior operation rows; loss-retry tests run within their recovery grant lifetime. Full ordinary server unit suite: 766/766 passed. Server typecheck and focused source/test ESLint passed. Affected channel/configuration/filter/group/activity/list specialist assertions were updated analytically: forty reads allocate five business blocks plus four recoveries, and sixty-four allocate eight plus seven; both retain one holder. Warm no-RPC checks remain intact. The adjacent run passed 19/22 initially; three stale count assertions were corrected and rerun individually. Final adjacent evidence is 22/22 across the original run and focused corrections. Budget runtime TypeScript check passed. No build or remote deployment claim.

## Remaining acceptance

This corrects future sparse retention; it does not retrospectively settle old in-flight state, erase retained liability, or recover lost isolate evidence. Staff/SLA request completion plumbing is separate work. A lost acknowledgment retried after its recovery grant expires remains charged under the existing fail-closed contract. Metadata byte/count limits are unchanged. Full active-path inventory, fresh persistent-preview mixed workflow acceptance, and Beta.2 release gates remain open.

The current preview and its storage were not modified by these tests. Replacement-preview acceptance must use a separate synthetic storage namespace and retain the old evidence. No provider activation, remote data, routine-CI native acceptance addition, or Copilot request. Live Copilot-named ruleset was inspected: only deletion/non-fast-forward rules; setup workflow remains manual dispatch.
