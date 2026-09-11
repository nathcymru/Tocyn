# #70 collaboration delivery

## Current partial candidate — 11 September 2026

Root is integration/acceptance owner. Native Terra/high implemented frontend/protocol work in `codex/70-private-collaboration`, based on accepted #68 main `8987f7c1b63349efe78ce1ddeedd5530d7e5c779`. Application candidate `2f06009b9aa1de1de640cd78875ac912133a0bb9` is not full #70 acceptance.

One dashboard CollaborationProvider reuses the existing realtime connection for Layout and ticket detail. Bounded versioned typing hints carry ticket/revision/active only; the server must derive identity and tenant. Received hints are capped at 128 and six seconds, cleared across hidden tabs, reconnect/session changes and explicit completion/discard/exit. Stable callbacks prevent unrelated broadcasts from triggering location cleanup. Static readable text avoids unsolicited announcements; cognitive/interruption preference integration remains with #132/#70.

Validation: dashboard 39 files/265 tests, typecheck and production build passed. Root rebuilt with the CI manifest on Node22.19.0: 568,328 total and 100,901 initial gzip JavaScript bytes, below unchanged 570,000/135,000 ceilings. This is resource size evidence, not final controlled browser timing or assistive-technology acceptance. Full/prod dependency audits reported zero known vulnerabilities. Existing local Terser was linked only into this worktree; no paid/remote work.

## Remaining implementation and integration

- Server NotificationDO must authenticate/authorize current sender and every recipient for the current ticket/group, derive actor/session/expiry, rate-bound messages, and preserve revocation/reconnect/no-replay behavior. #64's realtime bounds are being integrated first; do not overwrite them.
- Reply precondition must use existing draft `baseConversationRevision` and canonical `conversation_events`, atomically rejecting material new content before mutation/audit/email. Current audit kinds include `ticket.intake` and `message.reply`; do not confuse them with automation event names. Define the material-event comparison explicitly, not a second revision store.
- Conflict must retain the draft and require review, without automatic resend. Completed receipt replay precedes a new precondition check because the original successful reply advances the conversation.
- Internal mentions must create authorized durable activity through staged #133 backend work; avoid a whole-issue #70/#133 cycle.
- Finish two-session actual runtime/browser, negative tenant/group/revocation, failure/recovery, bounded resource, keyboard/VoiceOver/contrast and #132 preference integration evidence.

No presence lock or permission grant, autonomous send, customer disclosure, provider activation or beta.2 readiness is claimed. #140 remains the final gate. Project start receipt: https://github.com/nathcymru/Tocyn/issues/70#issuecomment-5630649116. Root owns GitHub/Project completion and forecasts. Zero Copilot requests.
