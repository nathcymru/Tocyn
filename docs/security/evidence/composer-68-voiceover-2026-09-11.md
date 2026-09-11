# Composer Safari and VoiceOver evidence — 11 September 2026

Observed06:34–06:44BST on the owner Mac, using production application revision `1f67bb8` (accepted SLA integrated, safe composer preview controls). Dashboard index SHA256 `bcbd38e4ee0af5786bc61594a3e521642beadc01cf1c8ce22ccfca1876c34208`. Disposable two-tenant Miniflare, local captured authentication, real operator MFA and ephemeral loopback served the application. No external provider or deployment was activated.

- VoiceOver read the named Markdown format selector, composer instructions, toolbar and Reply message text area. Extra uiw Edit/Live/Preview controls were absent after the safe-renderer correction.
- Actual keyboard `/g` produced spoken “/Greeting selected (1 of 1)”; Return inserted the greeting. Keyboard emoji trigger produced “:check: ✅ selected (1 of 1)”; Return inserted the check. Safari AX read-back verified values and suggestion state.
- VoiceOver announced unsaved changes and “Draft saved.” during composition. Navigating to Internal Note and activating it changed the spoken channel description to “Internal note. No email is sent.”
- Typed a synthetic note, navigated to Add Note and activated it. Safari showed “Internal note added.”, the persisted internal note and cleared draft; VoiceOver subsequently read the saved note text. The completion message was visually/AX verified; no automatic spoken completion announcement is claimed.
- VoiceOver discovered Safe preview as a named collapsed summary. The production browser test separately validates preview rendering, keyboard interaction and contrast; this receipt does not claim a manually spoken code-preview or image-retry result.

## Limits and cleanup

Focus must return to Safari with a short activation delay. A traversal that remained in Codex was excluded from Tocyn evidence; a keyboard attempt that omitted the colon was corrected with physical colon input and verified before counting emoji acceptance. This avoids treating automation artifacts as product results.

The fixture has no websocket upgrade bridge and shows Disconnected; realtime acceptance is separate. Test window closed, fixture stopped and loopback listeners checked. Owner servers and enabled VoiceOver are preserved. This is focused#68 evidence, not full issue or beta.2 acceptance.
