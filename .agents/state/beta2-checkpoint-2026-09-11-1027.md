# Beta.2 coordinating checkpoint — 11 September 2026, 10:27 BST

Accepted main: `f5f19f28de4eb6e9df08920270e13c0ee9445c7f`, from separately accepted branding PR #187 after #191. Owner checkout and ports remain untouched. Full #140 remains incomplete; no owner permission is pending. The 09:45 checkpoint preserves earlier evidence.

## Integration

- Recovery PR #194: old head `a838cb7` passed CI `34582825330` and CodeQL `34582823135`. Reviewed and tested merge tree: `e752b36fbc4915f70c94b02c54caed6642e9cbfb`; merge candidate: `51303714574a7978d06aa3e3e60150232d6eb637`. Main then advanced externally, so no merge or bypass occurred. Current head `6e0440a4d5175bc698a0326ea2b54d441962d026` includes branding; CI `34584188793` is live. Existing watch handle 85459 remains live. An observation timeout is not a reason to restart it.
- Customer PR #195 is a draft stacked on #194. Application merge `84fa092` includes branding. Earlier combined revision `b75cf59` passed 90/90 native tests, full server/API/customer runtime types and scoped lint. Branding did not change the server implementation. Root must retarget main after #194 acceptance and verify required exact-revision checks, threads and signing before integration. Issue #64 receipt: 5632277058. No full #64 acceptance is claimed.
- API whole-grant recovery and staff/customer admission provide partial coverage. Sustained grant history and other metered paths remain required.

## Actual workers and ownership

- `collaboration70_typing`, Terra/high: collaboration worktree and exclusive GUI ownership. Correct the multi-page stale-review defect: ascending conversation pagination must not permit rebasing before later material is shown. Existing revision-bracketing and 45 focused tests are partial evidence. Actual VoiceOver cursor commands work.
- `collision70_review`, Terra/high: isolated `codex/64-certified-compaction`. Implement durable retained charges, recovery idempotency and bounded history using existing migration 0040. Preserve uncertain and stock charges; no slot-reset shortcut or duplicate lifecycle journal.
- `budget64_storage`, Terra/high: isolated `codex/64-storage-admission`. Own attachment upload/download handler sections and storage admission tests. Root integrates these separately from #70's composer sections. This does not complete #64.
- `permissions79_remaining`, Terra/medium: completed read-only map. #79 is already closed/Done/100 through PR #169, merge `12f4a5bc`, receipt 5621537019. Do not reopen or repeat it. #137 routing remains open behind #130; #73 and #162 are accepted.
- `recovery64_acceptance`, Astra/high: completed narrow bundle and fixture diagnosis; experimental edits were restored. The Node 22 repository gzip level 9 gate passed on `1a9de9e`: total JS 569159/570000, initial JS 100896/135000, CSS 15603/16000. The earlier 570181 figure used gzip level 6 and was not the actual gate. Recheck after branding and pagination changes.

## Fixture diagnosis

Native testing proved direct off-to-combined activation succeeds with a fresh window (201). The expired 60-second fixture window correctly returns 429 with zero grants/articles. A 30-minute synthetic window configured before admission succeeds, with every resource envelope within its limit. Use that human-paced window without changing ceilings, the recovery partition or the 60-second grant lifetime. No application mode defect or intermediate-mode requirement was found. Full accessibility acceptance remains pending.

## Next actions and boundaries

Finish #194 integration, retarget and validate #195, then integrate. Accept #70 only with pagination, collision and actual accessibility evidence. Continue compaction and storage work. #130 depends on #129/#136/#73/full #64; #137 depends on #73/#79/#162/#130. Keep #140 open and preserve all acceptance criteria.

Reference forecast remains 9 December 2026; no shorter wall-clock estimate is evidenced. Next full human update is due at 10:39 BST. No Copilot review, paid capacity, remote resources, production action or additional release is authorized or used here. Workers are native dedicated Codex; no independent Work allowance is claimed.
