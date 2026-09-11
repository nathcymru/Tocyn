# #64 certified grant compaction checkpoint

Date: 11 September 2026. Owner: coordinator integrates; Astra/high owns this bounded local remediation of the unaccepted `130d36c` checkpoint in `codex/64-certified-compaction`. Scope remains API whole-grant recovery only. No push, GitHub mutation, Copilot, provider, GUI, remote database or owner-port operation occurred. This does not complete #64 or beta.2; #50 remains the accepted contract baseline.

## Corrected whole-pipeline behavior

The native API → holder/cache seal → bounded D1 closure → recovery-purpose reservation → coordinator path now atomically rolls up both the original work grant and its linked recovery reservation. Both detailed reservation slots become reusable. Original measured-plus-uncertain charges and the entire prepaid recovery envelope remain charged, by dimension/window/purpose; the owner aggregate includes those charges across tenants. Failed or uncertain recovery reservations remain detailed and charged. Generic reconciliation alone does not authorize compaction.

The configured `maxReservations=N` remains the **total** slot ceiling. Ordinary new-work grants stop at N−1 so recovery can use one slot within that same ceiling; total N=1 intentionally cannot intake new work. The default owner ceiling is unchanged. Native unchanged-total-2 and unchanged-total-64 cases prove ordinary saturation rejects before canonical writes and subsequent real API recovery/new work stays within the total limit. The cache-only 64-scope test explicitly configures total65 (64 ordinary + one recovery slot) to isolate the separate cache limit; its 65th-scope/no-extra-DO-call assertions are preserved. Pure one-ordinary-slot fixtures now configure total2 and retain their original charge/compaction assertions.

An existing compacted grant record retains a SHA-256 identity of the complete normalized certificate: original reservation/holder, policy and restriction revisions, terminal evidence, accounting, operation-set fingerprint, expiry and linked recovery identity. The DO derives this digest itself before reading mutable accounting, avoiding an asynchronous gap in its read/write mutation. An exact retry survives a full native Worker disposal/restart. Different accounting, operation set, terminal, tenant or reservation rejects. A missing record is never completion evidence. Certified records retire after their original retry horizon; uncertain records do not.

Recovery reservations carry a checked link to their original work reservation. The finite delivery limit remains two attempts per prepaid reservation. At most two distinct linked recovery reservations can exist per original grant, preserving a bounded terminal-collision case without forgiving its charge. Successful recovery cannot create a fresh linked reservation after completion; the existing reservation can still acknowledge its remaining lost-response retry.

## Existing storage, bounded metadata

The same `budget-owner-aggregate-v1` state key stores packed existing grant records. Equal amount maps are stored once, grant allocations reference existing allocation entries by index, and completed certificates use their cryptographic digest. This adds no journal or provider. Reads support the previously stored object and JSON-string forms; new writes use actual UTF-8 `Uint8Array` bytes. This matters because native string serialization can expand a whole Unicode-containing string to UTF-16.

The physical guard is 120 KiB of actual encoded value, leaving 8 KiB under the native 128 KiB value limit. Admission and material authority growth additionally reserve conservative completion/recovery headroom for every unfinished accepted work grant. Already persisted paired-recovery metadata consumes its own reserved headroom; unrelated reservations do not. Same-authority lease refresh remains available. Native proof reaches the growth boundary, verifies rejection leaves the prior state unchanged, then successfully reserves recovery and persists both completions for already accepted API work.

Logical upper bounds remain 4,096 retained grant records across the owner, 256 allocation identities and 512 charge rollups per tenant, and 8,192 owner-plus-tenant allocation metadata entries / 8,192 owner-wide rollups. The physical byte and headroom guards can reject earlier; these counts are ceilings, not throughput promises. Certified expiries are swept across tenants before the shared retained-record limit is checked. Stock rollups never reset when a grant expires or an allocation ID changes. Historical interval charges retire only after their interval ends. Exact current-authority comparison excludes historical allocation entries.

## Incremental migration

`0040_budget_grant_closures.sql` is restored byte-for-byte to accepted parent `a838cb7`. New `0041_budget_grant_closure_expiry.sql` adds nullable expiry and the tenant/expiry index. Native upgrade proof starts through 0040, writes existing closure/operation rows, applies 0041, verifies all existing fields remain and expiry is NULL, then proves cleanup cannot remove unknown-expiry evidence. Fresh post-upgrade API closure succeeds. Known expired closures and their bounded operation links are removed opportunistically in batches of two, using the prepaid recovery envelope; unknown expiry is retained conservatively.

