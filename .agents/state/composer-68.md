# #68 composer continuation

## Accepted completion — 11 September 2026

PR #183 merged at 2026-09-11T06:48:43Z as accepted signed tree `8987f7c1b63349efe78ce1ddeedd5530d7e5c779`. Required CI `34570775353` and CodeQL `34570773097` passed. Acceptance covers 261 dashboard, 67 portal and 557 server units; production composer/drafts/SLA/support-state browser passes; and actual VoiceOver evidence. #68 is complete at 100%; actual completion is 2026-09-11, remaining planning effort is 0h, and variance is −129 Monday–Saturday working days against the immutable 2027-02-09 baseline target. Maintainer receipt: https://github.com/nathcymru/Tocyn/issues/68#issuecomment-5630628007.

Evidence includes actual Safari/VoiceOver composition and internal-note submission, five combined production browser scenarios, prior full dashboard/server/portal suites and real tenant/format runtime tests. See `docs/security/evidence/composer-68-voiceover-2026-09-11.md` and `composer-68-build-layout-2026-09-11.md`. The static-entry chunk ownership correction preserved full editor/language support and passed all 16 controlled CI resource/timing checks at tested merge `50d15d9b39795952101c05e5218589b1684f1a5d` (PR head `d08809f`).

That CI run then caught a transient duplicate pending/saved attachment row in the strict draft browser test. Promotion now uses one synchronous React commit across the external draft store and local pending state. The strict browser assertion is unchanged. The per-commit unit invariant passes (39 workflow tests), and the rebuilt composer/draft browser suite passes 3/3. The unit environment did not reproduce the original race; CI supplied the original failure evidence. New artifact: 567,075 total / 99,196 initial gzip JavaScript, unchanged ceilings. Final CI must validate this correction before integration.

### Scope correction: extension contracts and downstream consumers

Older coordinator status paragraphs incorrectly treated concrete saved-response/AI providers as new #68 prerequisites. The approved issue requires KB/saved-response **insertion hooks** and a same-draft integration surface. Those hooks are present, bounded in their displayed suggestions and tested for actual insertion/callback behavior. #69 owns saved responses and depends on #68; #76 owns summaries; #77 owns transform providers and also depends on #68. They remain outstanding under their own accepted scope. Do not create a circular dependency or claim their provider features are implemented.

Approved evidence: `docs/planning/post-beta-2026-09-10/issue-bodies/68.md` expanded scope; COMP-08 / UX-F03-L014 and UX-F07-L073 for #69; COMP-17–19 / UX-F03-L023–025 for #76/#77; UX-F09-L278 retires the old AI card only after #68/#77 parity. COMP-16 remains shared with contextual support ownership; #68 does not claim a completed contextual retrieval provider. The beta.2 #140 critical workspace/context, AI-off, full SLA and routing gates remain intact.

Future concrete KB insertion must authorize the current ticket/group and derive public Answer versus internal SOP visibility on the server. Existing tenant-wide knowledge endpoints are not a substitute for that context boundary. Preserve this integration warning for the owning future work; it is not a fabricated #68 blocker.

## Historical continuation — status superseded by the current candidate above

Current status: partial implementation; the dated continuation sections supersede earlier capability-status statements. Historical articles remain literal text.

Root owns integration; native Terra/medium implemented bounded frontend work in `/private/tmp/tocyn-beta2-68`, based on accepted #66 application. Server-backed #129 drafts, attachment queue/retry, explicit public/internal mode, send CAS/cleanup and navigation guard remain the same controller.

Implemented: controlled Markdown editor/toolbar, sanitized Markdown preview/conversation rendering, bounded explicit insert choices, scoped cursor restore, ordinary disclosures with Escape/focus return, read-only mutation fences, JPEG/PNG/GIF/WebP drop/paste into existing authenticated upload queue (10MiB each), local rejected-file feedback and existing upload retry. Sender Markdown images do not create network requests; links reject unsafe protocols and isolate opener. No external preview fetch or automatic send.

Validation: native worker ran full dashboard34files/215tests, dashboard production build, focused paste/drop/failure/readonly/keyboard/two-instance/XSS tests. Its actual strict-CSP browser check reported no application violations; a deliberately injected style was rejected. MDEditor uses CSSOM inline property assignments (10 attributes observed), not generated style text; full integrated browser/contrast/AT evidence still required. Root reviewed mutations and found/fixed through worker missing readonly enforcement, invalid ARIA menu roles and global element lookup. No new dependency/install/Copilot/paid/remote work.

Remaining #68 acceptance: actual slash/emoji autocomplete (current buttons are insertion foundation), full code highlighting, authenticated inline-image rendering contract (current images are attachments), server-derived channel recipients/formats/attachments/limits, KB/saved-response hooks, AI transforms beyond existing suggestion insertion, final channel output/recovery/tenant/browser/AT/resource evidence. Keep issue open; this PR Progresses #68 only. Root must refresh onto accepted66, retain required CI and integrate waiting/SLA surfaces without overlapping worker writes. No beta.2 readiness claim.

