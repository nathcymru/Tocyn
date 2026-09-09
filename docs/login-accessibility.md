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

Single-use magic-link handling, OTP challenge state and authentication-store
boundaries retain their existing contracts. The required MFA configuration
correction described below changes enrollment authorization and authenticated
invalid-code responses while preserving ordinary token boundaries. Operator
navigation and queue controls are included; the accepted operator detail, query
identity, realtime invalidation, portal UTC formatting and navigation tests are
preserved on the signed #61/#62 integration base.

## Executable evidence

From the repository root with Node 22:

```sh
npm run test --workspace=apps/dashboard
npm run test --workspace=apps/portal
npm run lint --workspace=apps/portal
npm run build --workspace=apps/dashboard
npm run build --workspace=apps/portal
```

On the signed dependency integration, all 48 dashboard cases and all 53 portal
cases pass, with both frontend builds and portal lint. The initial combined
baseline had 34 dashboard and 40 portal cases; subsequent additions cover
operator controls, actual-client mandatory MFA recovery and truthful portal
references. Server checks pass 373 cases, affected typechecks and lint, the full
D1 integration suite and the four-principal tenant fixture.
These include four dashboard login cases, six portal login accessibility cases,
thirteen portal conversation accessibility/recovery cases, four overlapping-read
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

Issue #21 remains partial. The current candidate includes the signed #61/#62
merges and their navigation tests. Acceptance must cover the whole included
login/session, create/history/reply, queue/detail/composer, assignment/state,
error/dialog and required security-configuration journey. The revision-qualified
browser observations and remaining requirements are recorded below.

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

## Mandatory MFA configuration correction

The required configuration journey now accepts the normally issued enrollment
challenge only at setup/confirmation, using the existing signature, current
identity, session, tenant and invitation verifiers. Ordinary app and challenge
verification routes keep their separate audiences. Invalid codes after successful
authentication return a recoverable validation error; expired or revoked sessions
still require login. Already enabled accounts cannot repeat enrollment.

Enrollment writes check current account state and session version; confirmation
also matches the pending authenticator that was verified. Controlled SQLite
ordering covers stale and duplicate attempts without replacing the accepted
configuration. Existing session-revocation triggers invalidate the consumed
challenge, and the returned app token uses only the expected new version.

The updated actual localhost Wrangler workflow passed 84 requests over four Worker
starts in 13.36 seconds. It covers mandatory enrollment, invalid-code correction,
normal MFA verification, challenge consumption and logout revocation alongside the
existing two-tenant customer expiry and captured-delivery recovery cases. Its
resource receipt remains nine selected D1 rows, five added articles/five events,
zero final captured messages, and disposed temporary state. Auth configuration
writes are separate from those conversation counts. No external mail/provider was
used. This automated runtime result does not close browser or reader acceptance.

## Browser checkpoint and accepted dependency integration

Temporary #21 candidate b2bc593; source is not yet final signed #119 integration. Synthetic local fixture only, no external mail or Cloudflare resources. No credentials, login links, QR data or message bodies retained.

Portal: genuine capture login, create and reply passed. Native create dialog has named controls and Subject initial focus; Escape returns New Ticket focus. Tab boundary may leave document for browser chrome; no background interactive control was observed, and complete focus-cycle containment is not claimed. Actual create/reply statuses appeared, reply cleared only after success. UUID fallback renders a nonempty ticket reference.

Portal pagination: two admitted messages plus fifty historical fixture rows, with no fabricated admission/audit evidence. Enter on Load more changed 50 to 52 visible messages. Status announced text “Loaded 2 more messages. All messages are loaded.” Focus remained on All messages loaded (aria-disabled true; native disabled false). This is DOM/keyboard evidence, not actual spoken output.

Enrolled operator: normally issued password and current MFA code succeeded; MFA code field initially focused, then Workspace focused after success. Account disclosure opens expanded via Enter; Tab reaches Security Profile; Escape returns Account options and collapses it. Connection disclosure Tab reaches Force Reconnect; Enter reconnects and returns focus to collapsed Real-time trigger. Named global search Enter navigates to matching ticket results and focuses Workspace. Ticket actions Escape collapses and returns trigger focus. Copy action reports “Ticket reference copied.” Native New Ticket dialog initially focuses Subject, exposes named fields, and Escape returns New Ticket focus.

Unenrolled operator mandatory setup remains blocked pending a narrow correction and independent review. Actual screen-reader output, mobile viewport interaction, attachment selection/removal, and final exact-source regression remain pending.

