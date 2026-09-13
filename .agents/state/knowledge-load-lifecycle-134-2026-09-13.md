# Knowledge load lifecycle — #134 / #140

Root observed the actual isolated IAB fixture on5988a1fc: an expendable draft saved, context opened with heading focus, but Knowledge stayed Loading tenant knowledge beyond20seconds. No knowledge insertion was claimed. Source review identified the request effect depending on knowledgeLoading while setting that same state: cleanup invalidated its own response handlers and left loading stuck.

The fix keys requests only to context visibility and an explicit retry generation. A loaded ref avoids repeat reads after successful loading; closing cancels the pending attempt, and reopening starts a fresh attempt. Loading/error changes do not invalidate their own handlers. Existing keyed ticket/tenant/actor/generation/role remount boundary remains unchanged; no auth/accounting/API change.

Five mounted TicketDetail/API regressions pass: delayed eligible response plus append-to-existing-draft/status/focus; rejected request and explicit successful Retry; close/reopen during pending; stale ticket response; stale identity response. With adjacent resolve-confirmation tests,9/9 pass. Dashboard TypeScript and diff checks pass. These are synthetic mounted tests, not actual post-fix browser/AT evidence. Root will perform bounded IAB insertion after accepted asset upgrade. Fixture54737 and its draft remain untouched during implementation.

The existing before-JSON completed-read settlement is preserved per root adjudication. Standing VoiceOver authority includes configure and leave enabled; Daniel was restored/off after the Eddy attachment-timeout trial, with no spoken AT acceptance. No model calls, provider activation, new native fixture or full134/140 completion claim. Baselines/progress remain unchanged.