## Autocomplete and admission continuation

Actual bounded slash/emoji autocomplete now uses native multiline textbox semantics, aria-autocomplete/controls/activedescendant, listbox options and Arrow/Enter/Escape navigation. Optional typed knowledge/saved-response inputs and insertion callbacks are present without inventing a data provider. Root added synchronous pending-attachment state and current controller snapshots to enforce the ten-upload ceiling across same-turn drops, plus a regression test proving two batches of eight admit exactly ten. Full integrated dashboard34files/217tests pass. W3C ARIA-in-HTML does not permit a combobox override on textarea; the temporary role experiment was removed and existing textbox behavior retained. These changes supersede the earlier explicit-button foundation status. Real KB/saved-response providers, full highlighted output/channel contract/authenticated inline-image rendering and final browser/AT/resource acceptance remain.

## Local continuation — 11 September 2026

Root and Terra workers added fenced-code highlighting to the safe composer preview and explicit authenticated inline attachment preview. Allowed raster bodies are bounded to 10MiB, one fetch/retained blob, stale-auth/ticket responses are dropped, old URLs are revoked, button focus persists through show/hide and decode errors support retry. No sender-controlled remote image request is created. Existing canonical articles remain literal text until an explicit versioned article format and channel renderer are implemented; historical records must not be silently reinterpreted as Markdown.

Preview component/page focused tests passed44; prior full dashboard232 passed. Final combined checks remain. Root retained pinned build-only Terser5.51.2 (five normal passes) plus workspace-hook grouping to meet unchanged byte limits without removing languages or changing browser target. Preliminary combined artifact before final lifecycle corrections:569062 allJS/114098initial/15585CSS. Clean final candidate must be measured again; no readiness claim.

Rejected probes: defaultOxc572406; esbuild585314; explicit equivalent all-language entrypoint574487; broadcontrols grouping571532 with initial135929 overcap; generic minSize grouping made no difference. These were reverted. Supported multipassminification+sharedhook grouping was measured; no metered/API/production work. Readable channel outputs, versioned new-article format, real KB/saved-response insertion providers and final browser/AT acceptance remain under#68. Server-owned current reply-capability contract is being implemented separately in this same worktree; it does not establish Markdown delivery support.

## Integration checkpoint — 11 September, 05:46 BST

Current channel contract now lives in pure shared types and a tenant/group/MFA guarded dashboard GET; exact local allowlist preserves stopped-write read access and rejects nonexistent v1/customer variants. Attachment limits use the same shared constants in server upload/reference validation. Format explicitly remains stored_text: future versioning/rendering is separate outstanding acceptance. The worker initially edited the owner checkout incorrectly; root preserved its exact patch, merged it into this worktree, and restored only verified agent-owned edits. Owner checkout read-back is clean. Validation was repeated here (HEAD874daab base):33 server tests, server and runtime types, actual two-tenant runtime1/1; exact-route regression2/2. Full dashboard235 tests passed after preview lifetime and literal-article corrections. CI now registers the runtime boundary test. Final clean build/performance/browser checks remain before integration. Zero Copilot reviews.


## Versioned article and draft integration — 11 September 2026, 06:24 BST

This supersedes stored_text/format-pending statements above. Migration0035 persists explicit `plain` or `markdown-v1`; missing historical format remains plain. Fresh composer drafts use Markdown, restored legacy drafts remain plain until explicit operator selection. Draft acknowledgements must match submitted format before clearing unsaved state. The server-owned current capability now provides accepted formats, recipient/delivery semantics and shared attachment limits; unavailable/malformed capability blocks send with retry. Operator conversation renders only declared Markdown; customer projection renders safe text without a new Markdown client pipeline. API/customer writes remain plain-only.

Bounded server email rendering escapes raw HTML and permits a small explicit Markdown subset, retains readable text and rejects internal delivery. Review fixed literal identifier corruption and parser forward-progress cases; parsing is bounded before work. No original article text or historical Question records are silently converted. No provider activation.

Node22 validation: server544tests, dashboard249tests, portal62tests; registered tenant/format actual runtime6tests; all14server/runtime typechecks; server and portal lint; allclient production builds. New-format dashboard artifact566543gzipJS/114622initial/15528CSS is preliminary until clean revision timing proof. Pagination test now identifies its specific live region while retaining the status-role assertion; no feature failure suppressed.

Read-only Terra inspection found no supported uiw lighter entrypoint preserving full editor grammar/highlighting: nohighlight drops highlighting, common limits grammars. Retain current supported entrypoint. Root preserved original mixed line endings on untouched TicketDetail lines and removed only its incidental generated Vite config changes.

Remaining: combined accepted SLA refresh, exact-revision CI, real composer workflow/keyboard/VoiceOver/contrast, clean resource timings and outstanding AI transform/insertion integration acceptance. Native Terra/medium owns only a new browser acceptance script; root owns integration. PR183 remains partial and #68 open. Zero Copilot or remote actions.