Rendered portal contrast samples, calculated from computed browser colors: pagination #111827/white 17.74:1; attachment text #374151/white 10.31:1; unavailable reply control white/#2c4db8 7.34:1; focus outline #1d4ed8/white 6.70:1. These are sampled states, not a whole-UI contrast declaration. Browser windows closed and tool-local credential/OTP memory cleared before fixture teardown.

The subsequent corrected candidate is rebased onto signed #119 merge
`d394bd71d020204f75999cf1f21ad6022f478787`, which includes accepted #61. It
preserves the final operator PATCH response type, auth/query/realtime controls,
portal UTC formatting and bounded message pagination. Mandatory enrollment now
passes the automated runtime and actual client/router recovery regressions above;
its fresh browser wrong-code/correct-code acceptance was pending at that
checkpoint and is recorded separately below. No earlier provisional observation
is represented as a final source or reader proof.

## Corrected MFA browser acceptance

On exact integrated application revision
`d8dadfefb2ac5c40851c9996bb80d67d79d22b62`, the fresh guarded local fixture's
unenrolled operator completed normal password login into mandatory setup. The
code field received initial focus, the QR/text-key controls were named, and setup
readiness was visible. A guaranteed invalid code produced the associated inline
`Invalid MFA code` error while preserving setup and focus on Verify & Enable.
The correct current code from the normally issued setup reached Dashboard with
Workspace focus and no alert.

The already-enrolled operator separately completed normal password/challenge
login. An invalid code preserved the MFA form and Verify Code focus with its
associated inline error; a corrected current code reached Dashboard/Workspace.
Normal sign-out returned login. Manual input-property observations did not
establish typed-code retention, so this receipt claims retained form/setup and
successful correction only; the executable actual-client test covers retained
code state separately.

All browser tabs were closed and credential/OTP memory cleared. The supported
fixture and both frontends were stopped, the private credential handoff and
run-owned fixture directories removed, and native bind probes confirmed ports
8787/5173/5174 reusable. No additional admitted conversation writes were needed
for this MFA-specific browser pass.

This completes the discovered mandatory-configuration implementation blocker.
Actual screen-reader output, responsive/mobile navigation interaction and the
remaining manual attachment/focus-containment acceptance stay open under #21.
Initial tool discovery did not expose viewport/file controls. The subsequently
recovered supported browser documentation provides viewport and file-chooser
operations; their actual responsive/attachment observations are now queued. No
OS setting change or simulated media query substitutes for that evidence.
#62/#93 reader requirements also remain open. The coherent functional increment
is reviewable with `Progresses #21`; it does not claim issue completion or beta
readiness.


## Consolidated review follow-up

Background polling and visibility reads now defer while initial loading or user
pagination owns the read. They update data without replacing live progress,
success or error feedback. Explicit reply refresh and read recovery retain their
visible outcomes and distinguish superseded requests from failures. Fake-timer
and deferred-read regressions cover a pending page during polling, silent data
updates, background failure and the existing accepted-reply recovery.

OTP entry filters to six ASCII digits while preserving the separate URL magic-link
path. Downloads use the normal credential/routing context and current-session
checks before response handling and blob effects. Synthetic tests cover cookie-only
requests, auth failure, deferred responses/blobs and optional-storage logout.
All 53 portal tests, lint and build pass after this batch. These corrections keep
PR116 in draft until the fresh browser and required checks complete; actual
reader acceptance remains open.


## Responsive navigation and attachment browser acceptance

On exact application source `6dfd26aac0ef6401b1ff4099ec87afa0888892ff`, the
supported browser viewport override was set to 390×844. The document client width
was 375 pixels with its scrollbar and had no horizontal overflow. Native responsive
navigation opened with Close navigation focused; Escape returned focus to its
opener, and destination activation focused Workspace. Tab boundaries could reach
browser chrome/document BODY while background controls remained inert; a complete
in-document focus cycle is not claimed. The portal received its own explicit
viewport override after opening a new tab.

The actual native file chooser selected a 62-byte synthetic text attachment.
Removal announced its outcome and returned Attach focus. Selecting it again and
using native Tab/Enter on the blank reply produced the visible text requirement
and retained Send Reply focus. At this point local admission counters were
one ticket, one mutation and zero upload attempts; persisted rows were one ticket,
one article and zero attachments. File selection/removal and the refused blank
reply added no upload or message write.

Adding reply text then sending saved the reply/attachment, showed Reply sent and
reset the composer. The named Download control was activated by keyboard and
retained focus with download-started feedback. The download event wait timed out,
but the browser saved the exact fresh synthetic file; its 62-byte size and SHA-256
matched the source. The reviewer verified and removed only that matching file.
Final admission counters were one ticket, two mutations and one upload attempt;
persisted rows were one ticket, two articles and one attachment.

