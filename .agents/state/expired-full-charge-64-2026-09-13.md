# Expired full-charge accounting — 13 September 2026

Progresses #64 after #288. This partial fix recovers coordinator metadata headroom
from expired new-work reservations whose complete envelope remains charged. It does
not infer successful work after isolate loss or clear Beta2 runtime acceptance.

Only reserved/uncertain new-work grants with accounted amounts exactly equal to their
full envelope are eligible. Existing closed charges receive that amount once; the
original retry identity, attempts, envelope and allocation data remain in an uncertain
compacted tombstone. No certificate or refund is fabricated. Defects, live grants,
recovery grants and already reconciled grants are excluded. Uncertain tombstones keep
their existing retention; the change introduces no TTL pruning or scope eviction.

Trusted refresh and normal reserve retire at most two grants total across owner and
tenant ledgers per transition. Other endpoints and read-only inspection are unchanged.
A rejected new reservation can persist only conservative retirement of the original
state, using the existing single write; a failed storage write issues no grant and
retains the original stored liability.

A late certified expiry proof must still pass the existing original holder, policy,
expiry and paired-recovery checks. Only empty measured amounts and the exact full
uncertain envelope can attach that proof. The original charge is neither added again
nor refunded; the fresh recovery reservation is charged once. Lower measurements and
uncertified late claims fail closed. Existing certified retry/expiry behavior remains.

## Verification

- 17 independently authored pure accounting tests pass: owner/tenant total-two bound,
  full charge once, stock/interval sums, exclusions, retention and format3 roundtrip.
- Nine late-proof tests pass, including paired accounting and invalid proof rejection.
- All 931 ordinary server tests pass; server and focused runtime types and scoped lint
  pass.
- Three new native cases pass: persistent reload and total-two retirement, atomic
  storage failure, and refused reservation growth persisting only the retired base.
  The initial first two cases used deep equality on an RPC proxy; JSON snapshot
  normalization corrected the test comparison, after which both passed. The third
  case passed in the initial run. No production correction was required for that issue.
- The existing three coordinator native cases pass. The full budget native suite is
  87/89: API create expects201 but receives429, and warm API reply expects three
  refresh/reserve calls but observes five. Both failures reproduce identically in a
  clean detached checkout of unchanged base75c5a1d3. These are disclosed baseline
  failures. Independent diagnosis traced both to stale synthetic read funding after
  the earlier create envelope increase:8,000×0.8=6,400 cannot fund7,680;120,000×0.8
  cannot fund the61,440 create block plus45,056 reply block. Two test-only values
  now use9,600 and140,000 respectively, retaining the worker limit and every original
  success/refusal/warm-zero-RPC assertion. Both affected cases pass on the corrected
  fixture. Thus all89 distinct cases have passing evidence; the entire suite was not
  redundantly rerun after this two-line fixture correction.

A pure copy of the preserved synthetic candidate, never the live store, contained
47 expired unfinished grants and occupied60,214 encoded bytes plus61,819 reserved
recovery headroom:122,033 of122,880. Two retirements reduced the sum to119,178;
four to117,003; all47 to68,287. Owner/tenant stock and interval sums stayed identical
through each transition and format3 reload. Under a modeled fresh same-policy lease,
the largest observed reservation shape projected122,974 before retirement and120,562
after two, without changing resource or metadata guards. This copy calculation does
not claim a real authority refresh or successful live upgrade.

The current same-storage preview is preserved. Its upgrade, restart and normal UI
journey remain acceptance work after reviewed integration. Recovery-grant orphans,
finite tombstone metadata, the64-scope boundary and broader #64/#140 gates remain;
this fix does not promise arbitrary bursts or unlimited retention. Codec compatibility
is unchanged: raw legacy/format2/format3 are readable; pre-format3 downgrade is not.

GPT owned the accounting boundary and native execution; an existing peer supplied
bounded pure tests. No Copilot, new provider, live database mutation, paid fallback or
new graph crawl was used. Preserve Project progress and approved schedule fields;
these partial outcomes do not justify a new whole-issue percentage.
