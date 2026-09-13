# Issue #132 focus preference recovery evidence

Bounded worktree `/Users/ty/Documents/Tocyn-worktrees/preferences-132-focus`, based on reviewed text-scale head `6dd13e80ec9c9e4532423e93b634f241c2c5fe6b`. This branch has tests/evidence only; no product behavior change. Coordinator retains scope, integration/signing and merge ownership.

Added real Layout + OperatorThemeProvider + OperatorPreferencesControl synthetic coverage. Keyboard toggling Focus mode updates its hook state; a rejected save keeps the choice and visible Retry; keyboard retry saves against the correct revision without remounting Workspace. Disconnected status, explanatory text and keyboard Force Reconnect remain reachable afterward, including focus return. API responses are synthetic and JSDOM focus rectangles are stubbed: no actual browser, provider or screen-reader acceptance is claimed.

Sixteen Layout tests and dashboard TypeScript passed. The fixture now retains the real ApiError class for failure handling. The test waits for initial account-popover focus before operating its checkbox. An existing activity-navigation assertion was narrowed to the level-one route heading because the still-open activity panel also has a heading; no product behavior was changed.

Important limit: inspected current focusMode consumption only writes the root dataset. No corresponding CSS/component chrome suppression was found. These recovery checks do not establish that Focus mode suppresses noncritical chrome, and #132 remains incomplete. Approved requirement: suppress noncritical chrome without hiding delivery/state/error/public-vs-internal information. Coordinator must select a meaningful product treatment before full acceptance.

## Approved narrow Focus treatment

Coordinator selected only the decorative, already aria-hidden global-search shortcut hint. Its new data marker is hidden by a root-scoped Focus selector; full accessible shortcut instructions and every search/navigation/activity/account/connection control are preserved. No brand or navigation removal. This supersedes the earlier no-consumer observation for this narrow treatment; it does not establish comprehensive Focus-mode acceptance.

Twenty-seven focused Layout/preference tests and dashboard TypeScript passed. The standalone actual-CSS Chromium test also passes default/Focus-on/Focus-off visibility for the actual marked Layout span and preserves representative labels/headings/buttons/selects/text. Both 16px/20px scale/reset scenarios remain passing. Evidence includes current CSS/shared/Layout hashes. Existing preview/fixture and native browser were not controlled; isolated headless sessions closed.

Delivery consolidates these changes into existing PR265, not a second PR. Latest main b84453feb993e93fd16d3698421f82d91d5e5639 has no intervening changes to this slice's source/tests. Coordinator review precedes the signed branch refresh. Full workspace200%zoom, delivery/public-internal critical-state matrix and spoken accessibility remain open.


Final integration at main b84453fe passed all 318 dashboard tests in 46 files. The independently reported pagination-keyboard timing failure was addressed by waiting for the disclosure's scheduled initial Refresh focus before moving to Load more; the level-one route heading selector avoids matching the open Activity heading. Both are test corrections, not application behavior changes. After the timing assertion change, all 16 Layout tests and dashboard TypeScript passed. Exact refreshed-head CI remains required.

Signed freshness refresh onto8d287c4c includes only disjoint #128 tests/evidence from PR266. Existing product verification remains applicable; no repeated local test run, new exact-head CI required.

CI on24e3d177 exposed a test focus-return race after closing the account disclosure. The test now waits for the documented account-trigger focus return before focusing/opening disconnected controls. All16Layout tests pass after this test-only correction; refreshed-head CI will validate the complete suite.
