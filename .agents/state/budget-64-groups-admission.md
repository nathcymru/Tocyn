# Group/directory admission — root integration checkpoint

DraftPR208, reviewed worker head1d0f074b47279d0ebe945c827f16339140802bea, baseaccepted203. Root owns integration. Worker now handles separate API-key administration (0060); configuration worker owns0059; groups0058 is reserved and no others may reuse it.

Complete directories and group deletions use maintained tenant/member populations and current session/MFA/capability/target/policy fences. Root review identified missing durable exact-operation linkage; worker corrected it before acceptance. The extracted budgetGrantOperationStatements helper is shared with API mutation batches; whole-grant closure rejects a delayed operation even if its exact operation row already exists.

Worker697/697server and5/5native pass. Root ran combined native group/API admission94/94 to verify the shared helper extraction, then group5/5 after converting test request headers to a plain record. Shared runtime typing initially exposed browser/Miniflare RequestInit mismatch; narrowing the helper to actual string-body fixtures and plain headers resolves it. Shared runtime typecheck passes. Logs /private/tmp/tocyn-groups-{root-native,final-native,shared-types-final}.log.

Required CI now includes group native entry/test typing and runtime suite, beyond the package-only script. Exact new CI head remains pending; do not accept earlier CI as evidence for this registration correction. No Copilot requested, no merge/bypass used yet. Local synthetic only.

Native complete2802-member list8430reads/4writes fits25488/8. Native2801-member deletion14058reads/8409writes fits47888/44824. These are D1 metadata measurements, not provider billing. Full64 andbeta2#140 remain incomplete. PR202/204/205 CI remains separately pending; no owner response missing.