Both normal sign-outs returned login. The reviewer reset the viewport, closed all
created tabs and cleared credentials. Fixture/frontends stopped, private handoff
and source attachment were removed, the downloaded copy was absent, and native
bind probes verified 8787/5173/5174 reusable. Polling has automated fake-timer and
deferred-request evidence only; no dedicated manual idle-poll assertion or actual
spoken announcement is claimed.

All ten review threads have individual dispositions. Six were already resolved;
the OTP, polling and download findings received tested corrections, while the
suggested native-dialog attribute fallback was explicitly rejected because it
loses modality. No repeated review request was made. The functional increment is
reviewable with `Progresses #21`, while actual reader and any remaining complete
journey/focus-cycle acceptance remain open on the eventual accepted revision.


## Residual keyboard acceptance and correction

After signed PR116, a real guarded browser pass on application 65ad06e completed
portal OTP selection, wrong-code correction, native create Cancel focus return,
operator native Cancel/Close, and keyboard status/priority/assignment/group changes.
The auth fixture's collision operator ID is deliberately non-UUID; a separate
synthetic UUID assignment target/group enabled the supported UUID API contract.
Original identities/invitations and admission counters were unchanged by that
fixture setup. Set/clear values persisted through reload with focus retained.
Normal sign-out-all from a second portal view caused a protected read in the first
view to return login; its email field remained keyboard reachable. An operator
keyboard download saved the exact fresh 62-byte synthetic attachment, then the
reviewer removed the matching file.

This pass discovered three included-workflow defects: rejected operator password
login lost its local feedback, the native operator file chooser lost selected
files, and attachment byte counts displayed misleading units. Correction source
7b3d49b preserves the signed-out login form on its exact rejected login request;
protected-session failures and session-generation fences remain. Portal actual
client/router regressions establish its existing wrong-OTP and login-request error
recovery without changing that client's production logic. The file chooser now
snapshots selected files before resetting the input, announces selection/removal
and returns Attach focus after removal. Both attachment views display byte/KB/MB
units, including small and zero-byte sizes and the dashboard legacy field.

The wrong-password actual-client/router test failed before correction, as did a
native FileList-clear model with a deferred React state update. All 63 dashboard
and 59 portal tests pass afterward, along with both frontend types/builds,
portal/server lint and workflow validation. Both dependency audits report zero
advisories. The unchanged dashboard build retains its existing large-chunk warning.
Corrected-source browser observations and cleanup are recorded below; these
automated results do not claim actual speech or issue completion.

Additional accepted-source computed contrast samples: selector text 17.85:1;
inactive navigation 6.96:1; active navigation 14.63:1; Close outline 17.85:1;
Open navigation focus 5.98:1; normal login button 4.77:1; focused native assignment
ring 4.77:1. The 390×844 view had 375px document width without horizontal overflow.
These are state-specific samples. Forced read-outage/capture-failure browser cases
are unavailable through the supported interactive launcher, whose child exit
intentionally disposes state; runtime/deferred failure evidence stays separate.
Actual-reader acceptance remains required by #21, #62 and #93.


On exact correction source `7b3d49b`, the normal operator wrong-password browser
request retained `Invalid credentials`, associated with both fields, and Sign In
focus. Changing only the password then completed normal MFA and reached Dashboard.
The real operator chooser retained the selected 62-byte file and selection status;
native Shift-Tab from Attach reached Remove, and Return removed the chip, showed
removal status and restored Attach focus. Both actual attachment views displayed
`62 B`. This is native keyboard/DOM feedback evidence, not screen-reader speech.

Admission counters before and after the corrected pass stayed one ticket, eight
mutations and one upload attempt; persisted rows stayed one ticket, eight articles
and one attachment. The article count includes normal operator change notes;
there was no historical message seed. Corrected file selection/removal and login
recovery added zero conversation writes or upload attempts. Original two-tenant
identities/invitations remained unchanged throughout.

Both normal sign-outs returned login, all created tabs closed, viewports reset and
credential/OTP memory cleared. The owned API/Vite sessions exited; the supported
launcher removed its fixture, private handoff and source attachment. The matching
fresh download was already verified and removed. No owned runtime processes or
fixture directories remained, and native Node loopback binds confirmed ports
8787/5173/5174 reusable. An initial Python bind without address reuse returned
EADDRINUSE before those successful native bind probes; it is not represented as a
successful first probe. The first launch on accepted main also needed its existing
native SQLite dependency rebuilt under Node 22; that failed attempt removed its
state and exposed no credentials before the successful fixture run.

This correction progresses #21/#62. Required PR checks and accepted merge remain
separate delivery gates; actual-reader acceptance stays open on all three UI issues.