## Validation receipt

All checks below completed with observed exit 0 on the final UTF-8 source. Node 22.19.0; `NODE_OPTIONS=--no-experimental-webstorage`. Commands ran from `apps/server`. Final logs use `/private/tmp/tocyn-64-compaction-delivery-*.log` (focused units: `slot-units.log`); machine-readable exit/session evidence is `/private/tmp/tocyn-64-compaction-acceptance-status.json`.

| Acceptance evidence | Result |
| --- | --- |
| `npm run test:budget-admission-runtime` | 91/91: 81 API + 10 session; the earlier nine-session estimate was incorrect. |
| `npm run test:budget-coordinator-runtime` | 3/3 native DO proofs. |
| Focused coordinator/owner/isolate-holder Vitest | 43/43. |
| `npx tsc -p scripts/tsconfig.budget-runtime.json` | Pass. |
| Scoped ESLint, including storage codec and native fixtures | Pass; existing module-type warning only. |
| `git diff --check`; accepted 0040 comparison | Pass; 0040 unchanged against `a838cb7`. |

The cache-bound fixture with total65 stores 29,211 bytes for64 ordinary scopes; the unchanged total64 ceiling stores 28,858 bytes for63 ordinary scopes and preserves its recovery slot. At the byte boundary, unrelated new growth rejects at 110,486 bytes without a write; recovery of already accepted API work then persists both completions at 113,836 bytes with 163 retained records. The Unicode history fixture retains 103 charged unexpired windows at 113,824 actual stored bytes, rejects further growth, then demonstrates eligible interval/certified-expiry pruning while retaining uncertain records. The actual API pipeline completes three recovery cycles beyond `maxReservations=2`, with both purpose charges accumulated exactly. Full native restart verifies exact duplicate/conflicting/never-completed certificates, and the incremental D1 upgrade preserves unknown-expiry evidence.

Retained red evidence includes the original pipeline slot leak / missing-completion tests, `/private/tmp/tocyn-64-compaction-metadata-storage.log` (native 131,174-byte value rejected at 131,072), `/private/tmp/tocyn-64-compaction-final-native.log` (87/88; required 64-scope case failed with excessive headroom), and digest/packing intermediate failures. The total-two/total-one prevention cases first failed against unprotected intake (`slot-headroom-red.log`, 0/2); their corrected native cases pass. Required scenarios were preserved while fixes were made. The 64-scope cache assertions pass with packed allocation references and the explicitly isolated total65 fixture; it records its bytes in the final native log.

## Accepted-main refresh

Refreshed onto accepted `origin/main` `ed484a56051107cea9c0f4d73b9b975a02d69fd8` (includes #194 and #193). Three ancestry/add-add conflicts were limited to the API test, recovery service and closure repository. Their accepted-main versions were byte-identical to pre-compaction parent `a838cb7`; retaining the tested compaction versions preserved every accepted change. The server tree was byte-identical to `87039fc` at merge, the four focused closure/restart/upgrade cases passed, and accepted 0040 remained byte-identical. The later slot correction is validated by the final 91-test package above. Local commits are unsigned; root owns the signed PR integration and exact-revision CI.

## Remaining limits

This remains an API closure increment. Customer/staff closure recovery, provider completion, generic uncertain-history reclamation, all-path resource costing, scheduler/background cleanup, production migration/runtime clearance and full #64 acceptance remain open. An idle tenant may retain expired D1 closure rows until later successful recovery performs the bounded cleanup. Failed recovery and uncertified/uncertain grants intentionally retain their reservations and charges. Historically already-saturated total-N states also remain charged/fail-closed; the new intake guard prevents new saturation, but cannot manufacture a recovery slot for legacy accepted saturation. Any explicit owner-capacity remediation remains separate; no limit was raised here. Sustained unexpired history eventually fails closed at the measured metadata/headroom bound. Root must preserve the refreshed #194 code and integrate remaining #195/#189 work without dropping customer/staff methods, validate that exact integrated revision, and synchronize the issue/Project receipt.
