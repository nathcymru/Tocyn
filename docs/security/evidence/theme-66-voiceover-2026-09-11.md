# Operator Appearance VoiceOver evidence

Observed 11 September 2026 at approximately 03:20–03:24 BST using owner-enabled VoiceOver and Safari 27.0 on a disposable loopback application fixture at 127.0.0.1:55667. The production dashboard used real local synthetic operator MFA and disposable D1 state. The fixture bootstrap supplied only its generated synthetic session to its loopback browser; no real accounts, provider messages or remote resources were used.

Source blobs: OperatorThemeProvider.tsx `e3ee4eb464e3232aa9867a27e2cb48cd7c9cee2e`; Layout.tsx `c5681851ea1e23b7fd7b525dc9aed0ff39872ee3`. These match the application adapter in candidate PR #175 (`b8a1c65`); the later CSP harness commit did not change these controls.

VoiceOver navigation announced Account options, Security Profile, the Appearance region/heading, Theme mode group, and Use system setting/Light/Dark radio buttons with selected state and position. VoiceOver activated Light; the live feedback announced “Unsaved appearance choice.” It activated Save appearance and announced “Appearance saved.” VoiceOver's documented close-menu action closed the panel and returned spoken focus to “Account options dialogue pop-up button.”

This verifies actual spoken naming, grouping, selection, saving feedback and panel-close focus return. It does not claim an Escape-keystroke test: macOS denied the separate System Events keystroke route. Direct VoiceOver scripting worked after the owner restored its availability; commands must target the VoiceOver cursor/commander objects, not the application object. Guessed commander names Press Escape and Cancel were rejected and are not supported evidence; use the documented close-menu action for this flow.

Persistence, first paint, two-tenant separation, failed-read recovery, draft continuity and strict local CSP are independently exercised by the production-dashboard/local-D1 browser harness. The test tab was closed, the owned loopback fixture was stopped, and VoiceOver remained enabled. Existing owner servers were not changed. Production deployment/headers remain under #42.
