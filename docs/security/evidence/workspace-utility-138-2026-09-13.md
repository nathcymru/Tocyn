# Workspace utility actions: bounded browser evidence

Recorded 13 September 2026 for issue #138, from parent revision `e4ce508589d14a00337c20df2505172da87af727` with the accompanying action-bar changes present in the working tree. This is partial acceptance evidence; #128 workspace integration and actual screen-reader acceptance remain outstanding.

The `TicketActionBar.tsx` source tested has SHA-256 `52c7507ed8e096bb6630e44093d5f1b1e8520fa9901dbc48992bcfa8a26ff797`. The correction provides visible status and a selectable-reference fallback when the Clipboard API is unavailable. Switching the reference clears the previous dialog/status, and an old asynchronous clipboard result cannot announce success against the new reference.

## Executed evidence

Four focused `TicketActionBar.test.tsx` tests passed, including new missing-clipboard and pending-copy/ticket-switch regressions. The dashboard TypeScript check passed.

A disposable Vite fixture imported the actual component and shared dialog, with three synthetic utility actions. Existing Helium Chromium `152.0.7977.64` ran headlessly through Playwright; no browser or dependencies were installed. All HTTP requests outside the local fixture origin were blocked. No backend or real ticket data was used.

The browser checks passed at `2026-09-13T10:13:19Z`:

- Actual Tab/Enter navigation reached Copy, More, and View ticket reference in order.
- Opening the dialog focused Close; forward and reverse Tab remained in the modal, and Escape returned focus to View ticket reference.
- The guidance link was keyboard reachable and retained `noopener noreferrer`.
- Missing Clipboard API and a rejected clipboard promise both displayed the fallback; a successful retry copied the synthetic reference and announced success.
- A ticket-reference change cleared copied status and the open dialog; a late copy result did not announce against the next ticket.
- Denied actions were disabled with associated explanation text, and the denied guidance action rendered no link.
- No page runtime errors were observed.

The first browser launch could not find the Playwright browser cache. The installed Helium executable supplied the browser. An initial temporary-fixture routing mistake loaded the repository page instead of the component; correcting the harness to Vite's custom application mode resolved it. These were harness failures, not application passes. Both the browser and fixture server were closed after execution.

## Limits and remaining acceptance

This exercised a real browser with a synthetic component fixture, not the complete ticket workspace, production bundle or backend permission enforcement. Clipboard outcomes were simulated. Accessible names and descriptions were inspected, but no spoken VoiceOver output was observed; this does not satisfy screen-reader acceptance. Existing server-authority and unsafe-link evidence must be combined with future integrated #128 workspace and assistive-technology checks before #138 closes. No B2 or production readiness is claimed.

## Supplemental complete-page integration

The additional `TicketDetailUtilityIntegration.test.tsx` suite exercises the actual
`TicketDetailPage`, utility query hook, strict manifest parser and action bar under
React Router/Query providers. Synthetic HTTP responses replace external services;
this is deterministic integration evidence, not a real-backend or screen-reader
acceptance claim. Three tests verify:

- A utility HTTP 503 keeps the current conversation visible, removes utility
  commands, and restores them only after the explicit Retry ticket actions request.
- Navigation to a second ticket rejects a manifest naming the previous ticket;
  retry renders the second ticket's server-declared denial, disables its commands
  and provides explanations without a guidance link.
- Navigation while the reference dialog and asynchronous copy are active unmounts
  the previous dialog, discards its late success status, and opens the second
  ticket's correct reference with close/focus return to its current opener.

A separate temporary loopback harness reused the existing local two-tenant fixture,
real local authentication/MFA and guarded beta policy. The production dashboard
was built from `1ba78d698e765824039aa7795eedf83f9fcab9c3` (merged by #260).
Synthetic session values stayed in harness/browser memory and were not recorded.
Native Helium, operated through CUA, loaded the complete inbox and ticket workspace.
Copy displayed its success status; Tab reached More, Enter expanded it, and Tab
reached View ticket reference. Browser interaction then transferred to the user,
so further automated UI actions stopped. This run does not establish integrated
dialog keyboard behavior or spoken screen-reader output. The initial appearance
loading state resolved normally. Service-level unavailable and later
last-confirmed refresh notices were observed without captured HTTP status evidence;
they remain fixture observations, not diagnosed application defects.

The deterministic suite was rerun with the #132 preference corrections integrated
at main `72f8e0ad4997fd2c550582ef48b447c200eb1534`. The first harness run failed
because a setup hook returned a mock function that Vitest invoked as cleanup;
correcting the hook resolved that harness error. Dashboard TypeScript validation
and the three integration tests passed. The production build emitted existing
future Vite config-loader and large-chunk warnings.

Remaining #138 acceptance still includes #128 dependency acceptance and an
uncontended integrated keyboard/assistive-technology session. These tests support
partial progress and do not close #138 or declare Beta.2 ready.
