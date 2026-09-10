# #152 bounded marker compatibility correction

Owner approved10September2026: UI/new-updated requests use Answer/SOP; SOP remains internal and public retrieval Answer-only. Unsupported markers rejected. ExistingQuestion records preserved without automatic conversion. Current152issue and mirrored master-package issue source carry this approval. Full151→152assistant delivery remains separate and incomplete.

## Ownership and integration

- Coordinator: sole integration/GitHub owner.
- Native evidence_copyedit: completed server handler validation and focused/lifecycle tests in isolated codex/152-qa-marker-contract from accepted6299bfef. Resume exposed no model/effort override or metadata; no switch/separateallowance claimed.
- Coordinator added real SQLite-backed public QA source-revalidation regression, verified Node22 checks and publishes this partial PR.
- UI/read-type consumer lives in draft167 on48branch (afe8365), including explicitSOP labels and legacyQuestion compatibility notice. Integrate server correction before48acceptance. No full152closure or frontend acceptance from this PR.

## Verified changes and tests

Handler parses JSON safely and validates answer/sop/null before service invocation. Missing/invalid/unsupported/malformed requests return400 without mutation call. Authentication/MFA/role/tenant middleware unchanged.

Full migrated SQLite service lifecycle exercises answer→sop→null; BlegacyQuestion remains unchanged. Local vector/embedding doubles verify side effects; these are not provider calls. Public reader regression supplies staleAnswer vector metadata for publicAnswer/SOP/internalAnswer/legacyQuestion/foreignAnswer rows; authoritative scoped repository revalidation returns only own publicAnswer. Existing failed-unmark test verifies visibility withdrawal with cleanup manifest retention.

Node22.19.0:416servertests/46files pass, serverTypeScript and directESLint on3changed code/testfiles pass. Local Miniflare tenantcore1test and storage/background4tests pass. No remote bindings/provider activation. Exact PR revision CI/security/signing and integration read-back remain required.

## Environment and corrected failed approach

Reused installed159dependencies via local ignored symlinks; no package/lock changes. MissingSQLite native binding rebuilt from source. Default systemNode required ABI147; explicitly select projectNode22 (ABI127) for tests. Do not misclassify this runtime mismatch as an application defect.

A preliminary worker claim that SOP required a migration was incorrect:0001/0009historical checks are superseded by0014tenant table replacement, whose activeqa_type column has no enum constraint. Full migratedSQLite SOP write proves support. No migration is required or added. Preserve historical migration files andQuestion data.

## Delivery state

Project152 In progress, Actualstart2026-09-10 verified; Progress remains0pendingaccepted evidence. Baselines unchanged. No full-scope forecast movement inferred from this compatibility slice; account for accepted correction at integration without double-counting151/152work. ZeroCopilotrequests, no bypass/merge yet. Remaining: exact-head CI, bounded server acceptance/integration,48UI integration and full approved152capabilities.


Accepted compatibility receipt:172merged10September18:28:48UTC, signed4fce7b6654db924d818d2ee2ad77d3c855ee9d46. Verified GitHubsignature and exact reviewedtree528d88f49a34fc3c888274357937b1eb8d5644d1; all9c46requiredCI/CodeQL passed, no reviewthreads/findings. Owner PR-only approving-review bypass used; not independentapproval. ZeroCopilot. Full152remainsInprogress; nofullassistantacceptance or forecastchange.48refreshed from thismain, resolving only duplicated trailing blank lines in the approved152issue source. Earlier premergepending state is historical.
