# Core workflow accessibility — partial #21 implementation

This slice covers the existing dashboard password/MFA pages and portal
login/verification, ticket creation, history and reply pages. It adds associated
labels, selected login-method state, input completion hints, inline error
associations and live progress/status semantics. Pending portal login requests
retain their submitted email and login method through read-only inputs and
guarded, focusable controls. When login success replaces the form, focus moves to
the success heading. Styling remains static CSS.

Ticket creation uses a named native modal dialog with initial subject focus and
focus return to its opener. Errors retain the draft inside the dialog. Pending
creation prevents repeated submission and keeps the dialog open until the request
settles. History has a named, keyboard-focusable scroll region; reply, attachment
download and selected-file removal controls have accessible names. Removal
returns focus to the attachment button. Reply progress and errors remain inline,
and unavailable controls retain native focus with guarded `aria-disabled` states.

A successful reply followed by a failed history refresh is announced as a saved
reply with an explicit read retry. It does not ask the customer to resend. Failed
initial list/detail reads and attachment downloads also expose explicit recovery.
The accepted #93 bounded pagination and its focus-preserving control remain in
place. The newest read owns success, failure and loading indicators, including
when polling or a visibility refresh overlaps pagination. Superseded reads cannot
overwrite current feedback or leave the pagination control busy.

Reply text is required before any attachment upload. An upload attempt remains
pending until every sibling settles; successful upload references are retained in
the current draft and reused if another upload or the message write fails. Removing
a file drops its retained reference; successful message submission clears the
cache. These references stay within the mounted conversation and are not persisted.

Credential submission, password-to-MFA navigation, single-use magic-link handling,
OTP challenge state and authenticated navigation retain their existing contracts.
No API Worker or authentication-store changes are included in the accessibility
slice. Operator navigation and queue controls are included; the accepted operator
detail, query identity and realtime invalidation behavior are preserved. The independent #61 UTC timestamp changes must be preserved when
integrating its portal pages, together with its session boundary and #62's
navigation tests.

## Executable evidence

From the repository root with Node 22:

```sh
npm run test --workspace=apps/dashboard
npm run test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm run build --workspace=apps/dashboard
npm run build --workspace=apps/portal
```

At this source checkpoint, all 47 dashboard cases and all 40 portal cases pass on the temporary integrated
candidate. Its baseline combined 34 dashboard and 40 portal cases; 13 additional
operator accessibility/recovery cases pass.
These include four dashboard login cases, six portal login accessibility cases,
eleven portal conversation accessibility/recovery cases, four overlapping-read
regressions and existing login,
magic-link, OTP and #93 pagination regressions. Both frontend builds and portal
lint pass. Component checks assert names, selected states, associated errors,
pending feedback, focusable controls, retained drafts and explicit recovery.

The dialog tests supply JSDOM's missing open/close methods; they do not simulate
native browser focus containment. None of these component tests proves actual
browser keyboard behavior, screen-reader speech or final computed contrast.

No live API/provider requests, fixture rows or R2 objects are created by these
component tests. Mock request assertions show that repeated pending activation
adds no second authentication, create or upload request; attachment upload failure
retains the draft and adds no message write; and recovery after a saved reply's
read failure adds no second message write. Partial upload failure waits for the remaining sibling and retries only the failed
file (three uploads for two files across two attempts); a rejected message write
reuses its completed upload. Attachment-only submission performs zero upload or
message calls. List/detail read retries and download retries are explicit. This is component resource evidence, not a live runtime
measurement.

## Remaining acceptance

Issue #21 remains partial. The temporary candidate combines the frozen #61 and
#62 source with #21 changes; final acceptance must refresh onto their signed
merges, preserve their navigation tests, then check the
whole included login/session, create/history/reply, queue/detail/composer,
assignment/state, error/dialog and required security-configuration journey.

Actual browser keyboard/focus, computed state-specific contrast and actual
screen-reader observations are still required. Exercise native dialog Tab and
Shift-Tab containment, Escape and Cancel focus return, pending/error recovery,
reply/attachment names and announcements, history scrolling and pagination. A
live region in DOM/AX is not proof that a reader announced it. The separate #93
new-pagination reader criterion also remains open until evidenced; it cannot be
closed by deferring it to #21. No OS permission or VoiceOver setting was changed.

Before final acceptance, exercise successful and failed login/MFA/OTP, expired or
revoked sessions, captured-mail failure, and two-tenant isolation on the integrated
local revision. Record actual announcement/focus outcomes, resource counters and
recovery behavior without credentials or message contents. Existing broad
workflow, production and beta gates remain applicable.

## Integrated operator controls

The global search, account, connection and row-action controls now have accessible
names and disclosure state. Escape returns focus to the disclosure trigger. Mobile
navigation reuses the existing destinations in a named native modal dialog, keeping
closed mobile links out of the keyboard path; cancellation returns focus to its
trigger and destination selection focuses the workspace. Ticket notifications use
native open/dismiss controls and retain a focused notification past its timeout.

Ticket creation preserves its submitted draft and focus while pending. Feed retry
keeps its focused control mounted until the read settles and focuses recovered
results. Pagination keeps previous data with explicit loading feedback until the
next page arrives, without changing query identity or the authentication boundary.
Failed pagination focuses the explicit retry; clipboard failure leaves the visible
reference available. Required MFA setup has a guarded retry and ready announcement;
effect replay shares one setup request, and pending confirmation retains its code.

These are component and build results. Native mobile/create dialog containment,
actual speech, and computed state-specific contrast await browser/reader acceptance.
Tests assert one pending create/read/setup request and no duplicate confirmation;
no live provider, credential, or message data is part of their output.

## Initial integrated browser observations

The temporary candidate's portal login success heading, create Subject focus,
Escape/trigger return, create feedback, named focusable history and successful
reply status/action focus were observed in the local browser. At the native modal
Tab/Shift-Tab boundary, focus reached browser chrome without an observed background
page control; this is not a complete keyboard-cycle or screen-reader proof.

The browser exposed a blank reference for records without a ticket number. Portal
list/detail now use the actual UUID in that case, matching the operator view; no
number allocation is introduced. Component cases exercise both UUID and allocated
prefixed references. All 42 portal tests, portal lint and build pass after this fix.

For the same running local pagination fixture, 50 explicitly synthetic historical
articles were added to a conversation with two admitted messages. The resulting
52 rows are fixture history, not 52 admitted writes. Ticket, mutation and upload
attempt counters were identical before and after this fixture setup; the runtime
was not restarted and no audit receipts were fabricated.

Mandatory enrollment acceptance remains blocked by an observed route mismatch:
a normally issued unenrolled operator login returned an MFA challenge, but setup
rejected that challenge. This observation must be resolved and retested before
claiming the included required configuration journey works. Actual reader
acceptance remains open independently.
