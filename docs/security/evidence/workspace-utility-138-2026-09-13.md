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
