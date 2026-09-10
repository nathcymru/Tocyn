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

## Widget startup and interaction measurements

After a fresh production widget build, `node tools/ui-browser/widget-check.mjs 20` records 20 samples per AI-on/off mode, alternating modes with a fresh browser context each time, after one excluded warmup per mode. The argument is bounded to 1–50; the default one-sample run remains a functional smoke check. Every sample also runs the retained interaction/retry assertions above.

Startup runs from navigation time origin to observing a usable launcher after two animation frames. Opening and failed-submit recovery run from captured DOM clicks to visible controls/alert after two frames. The observer includes attribute changes because opening reveals retained mounted content through `hidden`; testing child additions alone misses this state change. Measurements use a warm browser process, reduced motion and synthetic responses, not production latency or compositor paint. Raw samples and nearest-rank p50/p95/p99 are emitted. The earlier broken production bundle has no valid startup baseline; no shim, speedup comparison or global timing threshold is invented.
