# Shared-control browser acceptance

Run `node tools/ui-browser/check.mjs` from the repository with Node22 and an installed Playwright/Chromium runtime resolvable by Node (for example through NODE_PATH). This tool does not install a browser. It starts an ephemeral loopback Vite fixture, blocks outside-origin browser requests and closes its server/browser in finally blocks.

The fixture imports real shared primitives. Default, radically changed static CSS, and no presentation CSS exercise native form serialization, cancelled composed events, busy controls, confirmation focus containment/return and failure recovery, manual tabs, listbox selection and popover Escape dismissal. Default and radical styles also assert target heights and reduced motion. No-CSS mode asserts behavior only; it is not an accessible visual theme.

JSON output records source hashes, working-tree status, Node/browser versions and actual dimensions. This is Chromium keyboard/DOM evidence, not VoiceOver, contrast, whole-application, Combobox/Splitter or #66 theme acceptance. It does not satisfy those remaining gates by proxy.
