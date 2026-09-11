# SLA Safari and VoiceOver evidence — 11 September 2026

Observed approximately05:46–05:54 BST on the owner Mac, against PR#180 application revision `a24d2d00ee03a313b0fe84fff3a1416cdc9ce529` plus the dashboard canonical-favicon correction. Production dashboard artifact SHA256 `fc9ff8c674ff5358b6e6c808cfa5b15dbfae9b4a4611f97f0a191cfac7331f31`. A disposable two-tenant Miniflare fixture used ephemeral loopback ports, synthetic operator MFA and customer login via locally captured authentication. No provider or remote deployment resource was activated.

## Observations

- Mac keyboard input was typed and read back in Safari, then cleared without submitting a search. Authorized VoiceOver navigation was driven through its AppleScript cursor API; ordinary Tab/Space keys were also used.
- VoiceOver read response30/resolution90 minute fields and both named reopen-policy controls. Save was activated; Safari showed revision3 and saved feedback. VoiceOver navigation read “Saved. This policy applies only to clocks started after this revision.” This establishes discoverable spoken feedback, not a captured automatic live announcement.
- In the operator ticket, VoiceOver read both paused clocks with30/90 working minutes remaining and “Handler: Synthetic operatorA”. The support-state form named its controls and explained the staff-only facts.
- Open was selected through the native state menu. During this sequence Safari activation waited while the native menu was open; arrow/Return keys closed it. A subsequent Save attempt encountered a revision conflict after Open had already persisted. VoiceOver read the retained-input conflict and Refresh control. Refresh recovered the current Open state. This does not claim the sequence was a clean single submission or a deliberately injected concurrency test; separate browser tests prove controlled CAS conflict handling.
- After recovery, VoiceOver read running response/resolution deadlines06:20/07:20. The customer portal read the same deadlines and “Responsible handler: Synthetic operatorA”. Safari accessibility read-back contained no private waiting reason, next action or internal state label.

## Limits and cleanup

This is focused local assistive-technology evidence for#73, not full#140 or production clearance. Automated two-tenant tests separately establish authorization and failure behavior. The temporary helper and test window were removed from the worktree; both ephemeral listener ports were checked closed. VoiceOver remains enabled and existing owner servers were preserved.

Subsequent contrast-only correction: the final browser matrix found and fixed dark breach text. Interaction and spoken labels are unchanged; rendered browser measurements now evidence9.41:1 darkbreach and11.71:1 darkpaused/on-track. The actualVoiceOver receipt above remains scoped to its stated artifact, rather than being relabelled as a fresh AT run.
