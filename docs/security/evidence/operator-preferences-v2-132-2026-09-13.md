# Remaining operator preferences — partial #132 receipt

Source base: `75c5a1d3e18eb603ac3f96503a85b962afe2963d` (13 September 2026). Owning scope: #132; optional deterministic advancement also progresses #128. No full acceptance or candidate promotion is claimed.

## Implemented contract

- Defaults retain current behavior: compact navigation, remembered context panel, enabled search accelerator, standard activity refresh, no automatic advance.
- Labelled navigation retains accessible link names/current state. Explicit context applies once per opened ticket; a manual toggle remains effective. Disabling the accelerator leaves native Tab/Escape/navigation semantics intact.
- Quiet activity defers unsolicited refresh, provides durable Updates available and explicit Refresh, and preserves critical ticket/delivery/error updates. The authenticated Layout identity key resets activity state.
- A locally initiated resolve must be acknowledged and confirmed resolved. Confirmation retry may advance once; remote state, polling and repeated acknowledgements cannot trigger it. The mounted list reads one authoritative first page in its current view/sort, using a fresh SLA snapshot when applicable, and selects the first non-current open/pending row. No page crawl or whole-queue-empty claim. Failed/no-candidate reads preserve the current detail with a mobile-visible notice. Identity, committed filters/view, preference changes and manual pagination cancel obsolete advance effects. Existing draft navigation guard remains authoritative.
- Migration0076 replaces the v1 CHECK-constrained table with v2 while preserving valid existing four choices, revision, timestamp, tenant/user PK and user cascade. Five bounded columns have checked defaults. Invalid historical schema/data aborts the migration rather than resetting it. Writes require exact v2/revision CAS and safe next revision. Unknown/corrupt reads and explicit schema errors disable edits with safe defaults; ordinary network failures retain local preview/Retry without writing before a valid revision is known.

## Executed evidence

- Server ordinary unit suite: 905/905.
- Dashboard ordinary unit suite: 382/382 before final scoped hook/notice/viewport corrections; final affected suite: 66/66 after those corrections, including four actual-detail confirmation/context checks.
- Independent native SQLite migration rehearsal: 9/9, using real migrations through0066, colliding tenant/user IDs, exact preservation, PK/FK lifecycle, invalid-history rollback and new constraints.
- Real isolated Worker/D1 HTTP theme/preferences suite: 4/4 (presentation first passed in a focused1/1 run). Includes v2 defaults, tenant separation, competing revisions200/409, unsupported schema503, revision-zero overwrite denial, old-version/max-revision rejection, revocation and guarded mutation accounting for existing theme writes.
- Server and dashboard types, standalone native HTTP test types, dashboard build, configured workspace lint and whitespace checks passed. An initial out-of-tree ad hoc TypeScript config resolved incompatible ambient types; the same test passed with the proper server-local configuration. No dependency installation or runtime ABI change.
- Current live review rules retain strict required CI/security checks. The Copilot-named live rule contains deletion/non-fast-forward guards only; no automatic reviewer trigger was added and zero Copilot requests made.

## Routing and limits

GPT owns production, migration/CAS, integration and source review. Another GPT worker supplied bounded migration and actual-detail tests, which were executed. One free cloud gpt-oss120b UI proposal (1464 input/1100 output tokens) was truncated and contradicted verified controls; rejected with no adopted tests or savings claim. No new local inference was requested for this consequential slice.

No running browser candidate/storage was changed, no migration applied to it, and no remote resources were touched. Simulator focus tests are not real-browser reflow, zoom or assistive-technology acceptance. Full #132/#128/#140 acceptance remains open. No progress percentage or historical schedule baseline is changed without defensible acceptance weighting.

The new fields add no indexes/probes. A conservative64-byte incremental logical-record planning estimate covers bounded strings/booleans/header fields; it is not physical D1 page/billing proof. Migration transient old/new tables and temporary space still require release rehearsal/clearance. Broader existing workspace storage admission is explicitly unresolved; this PR does not widen shared accounting scope.
