# Ticket-field editor VoiceOver evidence

Observed10September2026,20:04–20:06BST. macOS27.0, Safari27.0, native VoiceOver; local candidate127.0.0.1:5190 with synthetic fixture8899. TicketFieldsPage.tsx blob560c2e971cda4f6df82a38799c341f7b072e261e; branch195b943. No field was created or changed.

Owner reconfirmed VoiceOver/AppleScript access. Spoken-output reading and VoiceOver cursor move/perform-action commands worked; System Events keystroke injection remained denied. Safari URL navigation and activation used its application scripting interface. No setting was changed by this test; leave the owner's enabled VoiceOver state intact.

Observed spoken output:

- Page: “heading level1 Custom Ticket Fields”, “Create Field button”, “Create your first field button”.
- Opening Create Field: Safari accessibility focus was Display Label. Native VoiceOver navigation then announced “Create Ticket Field web dialogue with3items”.
- Within the dialog: “Close ticket field editor button”, “Create Ticket Field form”, Display Label and Key Name as required edit text, their placeholders, the explanatory JSON-key text, “Text (Single line) Field Type collapsed pop-up button”, “Active ticked tickbox”, and “Cancel button”.
- Activating Cancel with VoiceOver returned “Create Field button Workspace main”. No submission occurred.

This is actual spoken-output and VoiceOver navigation evidence for naming, traversal and cancellation return. The browser reported empty required inputs as invalid data; no save/failure path was exercised here. It does not prove keyboard trapping, validation-error announcements, every application dialog, contrast, other viewports, full screen-reader acceptance or beta.2 readiness. Existing browser focus-containment and synthetic failure regressions remain complementary evidence, not substitutes for remaining manual cases.

Earlier AppleEvent/assistive-access failures are superseded only for the successful VoiceOver operations above. System Events keystrokes remain unavailable; no repeated permission request or bypass was attempted.
