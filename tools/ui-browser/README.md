# Shared-control browser acceptance

Run `node tools/ui-browser/check.mjs` from the repository with Node22 and an installed Playwright/Chromium runtime resolvable by Node (for example through NODE_PATH). This tool does not install a browser. It starts an ephemeral loopback Vite fixture, blocks outside-origin browser requests and closes its server/browser in finally blocks.

The fixture imports real shared primitives. Default, radically changed static CSS, and no presentation CSS exercise native form serialization, cancelled composed events, busy controls, confirmation focus containment/return and failure recovery, manual tabs, listbox and combobox selection, splitter keyboard resizing/Home/End bounds and popover Escape dismissal. Default and radical styles also assert target heights and reduced motion. No-CSS mode asserts behavior only; it is not an accessible visual theme.

JSON output records source hashes, working-tree status, Node/browser versions and actual dimensions. This is Chromium keyboard/DOM evidence, not VoiceOver, contrast, whole-application or #66 theme acceptance. It does not satisfy those remaining gates by proxy.

The fixture waits for combobox focus restoration to settle across two animation frames before directing keyboard input to the splitter. Splitter panel definitions are stable inputs. These are composition requirements in the harness, not changes to application navigation.

## Default text contrast regressions

With the existing local synthetic operator fixture running, `node tools/ui-browser/contrast-check.mjs http://127.0.0.1:5190` verifies three previously failing text pairs in the actual dashboard. It uses only loopback HTTP, blocks other origins, obtains synthetic fixture authentication without recording tokens, and creates no saved data. The opaque sRGB test rejects unsupported transparency/image layers rather than asserting their contrast. Node22 and the installed Playwright runtime are required.

These normal text pairs use the4.5:1 threshold in [WCAG2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). This targeted regression is not a full contrast audit: placeholders, icons, focus indicators, hover states, other pages and themes remain separate acceptance.

## Built legacy widget interaction

Run `npm run build --workspace=apps/widget`, then `node tools/ui-browser/widget-check.mjs` from the root using the same Node/Playwright prerequisites. The script serves the actual IIFE build in an ephemeral loopback page, intercepts only synthetic local configuration/session/ticket responses, blocks other origins and disposes browser/server. It verifies the real legacy ShadowRoot bootstrap, open/close focus, manual keyboard tabs, preserved drafts, failed submission/retry and AI-off ticket use. Source and artifact hashes accompany results.

The negative control without EnvironmentProvider times out on ArrowRight navigation. The original library build fails before launch with an undefined Node process reference. Tests now exercise those actual browser boundaries; no Node shim is injected. This does not accept #67’s future custom-element lifecycle, styling isolation or multi-instance contract, and does not prove screen-reader/visual or backend authentication behavior.

## Ticket action compatibility popup

With the existing synthetic dashboard fixture on127.0.0.1:5190, run `node tools/ui-browser/ticket-actions-check.cjs`. It intercepts one synthetic list row, preserves the existing test-session entrypoint, blocks other origins and makes no mutation. Real Chromium checks initial link focus, the retained navigation destination, Escape return focus and outside-click dismissal. This is not backend ticket/tenant evidence or full workspace acceptance.
