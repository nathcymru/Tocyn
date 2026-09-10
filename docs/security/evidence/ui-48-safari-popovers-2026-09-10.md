# #48 Safari popover/navigation evidence — 10 September 2026

Tested Layout.tsx Git blob: `343195d9aeaa41ea23e32d7595d98422c0506cf1`. Native Safari/Computer Use, local synthetic app127.0.0.1:5190 and fixture8899, observed18:41BST. No production/provider or authentication-setting actions.

- Desktop account: initial Security Profile focus; Escape returns to Account options. Return on Security Profile navigates and focuses Workspace.
- Desktop connection: initial Force Reconnect focus; Escape returns to Disconnected. Connection was disconnected; no realtime health or successful reconnect claimed.
- Responsive390×844: navigation initially focuses Close navigation. Shift+Tab wraps to Account options; Tab wraps to Close navigation.
- Nested account: initial Security Profile focus. First Escape closes only account content and returns to Account options; second closes navigation and returns to Open navigation.
- Screenshot inspection found absolute-positioned account content clipped by the narrow mobile navigation rail. Fixed-position strategy corrected it; repeat screenshot showed the complete popover and both actions visible, with nested dismissal preserved.
- Responsive mode exited; normal Safari viewport restored.

Added fixed-position/nested-Escape regression. Dashboard119tests/21files and TypeScript/build pass; existing bundle warning remains. Full spoken VoiceOver, other browsers/viewports/themes, measured contrast/target sizes, remaining controls and performance budgets remain open. Safari accessibility-tree focus is not a spoken screen-reader pass. No VoiceOver-control setting changed for this test. This is partial #48 evidence, not beta.2 acceptance.
